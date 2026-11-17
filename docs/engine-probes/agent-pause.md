# Can the pinned Engine pause one Agent? (#177)

No. Measured on 2026-11-17 on `nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002`,
the image `docker-compose.install.yml` pins.

#177 asks for Pause only if the Engine can keep one profile from taking new Runs, let a Run already open on it finish,
and release it again, all through the management listener. gtmworks keeps no paused switch of its own. The Engine has
no paused state on a profile. The nearest thing it has is parking: `POST /api/gateway/stop?profile=<name>` takes a
profile out of the multiplexing gateway and `POST /api/gateway/start?profile=<name>` puts it back
(`hermes_cli/gateway_profile_lifecycle.py`, `profile_lifecycle`). Parking fails the issue in two ways.

- It refuses while a Run is open on the gateway. The answer is 409, "live session(s) would be interrupted". With
  `?interrupt=true` it stops the open Run instead. So a pause cannot leave an open Run to finish
  (`hermes_cli/web_routers/ops.py`, `stop_gateway`, and `hermes_cli/gateway_lifecycle_guards.py`).
- A parked profile answers every Run request, a read of an earlier Run included, with
  404 `Unknown or unconfigured profile` (`gateway/platforms/api_server_profile_prefix.py`, `resolve_request_profile`).
  gtmworks reads that answer as a profile that no longer exists, then forgets it and makes it again, empty
  (`lib/company-profiles.mjs`, the `missing` branch).

## What the Engine answered

| Step | Answer |
| --- | --- |
| Start Run A on `ag-probe`. The fake model answers after 45 s. | 202, Run A `running` |
| Park `ag-probe` while Run A is open | 409 `Refusing to stop the gateway: 2 live session(s) would be interrupted.` |
| Start Run B after that refusal | 202. The profile still takes new Runs. |
| Read Run A at its end | 200 `completed` |
| Park `ag-probe` once Runs A and B are done | 200 |
| Start Run C while parked | 404 `Unknown or unconfigured profile` |
| Read Run A while parked | 404 `Unknown or unconfigured profile` |
| Unpark `ag-probe` | 200 |
| Start Run D after unpark | 202 |

## The missing piece

A paused state on a profile, set and cleared on the management listener. While it is set, the profile refuses a new
Run with an answer of its own (not the answer for a missing profile), and it keeps serving reads of Runs that are
already open until they end. Until the Engine has it, the Pause row stays disabled and marked "Soon" for every Role.

## Running it again

Save the script below as `probe.py`, then run it inside the pinned image. The script serves a slow fake model on
`127.0.0.1:8080`, makes the profile `ag-probe` on the management listener, and prints one line per step of the table.

```sh
docker run -d --name pause-probe -e API_SERVER_KEY=probe-install-key-0000000000000000 -e API_SERVER_HOST=127.0.0.1 \
  -e API_SERVER_PORT=8642 -e HERMES_DASHBOARD=1 -e HERMES_DASHBOARD_SESSION_TOKEN=probe-install-key-0000000000000000 \
  -v "$PWD/probe.py:/probe.py:ro" nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002 \
  sh -ec 'exec hermes gateway run'
docker exec -e API_SERVER_KEY=probe-install-key-0000000000000000 pause-probe /opt/hermes/.venv/bin/python /probe.py
docker rm -f pause-probe
```

```python
# Runs inside the pinned Hermes image. A slow fake model keeps one Run open; then we try to park the profile.
import json, threading, time, urllib.request, urllib.error, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
KEY=os.environ['API_SERVER_KEY']; P='ag-probe'; PK='p'*40
class M(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_POST(self):
        n=int(self.headers.get('Content-Length') or 0); body=json.loads(self.rfile.read(n) or b'{}')
        time.sleep(int(open('/tmp/delay').read()) if os.path.exists('/tmp/delay') else 0)
        out={'id':'f','object':'chat.completion','created':0,'model':body.get('model'),'choices':[{'index':0,'message':{'role':'assistant','content':'done'},'finish_reason':'stop'}],'usage':{'prompt_tokens':1,'completion_tokens':1,'total_tokens':2}}
        if not body.get('stream'):
            b=json.dumps(out).encode(); self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(b))); self.end_headers(); self.wfile.write(b); return
        self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.end_headers()
        for c in ({'choices':[{'index':0,'delta':{'role':'assistant','content':'done'},'finish_reason':None}]},{'choices':[{'index':0,'delta':{},'finish_reason':'stop'}]},{'choices':[],'usage':out['usage']}):
            self.wfile.write(('data: '+json.dumps({'id':'f','object':'chat.completion.chunk','created':0,'model':body.get('model'),**c})+'\n\n').encode())
        self.wfile.write(b'data: [DONE]\n\n')
threading.Thread(target=ThreadingHTTPServer(('127.0.0.1',8080),M).serve_forever,daemon=True).start()
def call(method,url,body=None,key=KEY,headers=None):
    h={'Authorization':'Bearer '+key,**(headers or {})}
    data=None
    if body is not None: data=json.dumps(body).encode(); h['Content-Type']='application/json'
    try:
        with urllib.request.urlopen(urllib.request.Request(url,data=data,method=method,headers=h),timeout=20) as r: return r.status, r.read().decode()[:400]
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:400]
    except Exception as e: return 0, type(e).__name__
def log(step,res): print(f'{step}: {res[0]} {res[1]}', flush=True)
for _ in range(120):
    if call('GET','http://127.0.0.1:8642/health')[0]==200 and call('GET','http://127.0.0.1:9119/api/profiles')[0]==200: break
    time.sleep(2)
M9='http://127.0.0.1:9119'; R=f'http://127.0.0.1:8642/p/{P}/v1/runs'
log('make profile',call('POST',M9+'/api/profiles',{'name':P,'soul':'probe'}))
log('give it a Run key',call('PUT',M9+f'/api/env?profile={P}',{'key':'API_SERVER_KEY','value':PK}))
log('point it at the slow fake model',call('PUT',M9+f'/api/config?profile={P}',{'config':{'model':{'provider':'custom','default':'fake-model','base_url':'http://127.0.0.1:8080/v1','api_key':'fake','context_length':128000}}}))
for _ in range(40):
    if call('GET',f'http://127.0.0.1:8642/p/{P}/v1/capabilities',key=PK)[0]==200: break
    time.sleep(1)
open('/tmp/delay','w').write('45')
s=call('POST',R,{'input':'hello'},key=PK,headers={'X-Hermes-Session-Key':'probe-1','Idempotency-Key':'probe-1'}); log('start Run A (model answers after 45 s)',s)
run=json.loads(s[1]).get('run_id'); time.sleep(5)
log('Run A while open',call('GET',f'{R}/{run}',key=PK))
log('park the profile (gateway stop, no interrupt)',call('POST',M9+f'/api/gateway/stop?profile={P}'))
time.sleep(12)
log('Run A after that stop',call('GET',f'{R}/{run}',key=PK))
sb=call('POST',R,{'input':'again'},key=PK,headers={'X-Hermes-Session-Key':'probe-2','Idempotency-Key':'probe-2'}); log('start Run B after that stop',sb); runb=json.loads(sb[1]).get('run_id')
for _ in range(60):
    st=call('GET',f'{R}/{run}',key=PK)
    if '"status": "completed"' in st[1] or '"status":"completed"' in st[1] or st[0]!=200: break
    time.sleep(2)
log('Run A at its end',st)
for _ in range(60):
    sb=call('GET',f'{R}/{runb}',key=PK)
    if '"completed"' in sb[1] or sb[0]!=200: break
    time.sleep(2)
log('Run B at its end',(sb[0],sb[1][:120]))
open('/tmp/delay','w').write('0')
log('park the profile with no Run open',call('POST',M9+f'/api/gateway/stop?profile={P}'))
time.sleep(35)
log('profile list entry',(0,[l for l in call('GET',M9+'/api/profiles')[1].split('},') if P in l][:1].__str__()))
log('start Run C while parked',call('POST',R,{'input':'parked'},key=PK,headers={'X-Hermes-Session-Key':'probe-3','Idempotency-Key':'probe-3'}))
log('read Run A while parked',call('GET',f'{R}/{run}',key=PK))
log('cron jobs while parked',call('GET',M9+f'/api/cron/jobs?profile={P}'))
log('unpark (gateway start)',call('POST',M9+f'/api/gateway/start?profile={P}'))
time.sleep(35)
log('start Run D after unpark',call('POST',R,{'input':'back'},key=PK,headers={'X-Hermes-Session-Key':'probe-4','Idempotency-Key':'probe-4'}))
```
