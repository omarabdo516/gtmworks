import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { load } from 'js-yaml';
import { installJob } from './install-job.mjs';

// scripts/check-install-proxy.mjs runs in the install job against a real install behind an HTTPS proxy (issue #40).
// Here it runs against a stand-in for that install, once as the app now answers and once with the reported fault.
const slug='proxy-company-1';
// checksCode and closes: first run opens only with the setup code and only once (issue #50), unless a fault is staged.
const setupCode='5e7c0de'.padEnd(64,'0');
function install({signInAt,checksCode=true,closes=true,linksSupported=true}) {
 const links=[];
 let setUp=false;
 const server=createServer(async (request,response)=>{
  const base=`http://127.0.0.1:${server.address().port}`, url=new URL(request.url,base);
  const cookie=request.headers.cookie || '';
  let body=''; for await(const chunk of request) body+=chunk;
  const send=(status,headers={},body='')=>{ response.writeHead(status,headers); response.end(body); };
  const json=value=>send(200,{'content-type':'application/json'},JSON.stringify(value));
  const coded=code=>!checksCode || code===setupCode;
  if(url.pathname==='/first-run' && setUp && closes) return send(404);
  // The code is in the link's fragment, which no request carries: the server's page is the same for every visitor.
  if(url.pathname==='/first-run') return send(200,{},'<p role="alert">Use the setup link</p>');
  if(url.pathname==='/first-run/submit' && request.method==='POST') {
   if(setUp && closes) return send(404);
   if(!coded(new URLSearchParams(body).get('code'))) return send(403);
   // First run signs the Owner in with the chosen password and opens the Company home, with no email (issue #41).
   if(!new URLSearchParams(body).get('password')) return send(400);
   setUp=true;
   return send(303,{location:`${signInAt(base)}/c/${slug}/home`,'set-cookie':'session=s; Path=/'});
  }
  if(url.pathname==='/sign-in') return send(200);
  if(url.pathname==='/auth/v1/token' && request.method==='POST' && url.searchParams.get('grant_type')==='password') {
   const credentials=JSON.parse(body); assert.equal(credentials.email,'proxy-owner@example.com'); assert.ok(credentials.password);
   return json({access_token:'owner-token'});
  }
  if(url.pathname==='/rest/v1/companies' && request.method==='GET' && request.headers.apikey==='service' && url.searchParams.get('slug')===`eq.${slug}`) return json([{id:'10000000-0000-0000-0000-000000000001'}]);
  if(url.pathname==='/rest/v1/rpc/make_invite_link' && request.method==='POST') {
   assert.equal(request.headers.authorization,'Bearer owner-token'); assert.equal(request.headers.apikey,'anon');
   const row=JSON.parse(body); assert.equal(row.link_role,'contributor'); assert.match(row.link_hash,/^[a-f0-9]{64}$/);
   links.push({used_at:null}); return json('10000000-0000-0000-0000-000000000002');
  }
  if(url.pathname==='/rest/v1/company_links' && request.method==='GET' && request.headers.apikey==='service' && !linksSupported) return send(404,{},'');
  if(url.pathname==='/rest/v1/company_links' && request.method==='GET' && request.headers.apikey==='service') return json(links.map(row=>({used_at:row.used_at ?? '2026-11-28T00:00:00Z'})));
  if(url.pathname==='/join') return send(200,{},'<main>Join</main>');
  if(url.pathname==='/join/submit' && request.method==='POST') {
   const form=new URLSearchParams(body);
   assert.match(form.get('code') || '',/^[a-f0-9]{64}$/); assert.ok(form.get('email'));
   return send(303,{location:`${base}/c/${slug}/home`,'set-cookie':'session=s; Path=/'});
  }
  if(url.pathname===`/c/${slug}/home` && cookie.includes('session=s')) return send(200,{},'<h1>Proxy Company</h1>');
  send(404);
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server)));
}
async function check(server) {
 const origin=`http://127.0.0.1:${server.address().port}`;
 const child=spawn(process.execPath,['--input-type=module','-'],{env:{...process.env,APP_ORIGIN:origin,
  NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',SETUP_CODE:setupCode}});
 let output=''; child.stdout.on('data',data=>output+=data); child.stderr.on('data',data=>output+=data);
 child.stdin.end(readFileSync('scripts/check-install-proxy.mjs'));
 const status=await new Promise(resolve=>child.on('close',resolve));
 server.close();
 return {status,output};
}

test('the proxied install check follows the password first run to the Company home, joins a Person by Invite link, and keeps every redirect on the public origin', async () => {
 const {status,output}=await check(await install({signInAt:base=>base}));
 assert.equal(status,0,output);
 assert.match(output,new RegExp(`Reached http://127\\.0\\.0\\.1:\\d+/c/${slug}/home`));
 assert.match(output,new RegExp(`Invite link joined proxy-joined@example\\.com in http://127\\.0\\.0\\.1:\\d+/c/${slug}/home`));
});

test('an older release without Invite links skips that step, and first run still passes', async () => {
 const {status,output}=await check(await install({signInAt:base=>base,linksSupported:false}));
 assert.equal(status,0,output);
 assert.match(output,/Invite links: not in this release/);
});

test('the install check fails when first run opens without the setup code', async () => {
 const {status,output}=await check(await install({signInAt:base=>base,checksCode:false}));
 assert.equal(status,1);
 assert.match(output,/a submission without the setup code is refused/);
});

test('the install check fails when the setup code still works after setup', async () => {
 const {status,output}=await check(await install({signInAt:base=>base,closes:false}));
 assert.equal(status,1);
 assert.match(output,/a second submission with the setup code is refused/);
});

test('the proxied install check fails when a redirect leaves the public origin for the inside of the install', async () => {
 const {status,output}=await check(await install({signInAt:()=>'http://inside.internal:8080'}));
 assert.equal(status,1);
 assert.match(output,new RegExp(`stays on http://127\\.0\\.0\\.1:\\d+: http://inside\\.internal:8080/c/${slug}/home`));
});

// The install sends no email (#948, ADR 0019): it has no mailbox service and no SMTP or mailer setting. Sign-in stays
// with a password, which GoTrue reads as its email provider, so the provider itself stays on.
test('the install defines no mailbox service and no SMTP or mailer setting', () => {
 const compose=load(readFileSync('docker-compose.install.yml','utf8'));
 assert.equal(compose.services.mail,undefined,'no mail service');
 assert.doesNotMatch(readFileSync('docker-compose.install.yml','utf8'),/GOTRUE_(SMTP|MAILER)_/);
 assert.equal(compose.services.auth.environment.GOTRUE_EXTERNAL_EMAIL_ENABLED,'true','password sign-in needs the email provider');
});

// A client that sends its own X-Forwarded-Host must not choose the host Auth builds a redirect or link from (issue #40).
// An empty value drops the header. nginx inherits server-level proxy_set_header only into a location that sets none.
test('the gateway drops a client X-Forwarded-Host on its way to Auth', () => {
 const conf=readFileSync('scripts/install-nginx.conf','utf8');
 const auth=conf.match(/location \/auth\/v1\/ \{([^}]*)\}/)?.[1];
 assert.ok(auth!==undefined,'the gateway routes /auth/v1/');
 const server=conf.replace(/location [^{]*\{[^}]*\}/g,'');
 const drop=/proxy_set_header\s+X-Forwarded-Host\s+"";/i;
 assert.ok(drop.test(auth) || (drop.test(server) && !/proxy_set_header/.test(auth)),'X-Forwarded-Host is set empty where /auth/v1/ uses it');
});

// nginx inherits the server-level proxy_set_header lines only into a location that sets none of its own. The Screen's
// live stream and the board's live changes set their upgrade headers, so they repeat each server-level one: without Host
// the app reads its own address as web:3000 and refuses the browser's Origin as another site's, and a client's claimed
// address would reach it (#713, #840).
test('a gateway location that sets its own headers repeats every server-level one', () => {
 const conf=readFileSync('scripts/install-nginx.conf','utf8');
 const server=conf.replace(/location [^{]*\{[^}]*\}/g,'');
 const lines=text=>[...text.matchAll(/proxy_set_header\s+(\S+)\s+([^;]*);/g)].map(([,name,value])=>`${name.toLowerCase()} ${value}`);
 const inherited=lines(server);
 assert.ok(inherited.includes('host $http_host'));
 const own=[...conf.matchAll(/location ([^{]*)\{([^}]*)\}/g)].filter(([,,body])=>/proxy_set_header/.test(body));
 const upgraded=own.find(([,,body])=>/proxy_set_header\s+Upgrade/.test(body))?.[1]??'';
 for(const path of ['/api/display/ws','/api/board/events']) assert.match(path,new RegExp(upgraded.replace(/^\s*~\s*/,'').trim()),`${path} is passed on as an upgrade`);
 for(const [,at,body] of own) for(const line of inherited) assert.ok(lines(body).includes(line),`${at.trim()} repeats ${line}`);
});

// #869: a Company's Hermes dashboard and its sockets reach gtmworks's web server, which gates them; the gateway names
// no Engine, so the Engine is reached from the web server only.
test('the gateway passes a Company\'s Hermes dashboard and its sockets to the web server, unbuffered, and names no Engine', () => {
 const conf=readFileSync('scripts/install-nginx.conf','utf8');
 const [,at,body]=[...conf.matchAll(/location ([^{]*)\{([^}]*)\}/g)].find(([,where])=>where.includes('hermes'))??[];
 assert.ok(body,'the dashboard has its own location');
 const path=new RegExp(at.trim().replace(/^~\s*/,''));
 for(const asked of ['/c/rs-learning/hermes','/c/rs-learning/hermes/','/c/rs-learning/hermes/api/ws']) assert.ok(path.test(asked),asked);
 for(const other of ['/c/rs-learning/hermesx','/c/rs-learning/chat']) assert.ok(!path.test(other),other);
 assert.match(body,/proxy_pass http:\/\/\$web;/);
 assert.match(body,/proxy_set_header Upgrade \$http_upgrade;/);
 assert.match(body,/proxy_buffering off;/);
 assert.doesNotMatch(conf,/9119|gtmworks-engine/);
});

test('the install job runs first run and the Invite link through an HTTPS proxy whose origin is APP_ORIGIN', () => {
 const step=installJob().steps.find(step=>step.env?.INSTALL_REF);
 const run=step.run;
 const at=text=>{ const index=run.indexOf(text); assert.notEqual(index,-1,text); return index; };
 const origin=run.match(/^\s*public=(https:\/\/[^\s]+)$/m)?.[1];
 assert.ok(origin,'the proxied origin is https');
 const host=new URL(origin).host;
 // A fresh install, so first run opens, set to the public origin; the proxy terminates HTTPS for it in front of the gateway.
 assert.ok(at('compose down -v') < at('s#^APP_ORIGIN=.*#APP_ORIGIN=$public#'));
 assert.ok(at('s#^SUPABASE_PUBLIC_URL=.*#SUPABASE_PUBLIC_URL=$public#') < at("sh scripts/install.sh || fail 'proxied install'"));
 assert.match(run,new RegExp(`'${host.replace('.','\\.')} \\{' '  reverse_proxy 127\\.0\\.0\\.1:3000' '\\}'`));
 assert.match(run,/-e NODE_EXTRA_CA_CERTS=\/ca\.crt -e APP_ORIGIN="\$public"/);
 assert.ok(at('node --input-type=module - < scripts/check-install-proxy.mjs') < at('check-install-rate-limit.mjs fresh'),'before the rate-limit checks');
 // The install sends no email: no check is handed a mailbox, and first-install proves the install defines none.
 assert.doesNotMatch(run,/MAIL_URL/);
 at("services=$(compose config --services) || fail 'read the install services'");
 at("grep -q '^Invite link joined proxy-joined@example.com in ' complete-setup.log");
 // The local install on http://localhost:3000 is checked first, as before.
 const proxyReset='reset_install\ndocker run --rm -v "$root/lib:/code:ro" node:22.14.0-alpine3.21 node /code/install-env.mjs generate > .env.install';
 assert.ok(at("install_source first-install.log || fail 'first install'") < at(proxyReset));
 // The proxy area makes its own fresh install (#406): no earlier area's install is needed, and the public origin is in
 // the settings file before the first install runs.
 assert.ok(at(proxyReset) < at("s#^APP_ORIGIN=.*#APP_ORIGIN=$public#"));
 // The same links check runs on that local install first, while first run is still open, straight to the gateway.
 const checks=[...run.matchAll(/docker run [^\n]*(?:\\\n[^\n]*)*node --input-type=module - < scripts\/check-install-proxy\.mjs/g)];
 assert.equal(checks.length,2,'the links check runs on the local and on the proxied install');
 const [local,proxied]=checks;
 assert.match(local[0],/-e APP_ORIGIN=http:\/\/localhost:3000/);
 const setup=at("complete_setup | tee complete-setup.log || fail 'first run and its Invite link on the local install'");
 assert.ok(at("install_source first-install.log || fail 'first install'") < setup && setup < at("cp .env.install .env.install.before"),'on the fresh local install');
 assert.match(proxied[0],/-e APP_ORIGIN="\$public"/);
 assert.ok(at("sh scripts/install.sh || fail 'proxied install'") < proxied.index && proxied.index < at('check-install-rate-limit.mjs fresh'));
 // Both get the anon and service role keys from .env.install as an env file, so neither key is printed.
 for(const {0:command} of checks) assert.ok(command.includes(`--env-file <(grep -E '^(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' .env.install)`),command);
});
