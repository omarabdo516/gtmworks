// CI runs this on stdin inside /app in the installed web container, after check-install-profiles.mjs prepare, on the
// pinned Hermes release (#30, #458). It starts a small MCP server inside this container, on the Engine's own network, so
// the Engine can reach it by this service's name (`web`, port 9123); then it proves the three sign-in kinds of the
// Owner's own tool end to end through the gtmworks driver: added, tested (tools listed), on for one Agent profile, read
// back through the Engine with no tools.include, and removed. It also proves a catalogue app connects with no tool filter.
// A token never appears in a profile's config or in the output. It prints states only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const port=Number(process.env.FAKE_MCP_PORT||9123);
const host=process.env.FAKE_MCP_HOST||'web';
const publicUrl=process.env.FAKE_MCP_PUBLIC||`http://${host}:${port}`;
const token='check-install-token-value';
const oauthToken='check-install-oauth-token';
const codes=new Map();
const json=(response,status,body,headers={})=>{ response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers}); response.end(JSON.stringify(body)); };
const readBody=request=>new Promise(resolve=>{ let raw=''; request.on('data',chunk=>{raw+=chunk;}); request.on('end',()=>resolve(raw)); });
const origin=request=>`http://${request.headers.host||host+':'+port}`;
const bearer=request=>{ const value=String(request.headers.authorization||''); return value.startsWith('Bearer ')?value.slice(7):''; };

// A streamable HTTP MCP server: initialize, tools/list and tools/call. The token kind wants this script's token and the
// OAuth kind wants a token it issued; both answer 401 with the protected-resource metadata address, as the Python client
// expects. The OAuth kind also serves protected-resource and authorization-server metadata, dynamic client registration,
// authorize (a 302 with a code) and token.
const mcp=createServer(async(request,response)=>{
 try {
  const url=new URL(request.url,origin(request));
  const path=url.pathname;
  if(request.method==='GET'&&(path==='/'||path==='/health')) return json(response,200,{ok:true});
  if(path.includes('oauth-protected-resource')) {
   const suffix=path.replace(/^.*oauth-protected-resource/,'');
   return json(response,200,{resource:publicUrl+(suffix||'/oauth/mcp'),authorization_servers:[publicUrl]});
  }
  if(path.includes('oauth-authorization-server')||path.includes('openid-configuration')) {
   return json(response,200,{issuer:publicUrl,authorization_endpoint:`${publicUrl}/authorize`,token_endpoint:`${publicUrl}/token`,registration_endpoint:`${publicUrl}/register`,
    response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none','client_secret_post']});
  }
  if(path==='/register'&&request.method==='POST') {
   const body=JSON.parse(await readBody(request)||'{}');
   return json(response,201,{client_id:'check-client',client_secret:'check-secret',redirect_uris:Array.isArray(body.redirect_uris)?body.redirect_uris:[],token_endpoint_auth_method:'client_secret_post'});
  }
  if(path==='/authorize'&&request.method==='GET') {
   const code=randomUUID(); codes.set(code,{challenge:url.searchParams.get('code_challenge'),redirect:url.searchParams.get('redirect_uri')});
   const back=new URL(String(url.searchParams.get('redirect_uri')));
   back.searchParams.set('code',code); if(url.searchParams.get('state')) back.searchParams.set('state',String(url.searchParams.get('state')));
   response.writeHead(302,{Location:back.href}); return response.end();
  }
  if(path==='/token'&&request.method==='POST') {
   const form=new URLSearchParams(await readBody(request));
   if(form.get('grant_type')==='refresh_token') return json(response,200,{access_token:oauthToken,token_type:'Bearer',expires_in:3600,refresh_token:'check-refresh'});
   const granted=codes.get(String(form.get('code')||'')); if(!granted) return json(response,400,{error:'invalid_grant'});
   codes.delete(String(form.get('code'))); return json(response,200,{access_token:oauthToken,token_type:'Bearer',expires_in:3600,refresh_token:'check-refresh'});
  }
  if(request.method!=='POST') { response.writeHead(405); return response.end(); }
  // Three servers on one port: the token kind, the OAuth kind, and one with no sign-in.
  const kind=path.startsWith('/token/')?'token':path.startsWith('/oauth/')?'oauth':'none';
  if(kind==='token'&&bearer(request)!==token) return json(response,401,{error:'unauthorized'},{'WWW-Authenticate':`Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource${path}"`});
  if(kind==='oauth'&&bearer(request)!==oauthToken) return json(response,401,{error:'unauthorized'},{'WWW-Authenticate':`Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource${path}"`});
  const body=JSON.parse(await readBody(request)||'{}');
  const answer=(result)=>({jsonrpc:'2.0',id:body.id,result});
  if(body.method==='initialize') return json(response,200,answer({protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'check-mcp',version:'1.0.0'}}),{'Mcp-Session-Id':'check-session'});
  if(String(body.method||'').startsWith('notifications/')) { response.writeHead(202); return response.end(); }
  if(body.method==='tools/list') return json(response,200,answer({tools:[{name:'echo',description:'Echo the text',inputSchema:{type:'object',properties:{text:{type:'string'}}}}]}),{'Mcp-Session-Id':'check-session'});
  if(body.method==='tools/call') return json(response,200,answer({content:[{type:'text',text:String(body.params?.arguments?.text||'')}],isError:false}),{'Mcp-Session-Id':'check-session'});
  return json(response,200,answer({}));
 } catch { try { response.writeHead(500); response.end(); } catch {} }
});
await new Promise((resolve,reject)=>{ mcp.once('error',reject); mcp.listen(port,'0.0.0.0',resolve); });

const key=process.env.ENGINE_KEY;
assert.ok(key,'the install key is in the web container');
const [{profile}]=JSON.parse(readFileSync('/tmp/check-install-profiles.json','utf8'));
const target={address:process.env.HERMES_ADDRESS||'http://gtmworks-engine-first:8642',managementAddress:process.env.HERMES_MANAGEMENT_ADDRESS||'http://gtmworks-engine-first:9119',profile,key};
const {prepareApp,prepareServer,startAppSignIn,finishAppSignIn,testServer,disconnectApp,readApps}=await import(`${process.cwd()}/lib/engine/apps.mjs`);
const {appUrl}=await import(`${process.cwd()}/lib/app-origin.mjs`);
async function manageAt(path,init={}) {
 const response=await fetch(`${target.managementAddress}${path}${path.includes('?')?'&':'?'}profile=${encodeURIComponent(profile)}`,{...init,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(init.headers||{})}});
 return {status:response.status,body:await response.json().catch(()=>null)};
}
const servers=async()=>(await manageAt('/api/config?include_defaults=false')).body?.mcp_servers||{};
const stateOf=async name=>(await readApps(target)).apps?.find(app=>app.key===name)?.state;
const back=key=>appUrl(`/api/apps/callback/${key}`).href;
const oauthStep=async url=>{
 const started=await fetch(url,{redirect:'manual'});
 const location=started.headers.get('location'); assert.ok(location,'the authorize page sends the browser back');
 const answer=new URL(location); return {code:answer.searchParams.get('code'),state:answer.searchParams.get('state')};
};

// A catalogue app: installed, turned on with its way back, and no tool filter (ADR 0020).
const listed=await readApps(target);
assert.equal(listed.state,'found');
assert.equal(listed.apps.filter(app=>app.source==='engine').length,66,'every entry of the pinned Engine catalogue is offered');
assert.ok(listed.apps.some(app=>app.key==='klaviyo'),'a catalogue app is offered');
assert.equal(await prepareApp(target,'klaviyo',back('klaviyo')),null,'klaviyo installed and turned on');
const catalogue=await servers();
assert.equal('tools' in catalogue.klaviyo,false,'connecting writes no tools.include');
assert.equal(catalogue.klaviyo.oauth?.redirect_uri,back('klaviyo'),'the sign-in comes back through gtmworks');
assert.equal(await stateOf('klaviyo'),'attention','on, but not signed in');
assert.deepEqual(await finishAppSignIn(target,{key:'klaviyo',flow:'install-check-unknown-flow',answer:{code:'bogus',state:'bogus'}}),{state:'expired'});
assert.deepEqual(await disconnectApp(target,'klaviyo'),{state:'disconnected'});

// The Owner's own tool: no sign-in, a token, and OAuth, each added to the one Agent profile, tested, read back and removed.
const kinds=[
 {key:'check-none',kind:'none',url:`${publicUrl}/none/mcp`},
 {key:'check-token',kind:'header',url:`${publicUrl}/token/mcp`,token},
 {key:'check-oauth',kind:'oauth',url:`${publicUrl}/oauth/mcp`},
];
for(const given of kinds) {
 assert.equal(await prepareServer(target,{key:given.key,url:given.url,auth:given.kind,token:given.token,redirectUri:given.kind==='oauth'?back(given.key):undefined}),null,`${given.key} added`);
 if(given.kind==='oauth') {
  const started=await startAppSignIn(target,given.key,back(given.key),{url:given.url,auth:'oauth'});
  assert.equal(started.state,'started',`${given.key} starts a sign-in`);
  const answer=await oauthStep(started.url);
  assert.deepEqual(await finishAppSignIn(target,{key:given.key,flow:started.flow,answer}),{state:'approved'},`${given.key} connects through gtmworks`);
  assert.equal(await stateOf(given.key),'connected');
 }
 const tested=await testServer(target,given.key);
 assert.equal(tested.state,'connected',`${given.key} answers`);
 assert.deepEqual(tested.tools,['echo'],`${given.key} lists its tool`);
 const read=await servers();
 assert.equal('tools' in read[given.key],false,`${given.key} carries no tool filter`);
 assert.equal(JSON.stringify(read).includes(token),false,`${given.key}: the token is not in the profile config`);
 assert.equal(await stateOf(given.key),'connected',`${given.key} is on for its Agent`);
 assert.deepEqual(await disconnectApp(target,given.key),{state:'disconnected'},`${given.key} removed`);
 assert.equal((await servers())[given.key],undefined,`${given.key} left the profile`);
}
assert.equal(JSON.stringify(await servers()).includes(token),false,'no token in any profile config');

mcp.close();
console.log(JSON.stringify({profile,catalogue:'no tool filter; way back; unknown way back expired; disconnected',own:kinds.map(given=>`${given.key}: added, tested, on, read back, removed`)}));
