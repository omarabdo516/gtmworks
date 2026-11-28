// CI runs this on stdin in a Node container on the install machine's network, twice: on the local install
// (APP_ORIGIN http://localhost:3000, straight to the gateway) and through an HTTPS proxy in front of the gateway, with
// APP_ORIGIN set to the proxy's public origin (README: a remote server). It goes the way a browser on that origin goes:
// first run with a password, straight to the Company home (issue #41); and an Invite link that joins a new Person with
// no email (a forgotten password is a password link from an Administrator or a Manager, #954; the install sends no email
// at all, #948). Every redirect and link must stay on the public origin; one built from the request inside the install
// says http and breaks the browser (issue #40).
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

const origin=process.env.APP_ORIGIN;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service=process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(origin,'APP_ORIGIN is set');
assert.ok(anon && service,'NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are set');
const owner={name:'Proxy Owner',email:'proxy-owner@example.com',company:'Proxy Company',language:'en',password:'proxy-owner-password',confirm:'proxy-owner-password'};
const onOrigin=url=>url===origin || url.startsWith(`${origin}/`);
const cookies=new Map();

async function visit(url,init={}) {
 assert.ok(onOrigin(url),`stays on ${origin}: ${url}`);
 const response=await fetch(url,{...init,redirect:'manual',headers:{...init.headers,cookie:[...cookies].map(([name,value])=>`${name}=${value}`).join('; ')}});
 for(const line of response.headers.getSetCookie()) {
  const [pair]=line.split(';'), at=pair.indexOf('='), name=pair.slice(0,at).trim(), value=pair.slice(at+1);
  if(!value || /max-age=0\b/i.test(line)) cookies.delete(name); else cookies.set(name,value);
 }
 return response;
}
// Follows redirects as a browser does. A Location the app writes in full must name the public origin itself.
async function follow(url,init) {
 let response=await visit(url,init);
 for(let hops=0; response.status>=300 && response.status<400; hops++) {
  assert.ok(hops<10,'too many redirects');
  const location=response.headers.get('location');
  assert.ok(location,`redirect from ${url} has a Location`);
  if(/^[a-z][a-z0-9+.-]*:/i.test(location)) assert.ok(onOrigin(location),`redirect from ${url} stays on ${origin}: ${location}`);
  url=new URL(location,url).href;
  response=await visit(url);
 }
 return {response,url};
}
// First run opens only through the setup link the installer printed (issue #50). Its code is in the link's fragment,
// which no request carries, so the server's page has no form; the browser shows it from the fragment
// (tests/first-run.spec.ts). Here the code goes only in the submit body, and without it, or with a wrong one, a
// submission is refused.
const code=process.env.SETUP_CODE;
assert.ok(code,'SETUP_CODE is set');
const submit=values=>follow(`${origin}/first-run/submit`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values).toString()});
const closed=await follow(`${origin}/first-run`);
assert.equal(closed.response.status,200,'first run answers on an empty install');
assert.ok(!(await closed.response.text()).includes('name="company"'),'first run without the setup code shows no form');
for(const values of [owner,{...owner,code:'0'.repeat(63)+'1'}]) {
 assert.equal((await submit(values)).response.status,403,`a submission ${values.code?'with a wrong':'without the'} setup code is refused`);
}
// First run signs the Owner in with the password just chosen: no email step.
const home=await submit({...owner,code});
assert.match(new URL(home.url).pathname,/^\/c\/[^/]+\/home$/,`first run reached ${home.url}`);
assert.equal(home.response.status,200,`first run reached ${home.url}`);
assert.ok((await home.response.text()).includes(owner.company),'the Company home names the company');
console.log(`Reached ${home.url}`);
assert.equal((await submit({...owner,email:'second-owner@example.com',code})).response.status,404,'a second submission with the setup code is refused');

// An Invite link (#950, #953) joins a new Person with no email: the first run's Administrator signs in with a password,
// first run's own make_invite_links makes the link with that session and keeps only its hash, the page opens on the
// public origin, and its form makes the Person, the Member and a session. An older release has no link table yet: its
// first run is checked without this step, and no email is sent by this script either way.
const restHeaders={apikey:service,authorization:`Bearer ${service}`};
const linksTable=await fetch(`${origin}/rest/v1/company_links?select=id&limit=1`,{headers:restHeaders});
if(linksTable.ok) {
 const slug=new URL(home.url).pathname.split('/')[2];
 const [company]=await (await fetch(`${origin}/rest/v1/companies?slug=eq.${encodeURIComponent(slug)}&select=id`,{headers:restHeaders})).json();
 assert.ok(company?.id,`the Company ${slug} is read`);
 const signedIn=await fetch(`${origin}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:anon,'content-type':'application/json'},body:JSON.stringify({email:owner.email,password:owner.password})});
 assert.equal(signedIn.status,200,`the Administrator signs in with a password (HTTP ${signedIn.status})`);
 const {access_token:ownerToken}=await signedIn.json();
 assert.ok(ownerToken,'the Administrator has a session');
 const secret=randomBytes(32).toString('hex'), hash=createHash('sha256').update(secret).digest('hex');
 const made=await fetch(`${origin}/rest/v1/rpc/make_invite_links`,{method:'POST',headers:{apikey:anon,authorization:`Bearer ${ownerToken}`,'content-type':'application/json'},
  body:JSON.stringify({c:company.id,labels:['Proxy Invitee'],link_roles:['contributor'],hashes:[hash]})});
 assert.equal(made.status,200,`first run's Administrator makes an Invite link (HTTP ${made.status})`);
 assert.equal((await visit(`${origin}/join`)).status,200,'the join page opens');
 const joiner={name:'Proxy Invitee',email:'proxy-joined@example.com',password:'proxy-joined-password'};
 const joined=await visit(`${origin}/join/submit`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({...joiner,confirm:joiner.password,code:secret,language:'en'}).toString()});
 assert.equal(joined.status,303,`the Invite link joins (HTTP ${joined.status})`);
 const joinedAt=joined.headers.get('location') || '';
 assert.ok(onOrigin(joinedAt),`the joined Person lands on ${origin}: ${joinedAt}`);
 assert.match(new URL(joinedAt).pathname,/^\/c\/[^/]+\/home$/,`the joined Person lands in the Company: ${joinedAt}`);
 const [used]=await (await fetch(`${origin}/rest/v1/company_links?secret_hash=eq.${hash}&select=used_at`,{headers:restHeaders})).json();
 assert.ok(used?.used_at,'the Invite link is kept marked used');
 console.log(`Invite link joined ${joiner.email} in ${joinedAt}`);
} else {
 assert.equal(linksTable.status,404,`the Invite link table is read (HTTP ${linksTable.status})`);
 console.log('Invite links: not in this release');
}
