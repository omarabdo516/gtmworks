import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { load } from 'js-yaml';

// scripts/check-install-proxy.mjs runs in the install job against a real install behind an HTTPS proxy (issue #40).
// Here it runs against a stand-in for that install, once as the app now answers and once with the reported fault.
const slug='proxy-company-1', next=encodeURIComponent(`/c/${slug}/home`);
function install({signInAt}) {
 const server=createServer((request,response)=>{
  const base=`http://127.0.0.1:${server.address().port}`, url=new URL(request.url,base);
  const cookie=request.headers.cookie || '';
  const send=(status,headers={},body='')=>{ response.writeHead(status,headers); response.end(body); };
  const json=value=>send(200,{'content-type':'application/json'},JSON.stringify(value));
  if(url.pathname==='/first-run') return send(200);
  if(url.pathname==='/first-run/submit' && request.method==='POST') return send(303,{location:`${signInAt(base)}/sign-in?next=${next}&message=sent&language=en`,'set-cookie':'verifier=v; Path=/'});
  if(url.pathname==='/sign-in') return send(200);
  if(url.pathname==='/mail/api/v1/messages') return json({messages:[{ID:'1',To:[{Address:'proxy-owner@example.com'}]}]});
  if(url.pathname==='/mail/api/v1/message/1') return json({HTML:`<a href="${base}/auth/v1/verify?token=t&amp;type=magiclink&amp;redirect_to=${encodeURIComponent(`${base}/auth/callback?next=${next}`)}">Sign in</a>`});
  if(url.pathname==='/auth/v1/verify') return send(303,{location:`${url.searchParams.get('redirect_to')}&code=c`});
  if(url.pathname==='/auth/callback' && cookie.includes('verifier=v')) return send(307,{location:`${base}/c/${slug}/home`,'set-cookie':['verifier=; Path=/; Max-Age=0','session=s; Path=/']});
  if(url.pathname===`/c/${slug}/home` && cookie.includes('session=s') && !cookie.includes('verifier')) return send(200,{},'<h1>Proxy Company</h1>');
  send(404);
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server)));
}
async function check(server) {
 const origin=`http://127.0.0.1:${server.address().port}`;
 const child=spawn(process.execPath,['--input-type=module','-'],{env:{...process.env,APP_ORIGIN:origin,MAIL_URL:`${origin}/mail`}});
 let output=''; child.stdout.on('data',data=>output+=data); child.stderr.on('data',data=>output+=data);
 child.stdin.end(readFileSync('scripts/check-install-proxy.mjs'));
 const status=await new Promise(resolve=>child.on('close',resolve));
 server.close();
 return {status,output};
}

test('the proxied install check follows first run and the emailed link to the Company home', async () => {
 const {status,output}=await check(await install({signInAt:base=>base}));
 assert.equal(status,0,output);
 assert.match(output,new RegExp(`Reached http://127\\.0\\.0\\.1:\\d+/c/${slug}/home`));
});

test('the proxied install check fails when a redirect leaves the public origin for the inside of the install', async () => {
 const {status,output}=await check(await install({signInAt:()=>'http://inside.internal:8080'}));
 assert.equal(status,1);
 assert.match(output,/stays on http:\/\/127\.0\.0\.1:\d+: http:\/\/inside\.internal:8080\/sign-in/);
});

test('the install job runs first run and sign-in through an HTTPS proxy whose origin is APP_ORIGIN', () => {
 const step=load(readFileSync('.github/workflows/ci.yml','utf8')).jobs.install.steps.find(step=>step.env?.INSTALL_REF);
 const run=step.run;
 const at=text=>{ const index=run.indexOf(text); assert.notEqual(index,-1,text); return index; };
 const origin=run.match(/^\s*public=(https:\/\/[^\s]+)$/m)?.[1];
 assert.ok(origin,'the proxied origin is https');
 const host=new URL(origin).host;
 // A fresh install, so first run opens, set to the public origin; the proxy terminates HTTPS for it in front of the gateway.
 assert.ok(at('compose down -v') < at('s#^APP_ORIGIN=.*#APP_ORIGIN=$public#'));
 assert.ok(at('s#^SUPABASE_PUBLIC_URL=.*#SUPABASE_PUBLIC_URL=$public#') < at("sh scripts/install.sh || fail 'proxied install'"));
 assert.match(run,new RegExp(`'${host.replace('.','\\.')} \\{' '  reverse_proxy 127\\.0\\.0\\.1:3000' '\\}'`));
 assert.match(run,/-e NODE_EXTRA_CA_CERTS=\/ca\.crt -e APP_ORIGIN="\$public" -e MAIL_URL=http:\/\/127\.0\.0\.1:8025/);
 assert.ok(at('node --input-type=module - < scripts/check-install-proxy.mjs') < at('old_web=$(compose ps -q web)'),'before the update check, which the update-log test runs alone');
 // The local install on http://localhost:3000 is checked first, as before.
 assert.ok(at("sh scripts/install.sh || fail 'first install'") < at('compose down -v'));
});
