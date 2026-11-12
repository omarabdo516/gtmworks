import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { load } from 'js-yaml';
import { signInMessage, signInFailure } from '../lib/sign-in-message.mjs';
import { FORGED_IDENTITY_HEADERS, forgedIdentity } from '../scripts/forged-identity.mjs';

// Repeated wrong passwords are limited by the auth service's own setting (#41). GoTrue applies its limit per value of
// the header GOTRUE_RATE_LIMIT_HEADER names, and not at all when that header is missing; the gateway writes it from the
// connection address and passes on no client-supplied address, as it does for X-Forwarded-Host (issue #40).
const en=JSON.parse(readFileSync('lib/messages/en.json','utf8'));
const ar=JSON.parse(readFileSync('lib/messages/ar.json','utf8'));

test('the sign-in page says to try again later when the auth service answers 429, and nothing else does', () => {
 assert.equal(signInMessage({status:429,code:'over_request_rate_limit'}),'tooManySignInAttempts');
 assert.equal(signInMessage({status:429}),'tooManySignInAttempts');
 assert.equal(signInMessage({status:400,code:'over_request_rate_limit'}),'tooManySignInAttempts');
 // A wrong password and an unknown email get one message; so does anything else the auth service refuses.
 assert.equal(signInMessage({status:400,code:'invalid_credentials'}),'wrongEmailOrPassword');
 assert.equal(signInMessage({status:500,code:'unexpected_failure'}),'wrongEmailOrPassword');
 assert.equal(signInMessage(null),'');
 assert.equal(en.tooManySignInAttempts,'Too many sign-in attempts. Try again later.');
 assert.ok(ar.tooManySignInAttempts?.trim());
 assert.notEqual(en.tooManySignInAttempts,en.wrongEmailOrPassword);
});

// The browser reports a failed sign-in to the server log (lib/client-errors.tsx sends message and stack as given). Only
// the error's kind, code and status go: an exception's own text could carry what was typed, or the provider's words.
test('a failed sign-in is reported without the password or the exception text', () => {
 const marker='marker-password-41';
 const thrown=Object.assign(new TypeError(`fetch failed for {"password":"${marker}"}`),{code:'unexpected_failure',status:500});
 thrown.stack=`TypeError: ${marker}\n    at signIn (${marker}.js:1:1)`;
 const report=signInFailure(thrown);
 assert.deepEqual(Object.keys(report).sort(),['message']);
 assert.equal(report.message,'Sign-in failed: TypeError unexpected_failure 500');
 assert.ok(!JSON.stringify(report).includes(marker));
 // Code and name come from the auth service or the browser: anything but a plain word is left out, not passed on.
 assert.equal(signInFailure({name:`Auth${marker} x`,code:`bad ${marker}`,status:`${marker}`}).message,'Sign-in failed: Error unknown none');
 assert.equal(signInFailure(`${marker}`).message,'Sign-in failed: Error unknown none');
 assert.equal(signInFailure(null).message,'Sign-in failed: Error unknown none');
 // The form reports only that, for a refused sign-in and for one that threw.
 const form=readFileSync('app/sign-in/form.tsx','utf8');
 const reports=[...form.matchAll(/reportClientError\((.*?)\);/g)].map(match=>match[1]);
 assert.equal(reports.length,2);
 for(const call of reports) assert.equal(call,`'sign-in',signInFailure(error),{stage:'password'}`);
});

test('the browser signs in straight to the auth service, not through a server action', () => {
 const form=readFileSync('app/sign-in/form.tsx','utf8');
 assert.match(form,/browserSupabase\(\)\)\.auth\.signInWithPassword\(/);
 assert.match(form,/signInMessage\(/);
 assert.doesNotMatch(form,/import \{[^}]*\bsignIn\b[^}]*\} from '\.\/actions'/);
 assert.doesNotMatch(readFileSync('app/sign-in/actions.ts','utf8'),/signInWithPassword/);
 // After signing in the browser opens only the page the server already passed through safeNext, never one from the URL.
 assert.match(readFileSync('app/sign-in/page.tsx','utf8'),/next=\{safeNext\(next \|\| null\)\}/);
 assert.match(form,/if\(!error\) \{window\.location\.assign\(next\);return;\}/);
 assert.doesNotMatch(form,/searchParams|location\.search|location\.hash/);
 // The browser's auth client takes its address from /api/config.
 assert.match(readFileSync('lib/browser-supabase.ts','utf8'),/fetch\('\/api\/config'[\s\S]*createBrowserClient\(url, anonKey/);
});

// Load the TypeScript route as Next does: `@/` is the repo root and imports may omit `.ts`.
const root=pathToFileURL(`${process.cwd()}/`);
const file=url=>existsSync(url) && statSync(url).isFile();
registerHooks({resolve(specifier,context,next) {
 const base=specifier.startsWith('@/')?new URL(specifier.slice(2),root):null;
 if(base) for(const extension of ['','.ts']) { const url=new URL(base.href+extension); if(file(url)) return {url:url.href,shortCircuit:true}; }
 return next(specifier,context);
}});
test('the page after sign-in stays inside gtmworks', async () => {
 const {safeNext}=await import('../lib/navigation.ts');
 assert.equal(safeNext('/c/rs-learning/home'),'/c/rs-learning/home');
 assert.equal(safeNext('/all-brands'),'/all-brands');
 for(const outside of ['//evil.example/c/x/','https://evil.example/c/x/','/c/x/..\\..\\\\evil.example','/\\evil.example',null,'']) assert.equal(safeNext(outside),'/',String(outside));
});

test('on an install the browser auth client is given the public origin the gateway serves, not the address inside', async () => {
 Object.assign(process.env,{GTMWORKS_SELF_HOSTED:'true',SUPABASE_PUBLIC_URL:'https://app.example.test',NEXT_PUBLIC_SUPABASE_URL:'http://gateway:8080',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon'});
 const {GET}=await import(`../app/api/config/route.ts?self-hosted=${Date.now()}`);
 const config=await GET().json();
 assert.equal(config.url,'https://app.example.test');
 assert.equal(config.anonKey,'anon');
 // The install refuses to start unless that public URL is APP_ORIGIN, the address people open (lib/install-env.mjs).
 assert.match(readFileSync('lib/install-env.mjs','utf8'),/SUPABASE_PUBLIC_URL must equal APP_ORIGIN/);
});

const nginx=readFileSync('scripts/install-nginx.conf','utf8');
const authBlock=nginx.match(/location \/auth\/v1\/ \{([^}]*)\}/)?.[1];
const serverLevel=nginx.replace(/location [^{]*\{[^}]*\}/g,'');
// nginx inherits server-level proxy_set_header only into a location that sets none; a set header replaces a client's.
const setForAuth=(header,value)=>{
 const set=new RegExp(`proxy_set_header\\s+${header}\\s+${value.replace(/\$/g,'\\$')};`,'i');
 return set.test(authBlock) || (set.test(serverLevel) && !/proxy_set_header/.test(authBlock));
};

test('the install applies the auth service rate limit per connection address written by the gateway', () => {
 const header=load(readFileSync('docker-compose.install.yml','utf8')).services.auth.environment.GOTRUE_RATE_LIMIT_HEADER;
 assert.equal(header,'X-Real-IP');
 // GoTrue v2.197.0 keys its limit on Sb-Forwarded-For before this header when that is enabled: it stays off on installs.
 const environment=load(readFileSync('docker-compose.install.yml','utf8')).services.auth.environment;
 assert.deepEqual(Object.keys(environment).filter(name=>/FORWARDED/i.test(name)),[]);
 assert.ok(authBlock!==undefined,'the gateway routes /auth/v1/');
 assert.ok(setForAuth(header,'$remote_addr'),`${header} is the connection address where /auth/v1/ uses it`);
 assert.equal([...nginx.matchAll(new RegExp(`proxy_set_header\\s+${header}\\b`,'gi'))].length,1,`${header} is set once, from the connection`);
});

test('no client-supplied address header reaches Auth: each is replaced by the connection address or dropped', () => {
 assert.ok(FORGED_IDENTITY_HEADERS.length>=8);
 for(const header of FORGED_IDENTITY_HEADERS) {
  assert.ok(setForAuth(header,'$remote_addr') || setForAuth(header,'""'),`${header} is overwritten or dropped on its way to Auth`);
 }
 // The forwarded chain starts again at the gateway: a client's own X-Forwarded-For is not appended to.
 assert.doesNotMatch(nginx,/\$proxy_add_x_forwarded_for/);
 const headers=forgedIdentity(7);
 assert.deepEqual(Object.keys(headers).sort(),FORGED_IDENTITY_HEADERS.map(name=>name.toLowerCase()).sort());
 assert.notDeepEqual(forgedIdentity(8),headers,'each attempt names other addresses');
});

// Behind an HTTPS proxy every visitor reaches the gateway from one address, so the connection alone would give them one
// shared allowance. The proxy writes the visitor's address in X-Forwarded-For; the gateway takes it from there only when
// the connection comes from the install network's bridge gateway, the address every connection from the install machine
// arrives from (the published port binds 127.0.0.1). No secret and no setting: the address is read when the gateway starts.
const compose=load(readFileSync('docker-compose.install.yml','utf8'));
const realIpScript='scripts/install-gateway-real-ip.sh';
function realIp(routes) {
 const dir=mkdtempSync(join(tmpdir(),'gtmworks-real-ip-'));
 writeFileSync(join(dir,'route'),routes);
 const run=spawnSync('sh',[realIpScript,join(dir,'real-ip.conf'),join(dir,'route')],{encoding:'utf8'});
 return {status:run.status,stderr:run.stderr,conf:readFileSync(join(dir,'real-ip.conf'),'utf8')};
}
const routeHeader='Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n';

test('the gateway trusts X-Forwarded-For only from the exact bridge gateway address of its install network', () => {
 // eth0's default route goes through 172.18.0.1 (little-endian hex in /proc/net/route); the subnet route has no gateway.
 const found=realIp(`${routeHeader}eth0\t00000000\t010012AC\t0003\t0\t0\t0\t00000000\t0\t0\t0\neth0\t000012AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0\n`);
 assert.equal(found.status,0,found.stderr);
 assert.equal(found.conf,'set_real_ip_from 172.18.0.1;\nreal_ip_header X-Forwarded-For;\n');
 // One exact address, never a range: another container on the install network is not trusted.
 assert.doesNotMatch(found.conf,/\//);
 // No default route: nobody is trusted and every visitor counts from its own connection; the gateway still starts.
 const none=realIp(`${routeHeader}eth0\t000012AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0\n`);
 assert.equal(none.status,0,none.stderr);
 assert.doesNotMatch(none.conf,/set_real_ip_from|real_ip_header/);
 assert.match(none.stderr,/no install network gateway address/);
});

test('the gateway starts with that trust file, takes the last forwarded address, and publishes its port on 127.0.0.1 only', () => {
 const gateway=compose.services.gateway;
 assert.deepEqual(gateway.ports,['127.0.0.1:3000:8080']);
 assert.ok(gateway.volumes.includes(`./${realIpScript}:/gtmworks/gateway-real-ip.sh:ro`));
 const start=gateway.entrypoint.join(' ');
 assert.match(start,/sh \/gtmworks\/gateway-real-ip\.sh \/etc\/nginx\/gtmworks-real-ip\.conf/);
 assert.match(start,/exec \/docker-entrypoint\.sh "\$\$@"/);
 assert.deepEqual(gateway.command,['nginx','-g','daemon off;']);
 assert.match(serverLevel,/include \/etc\/nginx\/gtmworks-real-ip\.conf;/);
 // Without real_ip_recursive nginx takes the last address, the one the proxy wrote, not one a client put before it.
 assert.doesNotMatch(nginx,/real_ip_recursive\s+on|set_real_ip_from/);
 const readme=readFileSync('README.md','utf8').replace(/\s+/g,' ');
 assert.ok(readme.includes('Every process on the install machine is trusted to name a visitor this way'),'the README says local processes are trusted');
});

// A stand-in auth service behind the gateway. It limits wrong passwords per key: the connection, or with the reported
// fault a value the client sent, which starts each forged address afresh. `spent` is what this connection has already
// used; `shared` is one allowance for every visitor, already used up by the first.
function auth({limit=5,trustClient=false,spent=0,shared=false}={}) {
 const counts=new Map();
 const server=createServer(async (request,response)=>{
  let text=''; for await(const chunk of request) text+=chunk;
  const send=(status,body)=>{ response.writeHead(status,{'content-type':'application/json'}); response.end(JSON.stringify(body)); };
  const url=new URL(request.url,'http://stand-in');
  if(url.pathname!=='/auth/v1/token' || url.searchParams.get('grant_type')!=='password' || request.headers.apikey!=='anon') return send(404,{});
  const key=trustClient ? request.headers['x-real-ip'] : 'this connection';
  counts.set(key,(counts.get(key)??(shared?limit:trustClient?0:spent))+1);
  if(counts.get(key)>limit) return send(429,{code:429,error_code:'over_request_rate_limit',msg:'Request rate limit reached'});
  if(JSON.parse(text).password==='right-password') return send(200,{access_token:'a'});
  send(400,{code:400,error_code:'invalid_credentials',msg:'Invalid login credentials'});
 });
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server)));
}
async function check(server,mode) {
 const child=spawn(process.execPath,['scripts/check-install-rate-limit.mjs',mode],{env:{...process.env,APP_ORIGIN:`http://127.0.0.1:${server.address().port}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon',SIGN_IN_EMAIL:'owner@example.com',SIGN_IN_PASSWORD:'right-password'}});
 let output=''; child.stdout.on('data',data=>output+=data); child.stderr.on('data',data=>output+=data);
 const status=await new Promise(resolve=>child.on('close',resolve));
 server.close();
 return {status,output};
}

test('another visitor keeps its own allowance: wrong passwords are refused as wrong and the right one signs in', async () => {
 const {status,output}=await check(await auth({limit:20}),'fresh');
 assert.equal(status,0,output);
 assert.match(output,/Another visitor: 10 wrong passwords refused as wrong, then signed in/);
});

test('the other-visitor check fails when the limit is shared by every visitor', async () => {
 const {status,output}=await check(await auth({limit:20,shared:true}),'fresh');
 assert.equal(status,1);
 assert.match(output,/another visitor is refused as wrong, not limited \(HTTP 429/);
});

test('the still-limited check passes when the limited visitor is answered 429 within 5 attempts', async () => {
 const {status,output}=await check(await auth({limit:5,spent:4}),'limited');
 assert.equal(status,0,output);
 assert.match(output,/The first visitor is still limited after 2 attempts/);
});

test('the still-limited check fails when a forged address buys a fresh allowance', async () => {
 const {status,output}=await check(await auth({limit:5,spent:5,trustClient:true}),'limited');
 assert.equal(status,1);
 assert.match(output,/the first visitor is still limited within 5 wrong passwords naming forged addresses/);
});

test('the untrusted-visitor check passes when forged addresses from inside the install network buy nothing', async () => {
 const {status,output}=await check(await auth({limit:5}),'untrusted');
 assert.equal(status,0,output);
 assert.match(output,/A visitor inside the install network is limited after 6 wrong passwords naming forged addresses/);
});

test('the untrusted-visitor check fails when the gateway takes a forged address from inside the install network', async () => {
 const {status,output}=await check(await auth({limit:5,trustClient:true}),'untrusted');
 assert.equal(status,1);
 assert.match(output,/a visitor inside the install network is limited within 310 wrong passwords naming forged addresses/);
});

test('the browser check on the install drives the real sign-in page past the limit with forged addresses', () => {
 const config=readFileSync('playwright.install.config.ts','utf8');
 assert.match(config,/testDir: '\.\/tests\/install'/);
 assert.match(config,/testMatch: '\*\.install\.ts'/);
 const spec=readFileSync('tests/install/rate-limit.install.ts','utf8');
 // The browser suite never runs it: it needs the install.
 assert.match(readFileSync('playwright.config.ts','utf8'),/testMatch: '\*\.spec\.ts'/);
 for(const text of [en.wrongEmailOrPassword,en.tooManySignInAttempts]) assert.ok(spec.includes(`'${text}'`),text);
 assert.match(spec,/forgedIdentity\(/);
 assert.match(spec,/over_request_rate_limit/);
 assert.match(spec,/expect\(new URL\(request\.url\(\)\)\.origin\)\.toBe\(new URL\(origin\)\.origin\)/);
});

test('the install job proves the limit behind the HTTPS proxy: the page, a second visitor, its forged addresses and the first still limited', () => {
 const job=load(readFileSync('.github/workflows/ci.yml','utf8')).jobs.install;
 const index=job.steps.findIndex(step=>step.env?.INSTALL_REF);
 const before=job.steps.slice(0,index);
 assert.ok(before.some(step=>step.uses?.startsWith('actions/setup-node@')),'Node is set up before the install step');
 assert.ok(before.some(step=>/^npm ci --ignore-scripts$/m.test(step.run||'')),'the test packages are installed without their install scripts');
 const run=job.steps[index].run;
 const version=JSON.parse(readFileSync('node_modules/@playwright/test/package.json','utf8')).version;
 const at=pattern=>{ const match=run.match(pattern); assert.ok(match,String(pattern)); return {index:match.index,text:match[0]}; };
 const command=pattern=>at(new RegExp(`docker run [^\\n]*(?:\\\\\\n[^\\n]*)*${pattern}[^\\n]*`));
 // The proxy the job starts is Caddy on the host network in front of the published port; it replaces a client's own
 // X-Forwarded-For with the address it sees.
 assert.match(run,/'app\.gtmworks\.test:4443 \{' '  reverse_proxy 127\.0\.0\.1:3000' '\}'/);
 assert.match(run,/docker run -d --name install-proxy --network host /);
 assert.doesNotMatch(run,/trusted_proxies/);
 const page=command('npx --no-install playwright test -c playwright.install\\.config\\.ts');
 assert.ok(page.text.includes(`mcr.microsoft.com/playwright:v${version}-noble`),`the browser image matches @playwright/test ${version}`);
 assert.match(page.text,/--network host --ipc=host --add-host app\.gtmworks\.test:127\.0\.0\.1/);
 assert.match(page.text,/-e APP_ORIGIN="\$public" -e SIGN_IN_EMAIL=proxy-owner@example\.com/);
 const network=`${compose.name}_default`;
 const fresh=command('check-install-rate-limit\\.mjs fresh');
 assert.ok(fresh.text.includes(`--network ${network}`),`the second visitor connects from inside the install network ${network}`);
 assert.match(fresh.text,/-e APP_ORIGIN=http:\/\/gateway:8080 -e SIGN_IN_EMAIL=proxy-owner@example\.com -e SIGN_IN_PASSWORD=proxy-owner-password/);
 const untrusted=command('check-install-rate-limit\\.mjs untrusted');
 assert.ok(untrusted.text.includes(`--network ${network}`),'the untrusted visitor connects from inside the install network');
 assert.match(untrusted.text,/-e APP_ORIGIN=http:\/\/gateway:8080 -e SIGN_IN_EMAIL=proxy-owner@example\.com/);
 const limited=command('check-install-rate-limit\\.mjs limited');
 assert.match(limited.text,/--network host --add-host app\.gtmworks\.test:127\.0\.0\.1/);
 assert.match(limited.text,/-e NODE_EXTRA_CA_CERTS=\/ca\.crt -e APP_ORIGIN="\$public"/);
 assert.match(readFileSync('scripts/check-install-proxy.mjs','utf8'),/email:'proxy-owner@example\.com'[^}]*password:'proxy-owner-password'/);
 for(const {text} of [page,fresh,untrusted,limited]) assert.ok(text.includes(`--env-file <(grep -E '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.install)`),'the anon key passes as an env file, so it is not printed');
 assert.match(readFileSync('playwright.install.config.ts','utf8'),/ignoreHTTPSErrors: true/);
 // After the proxied first run made the Owner, in this order, before the failed-update check.
 const proxied=at(/node --input-type=module - < scripts\/check-install-proxy\.mjs \|\| \{ docker logs install-proxy/).index;
 const update=at(/cp scripts\/install-failing-migration\.sql/).index;
 assert.ok(proxied<page.index && page.index<fresh.index && fresh.index<untrusted.index && untrusted.index<limited.index && limited.index<update);
 assert.equal([...run.matchAll(/check-install-rate-limit\.mjs|playwright\.install\.config\.ts/g)].length,4,'the limit is checked only behind the proxy');
});
