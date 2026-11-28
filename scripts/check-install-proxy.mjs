// CI runs this on stdin in a Node container on the install machine's network, twice: on the local install
// (APP_ORIGIN http://localhost:3000, straight to the gateway) and through an HTTPS proxy in front of the gateway, with
// APP_ORIGIN set to the proxy's public origin (README: a remote server). It goes the way a browser on that origin goes:
// first run with a password, straight to the Company home (issue #41); an Invite link that joins a new Person with no
// email, and a password reset whose emailed link returns to the app; and a sign-in request with a forged
// X-Forwarded-Host. Every redirect and link must stay on the public origin; one built from the request inside the
// install says http and breaks the browser (issue #40).
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

const origin=process.env.APP_ORIGIN, mail=process.env.MAIL_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service=process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(origin && mail,'APP_ORIGIN and MAIL_URL are set');
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
// The Auth link in the newest message to this address that was not read before (the inbox lists newest first).
const read=new Set();
async function emailedLink(email,what) {
 for(let attempt=0; attempt<30; attempt++) {
  const {messages=[]}=await (await fetch(`${mail}/api/v1/messages`)).json();
  const summary=messages.find(message=>!read.has(message.ID) && message.To.some(to=>to.Address===email));
  if(summary) {
   read.add(summary.ID);
   const message=await (await fetch(`${mail}/api/v1/message/${summary.ID}`)).json();
   const link=(message.HTML || message.Text).match(/https?:\/\/[^"\s<>]+/g)?.find(url=>url.includes('/verify'))?.replaceAll('&amp;','&');
   assert.ok(link,`the ${what} email has a link`);
   return link;
  }
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 assert.fail(`the ${what} email arrived`);
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

// An Invite link (#950, #953) joins a new Person with no email: the link's secret is made here, only its hash is kept
// through REST with the service role (as the app's own action does through make_invite_link), the page opens on the
// public origin, and its form makes the Person, the Member and a session. Opening the page uses nothing.
const slug=new URL(home.url).pathname.split('/')[2];
const restHeaders={apikey:service,authorization:`Bearer ${service}`};
const [company]=await (await fetch(`${origin}/rest/v1/companies?slug=eq.${encodeURIComponent(slug)}&select=id`,{headers:restHeaders})).json();
assert.ok(company?.id,`the Company ${slug} is read`);
const secret=randomBytes(32).toString('hex'), hash=createHash('sha256').update(secret).digest('hex');
const kept=await fetch(`${origin}/rest/v1/company_links`,{method:'POST',headers:{...restHeaders,'content-type':'application/json'},
 body:JSON.stringify({company_id:company.id,kind:'invite',secret_hash:hash,label:'Proxy Invitee',role:'contributor',ends_at:new Date(Date.now()+7*24*60*60*1000).toISOString()})});
assert.equal(kept.status,201,`the Invite link is kept (HTTP ${kept.status})`);
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

// A password reset as "Forgot password?" asks for one (implicit flow): its link returns to /auth/reset with the session
// in the fragment, and that page runs in the browser.
const reset=`${origin}/auth/reset`;
const recovered=await visit(`${origin}/auth/v1/recover?redirect_to=${encodeURIComponent(reset)}`,{method:'POST',
 headers:{apikey:anon,'content-type':'application/json'},body:JSON.stringify({email:owner.email})});
assert.equal(recovered.status,200,`Auth sends the reset link (HTTP ${recovered.status})`);
const resetLink=await emailedLink(owner.email,'reset');
assert.ok(onOrigin(resetLink),`the reset link is on ${origin}: ${resetLink}`);
assert.equal(new URL(resetLink).pathname,'/auth/v1/verify',`the reset link opens Auth behind the gateway: ${resetLink}`);
const opened=await visit(resetLink);
const landed=opened.headers.get('location') || '';
assert.ok(opened.status>=300 && opened.status<400 && onOrigin(landed),`the reset link ${resetLink} returns to ${origin}: ${landed}`);
assert.equal(landed.split('#')[0],reset,`the reset link returns to the reset page: ${landed}`);
assert.equal(new URLSearchParams(new URL(landed).hash.slice(1)).get('type'),'recovery','the reset link carries a recovery session');
assert.equal((await visit(reset)).status,200,'the reset page opens');
console.log(`Reset link returned to ${reset}`);

// A sign-in request whose client names another host: the emailed link still opens on APP_ORIGIN.
const forged=await visit(`${origin}/auth/v1/otp`,{method:'POST',
 headers:{apikey:anon,'content-type':'application/json','x-forwarded-host':'evil.example'},body:JSON.stringify({email:joiner.email,create_user:false})});
assert.equal(forged.status,200,`Auth sends the sign-in link (HTTP ${forged.status})`);
const signIn=await emailedLink(joiner.email,'forged sign-in');
assert.equal(new URL(signIn).origin,new URL(origin).origin,`the emailed sign-in link ignores the forged X-Forwarded-Host: ${signIn}`);
assert.ok(onOrigin(new URL(signIn).searchParams.get('redirect_to') || ''),`the emailed sign-in link returns to ${origin}: ${signIn}`);
console.log(`Sign-in link on ${origin} despite X-Forwarded-Host: evil.example`);
