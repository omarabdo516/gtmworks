// CI runs this on stdin inside /app in the installed web container, after the Agent check. It proves, on the pinned
// release and through the code the route uses (lib/subscription-sign-in.mjs), that a company's subscription sign-in
// runs in that company's own Engine profile on the management listener (ADR 0012): the profile is made for the
// company on its first connect, a scoped read of it is Not connected, Connected is not taken from the default profile,
// a profile the Engine does not know is refused, disconnect is idempotent and a second company stays independent.
// Starting the ChatGPT sign-in asks OpenAI for a device code: when the Engine itself gets one, the answer must carry an
// https link and the code; when the Engine itself cannot reach OpenAI, gtmworks's answer must be failed, not pending.
// It prints states and names only, never the key, a code or a session id.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
const {signInFor}=await import(`${process.cwd()}/lib/subscription-sign-in.mjs`);
const {companyProfile}=await import(`${process.cwd()}/lib/hermes.mjs`);

const key=process.env.HERMES_API_KEY; const listener=process.env.BUNDLED_HERMES_MANAGEMENT_URL;
assert.ok(key,'the install key is in the web container');
assert.equal(listener,'http://hermes:9119');
const call=async(path,method='GET')=>{
 const response=await fetch(`${listener}${path}`,{method,headers:{Authorization:`Bearer ${key}`},redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
 return {status:response.status,body:await response.json().catch(()=>null)};
};
const scoped=(path,profile)=>`${path}?profile=${encodeURIComponent(profile)}`;
const [a,b]=[randomUUID(),randomUUID()]; const [profileA,profileB]=[companyProfile(a),companyProfile(b)];
const profiles=async()=>(await call('/api/profiles')).body?.profiles||[];

// The default profile holds no ChatGPT credential here, so a company's state is its own profile's.
const defaults=await call(scoped('/api/providers/oauth','default'));
assert.equal(defaults.status,200);
assert.equal(defaults.body.providers.find(provider=>provider.id==='openai-codex')?.status?.logged_in,false);

const signIn=signInFor(a); const other=signInFor(b);
assert.equal(signIn?.kind,'engine','the web app uses the bundled Engine');
const before={chatgpt:(await signIn.state('openai-codex')).state,claude:(await signIn.state('anthropic')).state};
assert.deepEqual(before,{chatgpt:'disconnected',claude:'unavailable'});
assert.equal((await profiles()).some(profile=>profile.name===profileA),false,'a read makes no profile');

const started=await signIn.start('openai-codex');
const made=(await profiles()).find(profile=>profile.name===profileA);
assert.equal(made?.description,`gtmworks company ${a}`,'the company profile is made on connect and marked as the company\'s');
let signInStarted;
if(started.state==='pending') {
 assert.match(started.link,/^https:\/\/\S+$/);
 assert.match(started.code,/^[A-Za-z0-9-]{4,32}$/);
 assert.deepEqual(Object.keys(started).sort(),['code','link','state']);
 signInStarted='pending';
} else {
 assert.equal(started.state,'failed');
 // Only when the Engine itself cannot start it: asked directly, scoped to the same profile, it fails as well.
 const direct=await call(scoped('/api/providers/oauth/openai-codex/start',profileA),'POST');
 if(direct.status===200&&direct.body?.session_id) await call(scoped(`/api/providers/oauth/sessions/${encodeURIComponent(direct.body.session_id)}`,profileA),'DELETE');
 assert.notEqual(direct.status,200,'the Engine started a sign-in that gtmworks reported as failed');
 signInStarted=`engine could not reach the provider (HTTP ${direct.status})`;
}
// The company's own profile, read with its scope, is not signed in; one the Engine does not know is refused.
const own=await call(scoped('/api/providers/oauth',profileA));
assert.equal(own.status,200);
assert.equal(own.body.providers.find(provider=>provider.id==='openai-codex')?.status?.logged_in,false);
assert.equal((await call(scoped('/api/providers/oauth',`company-${randomBytes(16).toString('hex')}`))).status,404);

const disconnected=[(await signIn.disconnect('openai-codex')).state,(await signIn.disconnect('openai-codex')).state];
assert.deepEqual(disconnected,['disconnected','disconnected']);
assert.equal((await signIn.state('openai-codex')).state,'disconnected');
// The second company has its own state and no profile until it connects.
assert.equal((await other.state('openai-codex')).state,'disconnected');
assert.equal((await profiles()).some(profile=>profile.name===profileB),false);
// The wrong key is refused.
const {engineSignIn}=await import(`${process.cwd()}/lib/hermes.mjs`);
assert.equal((await engineSignIn({address:'',managementAddress:listener,key:randomBytes(32).toString('hex')},a).state('openai-codex')).state,'failed');
console.log(JSON.stringify({profile:profileA,before,signIn:signInStarted,disconnected,other:profileB}));
