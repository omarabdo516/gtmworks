// CI runs this on stdin in a Node container on the install machine's network, twice: on the local install
// (APP_ORIGIN http://localhost:3000, straight to the gateway) and through an HTTPS proxy in front of the gateway, with
// APP_ORIGIN set to the proxy's public origin (README: a remote server). It goes the way a browser on that origin goes:
// first run with a password, straight to the Company home (issue #41); an invitation, whose emailed link returns to the
// app; and a sign-in request with a forged X-Forwarded-Host. Every redirect and link must stay on the public origin; one
// built from the request inside the install says http and breaks the browser (issue #40).
import assert from 'node:assert/strict';

const origin=process.env.APP_ORIGIN, mail=process.env.MAIL_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service=process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(origin && mail,'APP_ORIGIN and MAIL_URL are set');
assert.ok(anon && service,'NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are set');
const owner={name:'Proxy Owner',email:'proxy-owner@example.com',company:'Proxy Company',language:'en',password:'proxy-owner-password',confirm:'proxy-owner-password'};
const invitee='proxy-invitee@example.com';
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

// An invitation as the members page sends one (inviteUserByEmail with the service role key). Auth answers its link with
// a redirect to /auth/accept, the session in the fragment; that page then runs in the browser, which this client is not.
const slug=new URL(home.url).pathname.split('/')[2];
const accept=`${origin}/auth/accept?next=${encodeURIComponent(`/c/${slug}/settings/members`)}`;
const invited=await visit(`${origin}/auth/v1/invite?redirect_to=${encodeURIComponent(accept)}`,{method:'POST',
 headers:{apikey:service,authorization:`Bearer ${service}`,'content-type':'application/json'},body:JSON.stringify({email:invitee})});
assert.equal(invited.status,200,`Auth sends the invitation (HTTP ${invited.status})`);
const invitation=await emailedLink(invitee,'invitation');
assert.ok(onOrigin(invitation),`the invitation link is on ${origin}: ${invitation}`);
assert.equal(new URL(invitation).pathname,'/auth/v1/verify',`the invitation link opens Auth behind the gateway: ${invitation}`);
const verified=await visit(invitation);
const returned=verified.headers.get('location') || '';
assert.ok(verified.status>=300 && verified.status<400 && onOrigin(returned),`the invitation link ${invitation} returns to ${origin}: ${returned}`);
const back=new URL(returned);
assert.equal(`${back.origin}${back.pathname}`,`${new URL(origin).origin}/auth/accept`,`the invitation link returns to the accept page: ${returned}`);
assert.equal(back.searchParams.get('next'),`/c/${slug}/settings/members`,`the invitation link keeps its next page: ${returned}`);
assert.ok(new URLSearchParams(back.hash.slice(1)).get('access_token'),'the invitation link signs the invitee in');
assert.equal((await visit(returned.split('#')[0])).status,200,'the accept page opens');
console.log(`Invitation returned to ${accept}`);

// A sign-in request whose client names another host: the emailed link still opens on APP_ORIGIN.
const forged=await visit(`${origin}/auth/v1/otp`,{method:'POST',
 headers:{apikey:anon,'content-type':'application/json','x-forwarded-host':'evil.example'},body:JSON.stringify({email:invitee,create_user:false})});
assert.equal(forged.status,200,`Auth sends the sign-in link (HTTP ${forged.status})`);
const signIn=await emailedLink(invitee,'forged sign-in');
assert.equal(new URL(signIn).origin,new URL(origin).origin,`the emailed sign-in link ignores the forged X-Forwarded-Host: ${signIn}`);
assert.ok(onOrigin(new URL(signIn).searchParams.get('redirect_to') || ''),`the emailed sign-in link returns to ${origin}: ${signIn}`);
console.log(`Sign-in link on ${origin} despite X-Forwarded-Host: evil.example`);
