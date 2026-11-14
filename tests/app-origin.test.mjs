import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Behind an HTTPS proxy the request says http and names the inside of the install (issue #40). These run the real
// first-run and auth callback handlers with such a request and a stand-in Auth and database server.
const origin='https://example.test:4443';
const inside={host:'gateway:8080','x-forwarded-host':'inside.internal:8080','x-forwarded-proto':'http'};

// Load the TypeScript routes as Next does: `@/` is the repo root, imports may omit `.ts`, and the request-scoped modules
// Next provides (`next/headers`, `server-only`) are replaced by a cookie jar the test can read.
const root=pathToFileURL(`${process.cwd()}/`);
const stubs={
 'server-only':'export {};',
 'next/headers':'export async function cookies() { const jar=globalThis.routeCookies; return {getAll:()=>[...jar].map(([name,value])=>({name,value})),set:(name,value)=>{jar.set(name,value);}}; }',
};
const file=url=>existsSync(url) && statSync(url).isFile();
registerHooks({resolve(specifier,context,next) {
 if(specifier in stubs) return {url:`data:text/javascript,${encodeURIComponent(stubs[specifier])}`,shortCircuit:true};
 if(/^next\/(server|navigation)$/.test(specifier)) return next(`${specifier}.js`,context);
 const base=specifier.startsWith('@/')?new URL(specifier.slice(2),root):/^\.\.?\//.test(specifier)&&context.parentURL?.startsWith('file:')?new URL(specifier,context.parentURL):null;
 if(base) for(const extension of ['','.ts','.tsx']) { const url=new URL(base.href+extension); if(file(url)) return {url:url.href,shortCircuit:true}; }
 return next(specifier,context);
}});

process.env.NEXT_PUBLIC_SUPABASE_URL='http://auth.test';
process.env.SUPABASE_SERVICE_ROLE_KEY='service-role-test-key';
// The one-time code the installer prints in the setup link (issue #50).
const code='0123456789abcdef'.repeat(4);
process.env.SETUP_CODE=code;
const {NextRequest}=await import('next/server');
const submit=(await import('../app/first-run/submit/route.ts')).POST;
const callback=(await import('../app/auth/callback/route.ts')).GET;
const {sendResetLink}=await import('../app/sign-in/actions.ts');
const {supabase}=await import('../lib/supabase.ts');

// The Auth and database server: answers what setup and sign-in ask and records every request.
function server() {
 const requests=[];
 globalThis.routeCookies=new Map();
 globalThis.fetch=async (input,init={})=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  requests.push(url);
  const reply=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
  if(url.pathname==='/rest/v1/rpc/setup_is_open') return reply(true);
  if(url.pathname==='/auth/v1/admin/users') return reply({id:'00000000-0000-4000-8000-000000000040',email:'owner@example.test'});
  if(url.pathname==='/rest/v1/rpc/complete_setup') return reply('first-company-0000abcd');
  if(url.pathname==='/auth/v1/otp' || url.pathname==='/auth/v1/recover') return reply({});
  if(url.pathname==='/auth/v1/token') return reply({access_token:'access',token_type:'bearer',expires_in:3600,expires_at:4102444800,refresh_token:'refresh',user:{id:'00000000-0000-4000-8000-000000000040',aud:'authenticated',email:'owner@example.test'}});
  if(url.pathname==='/rest/v1/rpc/claim_invitations') return reply(null);
  throw new Error(`unexpected request ${init.method||'GET'} ${url}`);
 };
 return requests;
}
const form=values=>{ const body=new FormData(); for(const [name,value] of Object.entries(values)) body.set(name,value); return body; };
const owner={name:'Owner',email:'owner@example.test',company:'First Company',language:'en',code,password:'owner-password-41',confirm:'owner-password-41'};

test('first run signs the Owner in and redirects on APP_ORIGIN, not on the forwarded request, with no email', async () => {
 process.env.APP_ORIGIN=origin;
 const requests=server();
 const response=await submit(new NextRequest('http://gateway:8080/first-run/submit',{method:'POST',headers:inside,body:form(owner)}));
 assert.equal(response.status,303);
 assert.equal(response.headers.get('location'),`${origin}/c/first-company-0000abcd/home`);
 assert.ok(requests.some(url=>url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='password'),'the Owner signed in with the password');
 assert.ok(!requests.some(url=>url.pathname==='/auth/v1/otp'),'no sign-in email was requested');
});

test('first run sends invalid input back to the form on APP_ORIGIN', async () => {
 process.env.APP_ORIGIN=origin;
 server();
 const response=await submit(new NextRequest('http://gateway:8080/first-run/submit',{method:'POST',headers:inside,body:form({...owner,name:'',language:'ar'})}));
 assert.equal(response.status,303);
 // The code returns in the fragment (issue #50), so the browser's next request to /first-run does not carry it.
 assert.equal(response.headers.get('location'),`${origin}/first-run?invalid=1&language=ar#code=${code}`);
});

test('first run takes the setup code only from the submitted body, never from the address', async () => {
 process.env.APP_ORIGIN=origin;
 const requests=server();
 const noCode={...owner}; delete noCode.code;
 const response=await submit(new NextRequest(`http://gateway:8080/first-run/submit?code=${code}`,{method:'POST',headers:inside,body:form(noCode)}));
 assert.equal(response.status,403);
 assert.deepEqual(requests.map(url=>url.pathname),['/rest/v1/rpc/setup_is_open'],'nothing is created');
});

test('the auth callback redirects on APP_ORIGIN after the code is exchanged and when it is not', async () => {
 process.env.APP_ORIGIN=origin;
 const requests=server();
 // An invitation email leaves its code verifier in the browser's cookies; the callback needs it to exchange the code.
 await (await supabase()).auth.signInWithOtp({email:owner.email,options:{emailRedirectTo:`${origin}/auth/callback`}});
 const signedIn=await callback(new NextRequest(`http://gateway:8080/auth/callback?code=one-time&next=${encodeURIComponent('/c/first-company-0000abcd/home')}`,{headers:inside}));
 assert.ok(requests.some(url=>url.pathname==='/auth/v1/token'),'the code was exchanged');
 assert.equal(signedIn.headers.get('location'),`${origin}/c/first-company-0000abcd/home`);
 const noCode=await callback(new NextRequest('http://gateway:8080/auth/callback',{headers:inside}));
 assert.equal(noCode.headers.get('location'),`${origin}/sign-in`);
});

test('the reset link is built on APP_ORIGIN, not on the forwarded request', async () => {
 process.env.APP_ORIGIN=origin;
 const requests=server();
 assert.equal(await sendResetLink('',form({email:'owner@example.test'})),'checkYourEmailForAResetLink');
 const recover=requests.find(url=>url.pathname==='/auth/v1/recover');
 assert.ok(recover,'the reset email was requested');
 assert.equal(recover.searchParams.get('redirect_to'),`${origin}/auth/reset`);
});

test('the origin is read from APP_ORIGIN each time a link is built', async () => {
 const {appUrl}=await import('../lib/app-origin.mjs');
 assert.equal(appUrl('/sign-in',{APP_ORIGIN:origin}).href,`${origin}/sign-in`);
 process.env.APP_ORIGIN='http://localhost:3000';
 assert.equal(appUrl('/sign-in').href,'http://localhost:3000/sign-in');
 process.env.APP_ORIGIN=origin;
 assert.equal(appUrl('/auth/callback?next=%2F').href,`${origin}/auth/callback?next=%2F`);
});

test('a write is cross-site only when its Origin names another host than the request', async () => {
 const {crossSiteWrite}=await import('../lib/app-origin.mjs');
 assert.equal(crossSiteWrite(new Headers({host:'app.example.test'})),false);
 assert.equal(crossSiteWrite(new Headers({host:'app.example.test',origin:'https://app.example.test'})),false);
 assert.equal(crossSiteWrite(new Headers({host:'app.example.test',origin:'https://elsewhere.test'})),true);
 assert.equal(crossSiteWrite(new Headers({host:'app.example.test',origin:'null'})),true);
});

test('no file in app/ or lib/ but the one helper reads the host, origin or forwarded headers', () => {
 const helper='lib/app-origin.mjs';
 const source=directory=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
  const path=`${directory}/${entry.name}`;
  return entry.isDirectory()?source(path):/\.(?:[cm]?[jt]s|tsx)$/.test(entry.name)?[path]:[];
 });
 const files=[...source('app'),...source('lib'),'middleware.ts'];
 for(const route of ['app/first-run/submit/route.ts','app/auth/callback/route.ts','app/sign-in/actions.ts','app/api/conversations/route.ts']) assert.ok(files.includes(route),`the scan sees ${route}`);
 assert.ok(files.includes(helper),'the scan sees the helper');
 const forbidden=/['"`](?:host|origin|x-forwarded-host|x-forwarded-proto)['"`]|nextUrl\.(?:origin|host|protocol)\b|\breq(?:uest)?\.url\b/i;
 assert.match(readFileSync(helper,'utf8'),forbidden,'the pattern finds the header names where they are read');
 assert.deepEqual(files.filter(path=>path!==helper&&forbidden.test(readFileSync(path,'utf8'))),[]);
});

// The auth service answers an address with no account as sent, but a second request for an existing account within its
// cooldown is refused (429): that answer would tell whether the account exists, so the page says the same as for a
// sent link. A failure that is the same for every address (the service is down) still says the link was not sent.
test('a reset request refused for its cooldown answers like a sent link; a failed service says it was not sent', async () => {
 process.env.APP_ORIGIN=origin;
 const answering=status=>{ globalThis.fetch=async()=>new Response(JSON.stringify({code:status===429?'over_email_send_rate_limit':'unexpected_failure',msg:'refused'}),{status,headers:{'Content-Type':'application/json'}}); };
 answering(429);
 assert.equal(await sendResetLink('',form({email:'owner@example.test'})),'checkYourEmailForAResetLink');
 answering(500);
 assert.equal(await sendResetLink('',form({email:'owner@example.test'})),'couldNotSendTheLinkTryAgain');
});
