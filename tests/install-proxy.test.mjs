import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { load } from 'js-yaml';

// scripts/check-install-proxy.mjs runs in the install job against a real install behind an HTTPS proxy (issue #40).
// Here it runs against a stand-in for that install, once as the app now answers and once with the reported fault.
const slug='proxy-company-1', next=encodeURIComponent(`/c/${slug}/home`);
// trustForwardedHost: Auth builds the link from a client's X-Forwarded-Host, as it could if the gateway passed one on.
// checksCode and closes: first run opens only with the setup code and only once (issue #50), unless a fault is staged.
const setupCode='5e7c0de'.padEnd(64,'0');
function install({signInAt,verifyAt='/auth/v1/verify',trustForwardedHost=false,checksCode=true,closes=true}) {
 const mailbox=[];
 let setUp=false;
 const server=createServer(async (request,response)=>{
  const base=`http://127.0.0.1:${server.address().port}`, url=new URL(request.url,base);
  const cookie=request.headers.cookie || '';
  let body=''; for await(const chunk of request) body+=chunk;
  const send=(status,headers={},body='')=>{ response.writeHead(status,headers); response.end(body); };
  const json=value=>send(200,{'content-type':'application/json'},JSON.stringify(value));
  // The inbox lists the newest message first, as the install's does.
  const mail=(to,at,type,redirect)=>mailbox.unshift({ID:String(mailbox.length+1),To:[{Address:to}],
   HTML:`<a href="${at}${verifyAt}?token=t&amp;type=${type}&amp;redirect_to=${encodeURIComponent(redirect)}">Open</a>`});
  const coded=code=>!checksCode || code===setupCode;
  if(url.pathname==='/first-run' && setUp && closes) return send(404);
  if(url.pathname==='/first-run') return send(200,{},coded(url.searchParams.get('code'))?'<input name="company">':'<p role="alert">Use the setup link</p>');
  if(url.pathname==='/first-run/submit' && request.method==='POST') {
   if(setUp && closes) return send(404);
   if(!coded(new URLSearchParams(body).get('code'))) return send(403);
   setUp=true;
   mail('proxy-owner@example.com',base,'magiclink',`${base}/auth/callback?next=${next}`);
   return send(303,{location:`${signInAt(base)}/sign-in?next=${next}&message=sent&language=en`,'set-cookie':'verifier=v; Path=/'});
  }
  if(url.pathname==='/sign-in') return send(200);
  if(url.pathname==='/mail/api/v1/messages') return json({messages:mailbox.map(({ID,To})=>({ID,To}))});
  if(url.pathname.startsWith('/mail/api/v1/message/')) return json(mailbox.find(message=>message.ID===url.pathname.split('/').pop()));
  if(url.pathname==='/auth/v1/invite' && request.method==='POST' && request.headers.authorization==='Bearer service' && request.headers.apikey==='service') {
   mail(JSON.parse(body).email,base,'invite',url.searchParams.get('redirect_to'));
   return json({id:'invited'});
  }
  if(url.pathname==='/auth/v1/otp' && request.method==='POST' && request.headers.apikey==='anon') {
   const forwarded=request.headers['x-forwarded-host'];
   mail(JSON.parse(body).email,trustForwardedHost && forwarded ? `http://${forwarded}` : base,'magiclink',base);
   return json({});
  }
  if(url.pathname==='/auth/v1/verify' && url.searchParams.get('type')==='invite') return send(303,{location:`${url.searchParams.get('redirect_to')}#access_token=a&refresh_token=r&type=invite`});
  if(url.pathname==='/auth/v1/verify') return send(303,{location:`${url.searchParams.get('redirect_to')}&code=c`});
  if(url.pathname==='/auth/accept') return send(200);
  if(url.pathname==='/auth/callback' && cookie.includes('verifier=v')) return send(307,{location:`${base}/c/${slug}/home`,'set-cookie':['verifier=; Path=/; Max-Age=0','session=s; Path=/']});
  if(url.pathname===`/c/${slug}/home` && cookie.includes('session=s') && !cookie.includes('verifier')) return send(200,{},'<h1>Proxy Company</h1>');
  send(404);
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server)));
}
async function check(server) {
 const origin=`http://127.0.0.1:${server.address().port}`;
 const child=spawn(process.execPath,['--input-type=module','-'],{env:{...process.env,APP_ORIGIN:origin,MAIL_URL:`${origin}/mail`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',SETUP_CODE:setupCode}});
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
 assert.match(output,new RegExp(`Invitation returned to http://127\\.0\\.0\\.1:\\d+/auth/accept\\?next=${encodeURIComponent(`/c/${slug}/settings/members`)}`));
 assert.match(output,/Sign-in link on http:\/\/127\.0\.0\.1:\d+ despite X-Forwarded-Host: evil\.example/);
});

test('the install check fails when first run opens without the setup code', async () => {
 const {status,output}=await check(await install({signInAt:base=>base,checksCode:false}));
 assert.equal(status,1);
 assert.match(output,/first run without the setup code shows no form/);
});

test('the install check fails when the setup code still works after setup', async () => {
 const {status,output}=await check(await install({signInAt:base=>base,closes:false}));
 assert.equal(status,1);
 assert.match(output,/a second submission with the setup code is refused/);
});

test('the install check fails, naming the link, when the emailed sign-in link follows a forged X-Forwarded-Host', async () => {
 const {status,output}=await check(await install({signInAt:base=>base,trustForwardedHost:true}));
 assert.equal(status,1);
 assert.match(output,/the emailed sign-in link ignores the forged X-Forwarded-Host: http:\/\/evil\.example\/auth\/v1\/verify\?token=t/);
});

test('the proxied install check fails when a redirect leaves the public origin for the inside of the install', async () => {
 const {status,output}=await check(await install({signInAt:()=>'http://inside.internal:8080'}));
 assert.equal(status,1);
 assert.match(output,/stays on http:\/\/127\.0\.0\.1:\d+: http:\/\/inside\.internal:8080\/sign-in/);
});

test('the proxied install check fails, naming the link, when the emailed link misses the Auth path behind the gateway', async () => {
 const {status,output}=await check(await install({signInAt:base=>base,verifyAt:'/verify'}));
 assert.equal(status,1);
 assert.match(output,/the emailed link opens Auth behind the gateway: http:\/\/127\.0\.0\.1:\d+\/verify\?token=t&type=magiclink&redirect_to=/);
});

// Auth builds an emailed link by resolving its path against API_EXTERNAL_URL; an absolute path replaces the URL's own
// path, so GoTrue's default "/verify" drops /auth/v1 and lands on the app (seen in the proxied install check, issue #40).
test('every link Auth emails opens its verify path behind the gateway', () => {
 const auth=load(readFileSync('docker-compose.install.yml','utf8')).services.auth.environment;
 assert.equal(auth.API_EXTERNAL_URL,'${SUPABASE_PUBLIC_URL}/auth/v1');
 assert.match(readFileSync('scripts/install-nginx.conf','utf8'),/location \/auth\/v1\/ \{[^}]*rewrite \^\/auth\/v1\/\(\.\*\)\$ \/\$1 break;/);
 for(const kind of ['INVITE','CONFIRMATION','RECOVERY','EMAIL_CHANGE']) assert.equal(auth[`GOTRUE_MAILER_URLPATHS_${kind}`],'/auth/v1/verify',kind);
});

// A client that sends its own X-Forwarded-Host must not choose the host Auth writes into an emailed link (issue #40).
// An empty value drops the header. nginx inherits server-level proxy_set_header only into a location that sets none.
test('the gateway drops a client X-Forwarded-Host on its way to Auth', () => {
 const conf=readFileSync('scripts/install-nginx.conf','utf8');
 const auth=conf.match(/location \/auth\/v1\/ \{([^}]*)\}/)?.[1];
 assert.ok(auth!==undefined,'the gateway routes /auth/v1/');
 const server=conf.replace(/location [^{]*\{[^}]*\}/g,'');
 const drop=/proxy_set_header\s+X-Forwarded-Host\s+"";/i;
 assert.ok(drop.test(auth) || (drop.test(server) && !/proxy_set_header/.test(auth)),'X-Forwarded-Host is set empty where /auth/v1/ uses it');
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
 // The same links check runs on that local install first, while first run is still open, straight to the gateway.
 const checks=[...run.matchAll(/docker run [^\n]*(?:\\\n[^\n]*)*node --input-type=module - < scripts\/check-install-proxy\.mjs/g)];
 assert.equal(checks.length,2,'the links check runs on the local and on the proxied install');
 const [local,proxied]=checks;
 assert.match(local[0],/-e APP_ORIGIN=http:\/\/localhost:3000 -e MAIL_URL=http:\/\/127\.0\.0\.1:8025/);
 assert.ok(at("sh scripts/install.sh || fail 'first install'") < local.index && local.index < at("cp .env.install .env.install.before"),'on the fresh local install');
 assert.match(proxied[0],/-e APP_ORIGIN="\$public"/);
 assert.ok(at("sh scripts/install.sh || fail 'proxied install'") < proxied.index && proxied.index < at('old_web=$(compose ps -q web)'));
 // Both get the anon and service role keys from .env.install as an env file, so neither key is printed.
 for(const {0:command} of checks) assert.ok(command.includes(`--env-file <(grep -E '^(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' .env.install)`),command);
});
