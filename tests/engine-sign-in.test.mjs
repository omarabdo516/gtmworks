import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { companyProfile, engineSignIn } from '../lib/hermes.mjs';
import { bundledHermesManagement } from '../lib/bundled-hermes.mjs';

// A company connects its own ChatGPT subscription through the bundled Engine's management listener (#3, ADR 0012): one
// Hermes profile per company, every OAuth call scoped to it with `?profile=`. The fake below keeps what the pinned
// release (v0.23.0) does, read from its source:
// - every /api route needs the install key as a Bearer token (hermes_cli/web_server.py:457-475);
// - `?profile=<name>` scopes a call to that profile's home, an unknown name is 404, and a call without it uses the
//   default profile (hermes_cli/web_server_profiles.py:190-199, 277-324);
// - a profile reads the default profile's credential when it has none of its own (hermes_cli/auth.py:813-831);
// - openai-codex signs in by device code (/start, /poll), anthropic has no dashboard sign-in and /submit always
//   refuses (hermes_cli/web_routers/oauth.py:139-147 of web_server_oauth.py, 841-902);
// - a session belongs to the profile it was started for (oauth.py:921-934, 975-992);
// - disconnect clears the provider's singleton and pool entries, 409 when there was nothing (auth.py:1359-1380).
const key='install-key-'+randomBytes(8).toString('hex');
async function fakeManagement() {
 /** @type {Map<string,{description:string,store:Record<string,string[]>}>} */
 const profiles=new Map([['default',{description:'',store:{}}]]);
 const requests=/** @type {{method:string,path:string,profile:string|null,body:string}[]} */([]);
 const sessions=new Map(); const answers=/** @type {string[]} */([]);
 // gone: profiles still listed whose home the OAuth routes no longer find (removed in between).
 const settings={created:/** @type {any[]} */([]),wait:0,gone:new Set()};
 const loggedIn=(name,provider)=>!!(profiles.get(name)?.store[provider]?.length||profiles.get('default')?.store[provider]?.length);
 const server=createServer((request,response)=>{
  let raw=''; request.on('data',chunk=>{ raw+=chunk; }); request.on('end',async()=>{
   const url=new URL(request.url||'/','http://fake'); const profile=url.searchParams.get('profile');
   requests.push({method:request.method||'',path:url.pathname,profile,body:raw});
   const send=(code,body)=>{ const text=JSON.stringify(body); answers.push(text); response.writeHead(code,{'Content-Type':'application/json'}); response.end(text); };
   if(request.headers.authorization!==`Bearer ${key}`) return send(401,{detail:'Unauthorized'});
   if(settings.wait) await new Promise(resolve=>setTimeout(resolve,settings.wait));
   if(url.pathname==='/api/profiles'&&request.method==='GET') return send(200,{profiles:[...profiles].map(([name,{description}])=>({name,description,is_default:name==='default'}))});
   if(url.pathname==='/api/profiles'&&request.method==='POST') {
    const body=JSON.parse(raw); settings.created.push(body);
    if(profiles.has(body.name)) return send(400,{detail:`Profile '${body.name}' already exists.`});
    profiles.set(body.name,{description:body.description||'',store:{}});
    return send(200,{ok:true,name:body.name,path:`/opt/data/profiles/${body.name}`});
   }
   const home=profile===null?'default':profile;
   if(!profiles.has(home)||settings.gone.has(home)) return send(404,{detail:`Profile '${home}' does not exist.`});
   const oauth=url.pathname.match(/^\/api\/providers\/oauth(?:\/([^/]+))?(?:\/(start|submit|poll)(?:\/([^/]+))?)?$/);
   if(url.pathname==='/api/providers/oauth'&&request.method==='GET') return send(200,{providers:['openai-codex','anthropic'].map(id=>({id,flow:id==='anthropic'?'external':'device_code',status:{logged_in:loggedIn(home,id),token_preview:loggedIn(home,id)?'...cret':null}}))});
   const cancel=url.pathname.match(/^\/api\/providers\/oauth\/sessions\/([^/]+)$/);
   if(cancel&&request.method==='DELETE') {
    const session=sessions.get(cancel[1]); if(!session) return send(200,{ok:false,message:'session not found'});
    if(session.profile!==profile) return send(400,{detail:'OAuth session profile mismatch'});
    session.status='cancelled'; sessions.delete(cancel[1]); return send(200,{ok:true,session_id:cancel[1]});
   }
   if(oauth&&oauth[2]==='start'&&request.method==='POST') {
    if(oauth[1]!=='openai-codex') return send(400,{detail:`${oauth[1]} uses an external CLI; run \`hermes auth add ${oauth[1]}\` manually`});
    const id=randomBytes(16).toString('base64url'); sessions.set(id,{profile,provider:oauth[1],status:'pending'});
    return send(200,{session_id:id,flow:'device_code',user_code:'WXYZ-4K8M',verification_url:'https://auth.openai.com/codex/device',expires_in:900,poll_interval:5});
   }
   if(oauth&&oauth[2]==='submit') return send(400,{detail:`submit not supported for ${oauth[1]}`});
   if(oauth&&oauth[2]==='poll'&&request.method==='GET') {
    const session=sessions.get(oauth[3]); if(!session) return send(404,{detail:'Session not found or expired'});
    if(session.profile!==profile) return send(400,{detail:'OAuth session profile mismatch'});
    return send(200,{session_id:oauth[3],status:session.status});
   }
   if(oauth&&!oauth[2]&&oauth[1]&&request.method==='DELETE') {
    const store=profiles.get(home)?.store||{};
    if(!store[oauth[1]]?.length) return send(409,{detail:'No stored credentials were removed.'});
    delete store[oauth[1]]; return send(200,{ok:true,provider:oauth[1]});
   }
   send(404,{detail:'Not Found'});
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(undefined)));
 const address=server.address(); const port=typeof address==='object'&&address?address.port:0;
 return {profiles,requests,sessions,answers,settings,managementAddress:`http://127.0.0.1:${port}`,
  // The person approves: Hermes's poller saves the credential in the profile the session was started for.
  approve() { for(const [id,session] of sessions) if(session.status==='pending') { session.status='approved'; const store=profiles.get(session.profile===null?'default':session.profile).store; store[session.provider]=[...(store[session.provider]||[]),`fake-subscription-secret-${randomUUID()}`]; sessions.delete(id); } },
  close:()=>new Promise(resolve=>{ server.closeAllConnections(); server.close(()=>resolve(undefined)); })};
}
const [a,b]=['10000000-0000-0000-0000-00000000000A','10000000-0000-0000-0000-00000000000b'];
const marker=(/** @type {string} */ company)=>`gtmworks company ${company.toLowerCase()}`;
const connect=fake=>({address:'',managementAddress:fake.managementAddress,key});

test('the company profile name comes from the company id only, within the Engine profile rules',()=>{
 const name=companyProfile(a);
 assert.equal(name,'company-1000000000000000000000000000000a');
 assert.match(String(name),/^[a-z0-9][a-z0-9_-]{0,63}$/);
 assert.notEqual(companyProfile(b),name);
 for(const wrong of ['../default','default','',null,'10000000-0000-0000-0000-00000000000','company-x']) assert.equal(companyProfile(/** @type {any} */(wrong)),null);
});

test('the web container reaches the management listener of a self-hosted install with the install key, and nothing else does',()=>{
 const env={GTMWORKS_SELF_HOSTED:'true',BUNDLED_HERMES_MANAGEMENT_URL:'http://hermes:9119',HERMES_API_KEY:'k'.repeat(64)};
 assert.deepEqual(bundledHermesManagement(env),{address:'',managementAddress:'http://hermes:9119',key:'k'.repeat(64)});
 assert.equal(bundledHermesManagement({...env,GTMWORKS_SELF_HOSTED:undefined}),null);
 assert.equal(bundledHermesManagement({...env,BUNDLED_HERMES_MANAGEMENT_URL:''}),null);
 assert.equal(bundledHermesManagement({...env,HERMES_API_KEY:''}),null);
});

test('an owner connects company A: the profile is made for A, the sign-in is scoped to it, and the credential lands there only',async()=>{
 const fake=await fakeManagement();
 try {
  const signIn=engineSignIn(connect(fake),a); const other=engineSignIn(connect(fake),b);
  const outcomes=[await signIn.state('openai-codex')];
  assert.deepEqual(outcomes[0],{state:'disconnected'});
  // Reading makes nothing: the profile is made on the first connect.
  assert.equal(fake.profiles.has(String(companyProfile(a))),false);
  outcomes.push(await signIn.start('openai-codex'));
  assert.deepEqual(outcomes[1],{state:'pending',link:'https://auth.openai.com/codex/device',code:'WXYZ-4K8M'});
  // The profile is new and empty: named for A, marked as A's, and never cloned from the default profile.
  assert.deepEqual(fake.settings.created,[{name:companyProfile(a),description:marker(a)}]);
  // A second connect shows the same sign-in and starts none.
  outcomes.push(await signIn.start('openai-codex'));
  assert.deepEqual(outcomes[2],outcomes[1]);
  assert.equal(fake.requests.filter(request=>request.path.endsWith('/start')).length,1);
  outcomes.push(await signIn.state('openai-codex'));
  assert.deepEqual(outcomes[3],outcomes[1]);
  fake.approve();
  outcomes.push(await signIn.state('openai-codex'),await other.state('openai-codex'));
  assert.deepEqual(outcomes.slice(4),[{state:'connected'},{state:'disconnected'}]);
  // The credential is in A's profile only: not in the default profile, and B has no profile at all.
  assert.equal(fake.profiles.get(String(companyProfile(a)))?.store['openai-codex'].length,1);
  assert.deepEqual(fake.profiles.get('default')?.store,{});
  assert.equal(fake.profiles.has(String(companyProfile(b))),false);
  // Every OAuth call named a profile, and only the company's own or the default (read to refuse a shared credential).
  const oauth=fake.requests.filter(request=>request.path.startsWith('/api/providers/'));
  assert.ok(oauth.length>0);
  for(const request of oauth) assert.ok([companyProfile(a),companyProfile(b),'default'].includes(request.profile),`${request.method} ${request.path} ${request.profile}`);
  for(const request of oauth.filter(request=>request.method!=='GET'||request.path!=='/api/providers/oauth')) assert.equal(request.profile,companyProfile(a));
  // Nothing handed back carries the credential, its preview or the Engine's session id.
  const secret=fake.profiles.get(String(companyProfile(a)))?.store['openai-codex'][0];
  const session=fake.answers.map(answer=>JSON.parse(answer).session_id).find(Boolean);
  assert.ok(secret&&session);
  for(const value of [secret,session,'...cret',key]) assert.doesNotMatch(JSON.stringify(outcomes),new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 } finally { await fake.close(); }
});

test('disconnect removes every ChatGPT credential of that profile with Hermes\'s removal, and a second one changes nothing',async()=>{
 const fake=await fakeManagement();
 try {
  const signIn=engineSignIn(connect(fake),a);
  await signIn.start('openai-codex'); fake.approve();
  fake.profiles.get(String(companyProfile(a)))?.store['openai-codex'].push('fake-subscription-secret-second');
  assert.deepEqual(await signIn.disconnect('openai-codex'),{state:'disconnected'});
  assert.deepEqual(fake.profiles.get(String(companyProfile(a)))?.store,{});
  assert.deepEqual(await signIn.state('openai-codex'),{state:'disconnected'});
  assert.deepEqual(fake.requests.filter(request=>request.method==='DELETE'&&!request.path.includes('/sessions/')).map(request=>[request.path,request.profile]),[['/api/providers/oauth/openai-codex',companyProfile(a)]]);
  // Nothing left to remove (Hermes answers 409) is still disconnected.
  assert.deepEqual(await signIn.disconnect('openai-codex'),{state:'disconnected'});
  // A company with no profile yet is disconnected without one being made.
  assert.deepEqual(await engineSignIn(connect(fake),b).disconnect('openai-codex'),{state:'disconnected'});
  assert.equal(fake.profiles.has(String(companyProfile(b))),false);
 } finally { await fake.close(); }
});

test('disconnect during a sign-in cancels that Engine session in the company profile',async()=>{
 const fake=await fakeManagement();
 try {
  const signIn=engineSignIn(connect(fake),a);
  await signIn.start('openai-codex');
  assert.equal(fake.sessions.size,1);
  assert.deepEqual(await signIn.disconnect('openai-codex'),{state:'disconnected'});
  assert.equal(fake.sessions.size,0);
  const cancelled=fake.requests.find(request=>request.path.startsWith('/api/providers/oauth/sessions/'));
  assert.equal(cancelled?.profile,companyProfile(a));
  fake.approve();
  assert.deepEqual(await signIn.state('openai-codex'),{state:'disconnected'});
 } finally { await fake.close(); }
});

test('a credential already in the company profile shows Connected, and connect keeps it without a new sign-in',async()=>{
 const fake=await fakeManagement();
 try {
  fake.profiles.set(String(companyProfile(a)),{description:marker(a),store:{'openai-codex':['fake-subscription-secret-pasted']}});
  const signIn=engineSignIn(connect(fake),a);
  assert.deepEqual(await signIn.state('openai-codex'),{state:'connected'});
  assert.deepEqual(await signIn.start('openai-codex'),{state:'connected'});
  assert.deepEqual(fake.profiles.get(String(companyProfile(a)))?.store,{'openai-codex':['fake-subscription-secret-pasted']});
  assert.equal(fake.requests.filter(request=>request.path.endsWith('/start')).length,0);
  assert.deepEqual(fake.settings.created,[]);
 } finally { await fake.close(); }
});

test('a credential in the default profile, which every profile would read, is never shown as the company\'s',async()=>{
 const fake=await fakeManagement();
 try {
  fake.profiles.get('default').store['openai-codex']=['fake-subscription-secret-shared'];
  const signIn=engineSignIn(connect(fake),a);
  assert.deepEqual(await signIn.state('openai-codex'),{state:'unavailable'});
  assert.deepEqual(await signIn.start('openai-codex'),{state:'unavailable'});
  assert.equal(fake.requests.filter(request=>request.path.endsWith('/start')).length,0);
  // Disconnect never removes the default profile's credential.
  assert.deepEqual(await signIn.disconnect('openai-codex'),{state:'unavailable'});
  assert.deepEqual(fake.profiles.get('default')?.store,{'openai-codex':['fake-subscription-secret-shared']});
  assert.equal(fake.requests.filter(request=>request.method==='DELETE'&&request.profile!==companyProfile(a)).length,0);
 } finally { await fake.close(); }
});

test('a profile with the company name that gtmworks did not make, or one the Engine does not know, is refused, never the default',async()=>{
 const fake=await fakeManagement();
 try {
  fake.profiles.set(String(companyProfile(a)),{description:'someone else',store:{'openai-codex':['fake-subscription-secret-foreign']}});
  const signIn=engineSignIn(connect(fake),a);
  for(const outcome of [await signIn.state('openai-codex'),await signIn.start('openai-codex'),await signIn.disconnect('openai-codex')]) assert.deepEqual(outcome,{state:'failed'});
  assert.equal(fake.requests.filter(request=>request.path.startsWith('/api/providers/')&&request.profile===companyProfile(a)).length,0);
  assert.deepEqual(fake.profiles.get(String(companyProfile(a)))?.store,{'openai-codex':['fake-subscription-secret-foreign']});
  // Listed but unknown to the OAuth routes (removed in between): Hermes answers 404 and the state is failed.
  fake.profiles.set(String(companyProfile(b)),{description:marker(b),store:{}});
  fake.settings.gone.add(String(companyProfile(b)));
  const listedOnly=engineSignIn(connect(fake),b);
  assert.deepEqual(await listedOnly.state('openai-codex'),{state:'failed'});
  assert.deepEqual(await listedOnly.start('openai-codex'),{state:'failed'});
  // No call ever went out without a profile.
  assert.equal(fake.requests.filter(request=>request.path.startsWith('/api/providers/')&&!request.profile).length,0);
 } finally { await fake.close(); }
});

test('Claude has no sign-in on the Engine listener: it is unavailable to connect, a stored one shows and is removed',async()=>{
 const fake=await fakeManagement();
 try {
  const signIn=engineSignIn(connect(fake),a);
  assert.deepEqual(await signIn.state('anthropic'),{state:'unavailable'});
  assert.deepEqual(await signIn.start('anthropic'),{state:'unavailable'});
  assert.deepEqual(await signIn.complete('anthropic','fake-authorization-code-7Q2P'),{state:'failed'});
  assert.equal(fake.requests.filter(request=>/\/(start|submit)$/.test(request.path)).length,0);
  assert.doesNotMatch(JSON.stringify(fake.requests),/fake-authorization-code/);
  fake.profiles.set(String(companyProfile(a)),{description:marker(a),store:{anthropic:['fake-subscription-secret-claude']}});
  assert.deepEqual(await signIn.state('anthropic'),{state:'connected'});
  assert.deepEqual(await signIn.disconnect('anthropic'),{state:'unavailable'});
  assert.deepEqual(fake.profiles.get(String(companyProfile(a)))?.store,{});
 } finally { await fake.close(); }
});

test('a wrong key, an address outside the allowed ones or an unknown provider fails without throwing',async()=>{
 const fake=await fakeManagement();
 try {
  const refused=engineSignIn({...connect(fake),key:'wrong'},a);
  for(const outcome of [await refused.state('openai-codex'),await refused.start('openai-codex'),await refused.disconnect('openai-codex')]) assert.deepEqual(outcome,{state:'failed'});
  const outside=engineSignIn({...connect(fake),managementAddress:'http://8.8.8.8:9119'},a);
  assert.deepEqual(await outside.state('openai-codex'),{state:'failed'});
  assert.deepEqual(await engineSignIn(connect(fake),a).start('gemini'),{state:'failed'});
  assert.deepEqual(await engineSignIn(connect(fake),'not-a-company').state('openai-codex'),{state:'failed'});
  assert.equal(fake.requests.filter(request=>request.path.startsWith('/api/providers/')).length,0);
 } finally { await fake.close(); }
});
