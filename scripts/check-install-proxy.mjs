// CI runs this on stdin in a Node container on the install machine's network, through an HTTPS proxy in front of the
// gateway, with APP_ORIGIN set to the proxy's public origin (README: a remote server). It goes the way a browser on that
// origin goes: first run, the emailed sign-in link, then the Company home. Every redirect and link must stay on the
// public origin; one built from the request inside the install says http and breaks the browser (issue #40).
import assert from 'node:assert/strict';

const origin=process.env.APP_ORIGIN, mail=process.env.MAIL_URL;
assert.ok(origin && mail,'APP_ORIGIN and MAIL_URL are set');
const owner={name:'Proxy Owner',email:'proxy-owner@example.com',company:'Proxy Company',language:'en'};
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

const start=await follow(`${origin}/first-run`);
assert.equal(start.response.status,200,'first run opens on an empty install');
const sent=await follow(`${origin}/first-run/submit`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(owner).toString()});
assert.equal(new URL(sent.url).pathname,'/sign-in');
assert.equal(new URL(sent.url).searchParams.get('message'),'sent',sent.url);
assert.equal(sent.response.status,200);

let link='';
for(let attempt=0; attempt<30 && !link; attempt++) {
 const {messages=[]}=await (await fetch(`${mail}/api/v1/messages`)).json();
 const summary=messages.find(message=>message.To.some(to=>to.Address===owner.email));
 if(summary) {
  const message=await (await fetch(`${mail}/api/v1/message/${summary.ID}`)).json();
  link=(message.HTML || message.Text).match(/https?:\/\/[^"\s<>]+/g)?.find(url=>url.includes('/verify'))?.replaceAll('&amp;','&') || '';
 }
 if(!link) await new Promise(resolve=>setTimeout(resolve,1000));
}
assert.ok(link,'the sign-in email arrived with a link');
assert.ok(onOrigin(link),`the emailed link is on ${origin}: ${link}`);
assert.ok(onOrigin(new URL(link).searchParams.get('redirect_to') || ''),`the emailed link returns to ${origin}: ${link}`);

const home=await follow(link);
assert.match(new URL(home.url).pathname,/^\/c\/[^/]+\/home$/,home.url);
assert.equal(home.response.status,200);
assert.ok((await home.response.text()).includes(owner.company),'the Company home names the company');
console.log(`Reached ${home.url}`);
