import { designProfileOf } from '../open-design.mjs';
import { accountId } from '../provider-names.mjs';
import { servedListOf, readServedModels, keepServed } from '../served-models.mjs';
import { revealEnv } from './agents.mjs';
import { designProfiles } from './apps.mjs';
import { spaceName } from './skills.mjs';
import { agentName, manage, query, reachable, refusal, stepState } from './wire.mjs';

// A Company's model sign-in lives on the root profile of its own Engine (#384, ADR 0018), which the driver is given as
// `default`; the Engine lends it to every Agent profile of that Company with none of its own. Hermes runs the sign-in;
// gtmworks passes on only whether each provider is connected, and for a device-code sign-in the code and the https
// link the person opens. No credential, token preview or Hermes error text ever leaves the driver.
export const signInProviders=['openai-codex','anthropic'];
const signInState=['pending','approved','denied','expired','error','cancelled'];
const sessionId=/^[\w-]{8,128}$/;
// Hermes lets a profile with no credential of its own for a provider use the default (root) profile's, and reports it
// as logged in either way: the status names no source and no setting turns the fallback off (hermes_cli/auth.py,
// read_credential_pool and _load_provider_state, v0.23.0). So both are read: `root` says the root profile holds the
// provider's sign-in, and `connected` says the profile asked about holds one of its own. The root itself holds it.
// A status read from an environment key (source `env_var`: Claude's ANTHROPIC_API_KEY, web_server_oauth.py 58-72) is a
// provider key, never a sign-in (#438). And Claude's status never reads the credential pool, where
// `hermes auth add anthropic --type oauth` (the install's `gtmworks sign-in claude`) keeps the subscription, so the
// root's pool is read too (GET /api/credentials/pool, web_routers/ops.py 351-377): an `oauth` row there is the root's
// sign-in, unless the Engine seeded it from outside its own store (an `env:` token, the host's `claude_code` login,
// credential_pool.py 2545-2595), which no Disconnect removes. Only each row's provider, type and source are looked at.
/** @param {any} connection */
export async function readSignIns(connection) {
 if(!agentName.test(connection.profile)) return {state:'failed',signIns:null};
 if(!reachable(connection)) return {state:'unreachable',signIns:null};
 const onRoot=connection.profile==='default';
 try {
  const [own,root,pool]=await Promise.all([onRoot?null:manage(connection,`/api/providers/oauth${query(connection.profile)}`),
   manage(connection,'/api/providers/oauth'),manage(connection,'/api/credentials/pool')]);
  for(const listed of [own,root,pool]) {
   if(!listed) continue;
   if(!listed.response.ok) return {state:refusal(listed.response),signIns:null};
   if(!Array.isArray(listed.result?.providers)) return {state:'failed',signIns:null};
  }
  const loggedIn=(listed,id)=>{ const status=listed.result.providers.find(found=>found?.id===id)?.status; return status?.logged_in===true&&status.source!=='env_var'; };
  const pooled=id=>pool.result.providers.some(found=>found?.provider===id&&Array.isArray(found.entries)&&found.entries.some(entry=>entry?.auth_type==='oauth'&&typeof entry.source==='string'&&!entry.source.startsWith('env:')&&entry.source!=='claude_code'));
  const signIns=Object.fromEntries(signInProviders.map(id=>{
   const provider=own?.result.providers.find(found=>found?.id===id)??root.result.providers.find(found=>found?.id===id);
   const atRoot=loggedIn(root,id)||pooled(id);
   return [id,{connected:onRoot?atRoot:!atRoot&&loggedIn(own,id),root:atRoot,flow:provider?.flow==='device_code'?'device_code':'external'}];
  }));
  return {state:'found',signIns};
 } catch { return {state:'unreachable',signIns:null}; }
}
const noSignIn=state=>({state,session:null,code:null,link:null,expiresIn:null,interval:null});
// The root profile is asked with no profile at all, as readSignIns reads it: Hermes takes an empty profile for its root
// (v0.23.0 web_server_oauth.py 153, _oauth_profile_name), and a session answers only under the profile it started
// under (web_routers/oauth.py 921 poll, 975 cancel).
const signInScope=connection=>connection.profile==='default'?'':query(connection.profile);
/** @param {any} connection @param {string} provider */
export async function startSignIn(connection,provider) {
 if(!signInProviders.includes(provider)||!agentName.test(connection.profile)) return noSignIn('failed');
 if(!reachable(connection)) return noSignIn('unreachable');
 try {
  const started=await manage(connection,`/api/providers/oauth/${encodeURIComponent(provider)}/start${signInScope(connection)}`,{method:'POST'});
  // A provider Hermes signs in only from its own command line (Claude, in the pinned release).
  if(started.response.status===400&&typeof started.result?.detail==='string'&&started.result.detail.includes('external CLI')) return noSignIn('terminal_only');
  if(!started.response.ok) return noSignIn(stepState(started));
  const {session_id:session,user_code:code,verification_url:link,expires_in:expiresIn,poll_interval:interval}=started.result||{};
  let url=null; try { url=new URL(link); } catch { url=null; }
  if(typeof session!=='string'||!sessionId.test(session)||typeof code!=='string'||!/^[A-Za-z0-9-]{4,32}$/.test(code)||url?.protocol!=='https:'||url.username||url.password) return noSignIn('failed');
  const seconds=(value,fallback,most)=>Number.isSafeInteger(value)&&value>0?Math.min(value,most):fallback;
  return {state:'started',session,code,link:url.href,expiresIn:seconds(expiresIn,900,3600),interval:seconds(interval,5,60)};
 } catch { return noSignIn('unreachable'); }
}
/** @param {any} connection @param {string} provider @param {string} session */
export async function pollSignIn(connection,provider,session) {
 if(!signInProviders.includes(provider)||!agentName.test(connection.profile)||typeof session!=='string'||!sessionId.test(session)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const polled=await manage(connection,`/api/providers/oauth/${encodeURIComponent(provider)}/poll/${encodeURIComponent(session)}${signInScope(connection)}`);
  // A session Hermes no longer knows (expired, cancelled, or after a restart) can never finish.
  if(polled.response.status===404) return {state:'expired'};
  if(!polled.response.ok) return {state:stepState(polled)};
  return {state:signInState.includes(polled.result?.status)?polled.result.status:'failed'};
 } catch { return {state:'unreachable'}; }
}
/** @param {any} connection @param {string} session */
export async function cancelSignIn(connection,session) {
 if(!agentName.test(connection.profile)||typeof session!=='string'||!sessionId.test(session)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const cancelled=await manage(connection,`/api/providers/oauth/sessions/${encodeURIComponent(session)}${signInScope(connection)}`,{method:'DELETE'});
  return {state:cancelled.response.ok?'cancelled':stepState(cancelled)};
 } catch { return {state:'unreachable'}; }
}
// Disconnect removes the provider's credential from this profile's home only, its pool rows with it (v0.23.0 auth.py
// 1359-1378, clear_provider_auth). `nothing`: the profile held none of its own (409, web_routers/oauth.py 774-815), or the Engine
// serves no such profile (404).
/** @param {any} connection @param {string} provider */
export async function disconnectSignIn(connection,provider) {
 if(!signInProviders.includes(provider)||!agentName.test(connection.profile)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const removed=await manage(connection,`/api/providers/oauth/${encodeURIComponent(provider)}${signInScope(connection)}`,{method:'DELETE'});
  if(removed.response.ok&&removed.result?.ok===true) return {state:'disconnected'};
  // An Agent's profile whose Claude is its API key is refused (oauth.py 659-672): it holds no sign-in, and the key stays
  // (#438). The root holds no key of the Company's, so a refusal there is a failure: its sign-in may still be in place.
  if(connection.profile!=='default'&&removed.response.status===400&&typeof removed.result?.detail==='string'&&removed.result.detail.includes('Remove the API key')) return {state:'nothing'};
  return {state:[404,409].includes(removed.response.status)?'nothing':stepState(removed)};
 } catch { return {state:'unreachable'}; }
}

// Each subscription account the Company holds (#618): one entry of the root profile's credential pool per account
// (GET /api/credentials/pool, v0.23.0 web_routers/ops.py 351-377), the ChatGPT one Settings signed in first as the
// singleton's `device_code` row, every further ChatGPT account as its own `manual:device_code` row
// (scripts/engine-codex-accounts.sh), and each `gtmworks sign-in claude` as its own `manual:hermes_pkce` row
// (hermes_cli/auth_commands.py _add_credential). A row the Engine seeded from outside its own store (an `env:` token,
// the host's `claude_code` login) is no subscription the Owner connected, and a key row is a key: neither is listed.
// The entry's id is the account's identity: the Engine keeps it across refreshes (credential_pool.py _upsert_entry) and
// a sign-in of the same account again (the patch). Only the provider, the id and whether the Engine found the account
// exhausted leave the driver: never its label (an email the token carries), its token preview or its counts.
const ownSubscription=entry=>entry?.auth_type==='oauth'&&typeof entry.source==='string'&&!entry.source.startsWith('env:')&&entry.source!=='claude_code'
 &&typeof entry.id==='string'&&accountId.test(entry.id)&&Number.isSafeInteger(entry.index)&&entry.index>0;
/** @param {any} connection */
async function subscriptionRows(connection) {
 const pool=await manage(connection,`/api/credentials/pool${query('default')}`);
 if(!pool.response.ok) return {state:refusal(pool.response),rows:null};
 if(!Array.isArray(pool.result?.providers)) return {state:'failed',rows:null};
 const rows=[];
 for(const listed of pool.result.providers) {
  if(!signInProviders.includes(listed?.provider)||!Array.isArray(listed.entries)) continue;
  for(const entry of listed.entries) if(ownSubscription(entry)&&!rows.some(row=>row.provider===listed.provider&&row.account===entry.id))
   rows.push({provider:listed.provider,account:entry.id,index:entry.index,exhausted:entry.last_status==='exhausted'});
 }
 return {state:'found',rows};
}
/** @param {any} connection */
export async function readSubscriptionAccounts(connection) {
 if(connection.profile!=='default') return {state:'failed',accounts:null};
 if(!reachable(connection)) return {state:'unreachable',accounts:null};
 try {
  const {state,rows}=await subscriptionRows(connection);
  return state==='found'&&rows?{state,accounts:rows.map(({provider,account,exhausted})=>({provider,account,exhausted}))}:{state,accounts:null};
 } catch { return {state:'unreachable',accounts:null}; }
}
// One account leaves the root's pool by the Engine's own removal (DELETE /api/credentials/pool/<provider>/<index>,
// ops.py 438-488), which also clears what it was seeded from (the ChatGPT singleton) and keeps it from coming back.
// The index is read again just before, by the account's id; `nothing`: the Engine holds no such account (any more).
// The root is named (`?profile=default`): the route refuses an unnamed profile on an Engine serving several
// (web_routers/_common.py destructive_profile), as every Company's does.
/** @param {any} connection @param {string} provider @param {string} account */
export async function removeSubscriptionAccount(connection,provider,account) {
 if(connection.profile!=='default'||!signInProviders.includes(provider)||typeof account!=='string'||!accountId.test(account)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const {state,rows}=await subscriptionRows(connection);
  if(state!=='found'||!rows) return {state};
  const row=rows.find(found=>found.provider===provider&&found.account===account);
  if(!row) return {state:'nothing'};
  const removed=await manage(connection,`/api/credentials/pool/${encodeURIComponent(provider)}/${row.index}${query('default')}`,{method:'DELETE'});
  if(removed.response.status===404) return {state:'nothing'};
  return {state:removed.response.ok&&removed.result?.ok===true?'disconnected':stepState(removed)};
 } catch { return {state:'unreachable'}; }
}

// The Owner's order of one provider's subscription accounts, first to last, and which are switched off (#621), given to
// the root's credential pool by scripts/engine-pool-order.sh's route (PUT /api/credentials/pool/<provider>/order): the
// Engine then takes a request's account in that order, goes on with it on the next one switched on when one runs out,
// and never selects one switched off; an account it does not name loses its place. Only entry ids and switches are sent.
// `unsupported`: an Engine without the patch (404 or 405), which keeps its own order.
/** @param {any} connection @param {string} provider @param {{account:string,off:boolean}[]} entries */
export async function writeAccountOrder(connection,provider,entries) {
 if(connection.profile!=='default'||!signInProviders.includes(provider)||!Array.isArray(entries)||entries.length>64
  ||!entries.every(entry=>typeof entry?.account==='string'&&accountId.test(entry.account)&&typeof entry.off==='boolean')) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const written=await manage(connection,`/api/credentials/pool/${encodeURIComponent(provider)}/order${query('default')}`,
   {method:'PUT',body:{entries:entries.map(entry=>({id:entry.account,off:entry.off}))}});
  if([404,405].includes(written.response.status)) return {state:'unsupported'};
  return {state:written.response.ok&&written.result?.ok===true?'written':stepState(written)};
 } catch { return {state:'unreachable'}; }
}
// The moves the Engine made from one subscription account to another (#621; GET /api/credentials/pool/switches,
// scripts/engine-pool-order.sh): its id for each move, the provider, the two accounts by their entry ids and its time in
// seconds, oldest first. A row of any other shape is left out; the Engine records no token, label or error with them.
// `unsupported`: an Engine without the patch.
const switchId=/^[0-9a-f]{32}$/;
/** @param {any} connection */
export async function readAccountSwitches(connection) {
 if(connection.profile!=='default') return {state:'failed',switches:null};
 if(!reachable(connection)) return {state:'unreachable',switches:null};
 try {
  const read=await manage(connection,'/api/credentials/pool/switches');
  if([404,405].includes(read.response.status)) return {state:'unsupported',switches:null};
  if(!read.response.ok) return {state:refusal(read.response),switches:null};
  if(!Array.isArray(read.result?.switches)) return {state:'failed',switches:null};
  const switches=read.result.switches.filter(row=>typeof row?.id==='string'&&switchId.test(row.id)&&signInProviders.includes(row.provider)
   &&typeof row.from==='string'&&accountId.test(row.from)&&typeof row.to==='string'&&accountId.test(row.to)&&row.from!==row.to
   &&typeof row.at==='number'&&Number.isFinite(row.at)&&row.at>0).map(({id,provider,from,to,at})=>({id,provider,from,to,at}));
  return {state:'found',switches};
 } catch { return {state:'unreachable',switches:null}; }
}

// A Company's model-provider API key (#124, ADR 0016). In the Engine a key belongs to one profile: a profile never
// reads another's key, and only the root profile's sign-ins are lent to other profiles (v0.23.0 agent/secret_scope.py
// 1-11 and get_secret 230, hermes_cli/auth.py read_credential_pool 934-958). So the key is written to the Company's
// shared space and to each of its Agent profiles, and never to the root. The providers that take a key are the Engine's
// own rows of GET /api/env (web_routers/config_env.py 264-330): a primary password row of category `provider`. Only a
// provider's slug, its label and whether a key is set leave the driver; the row's redacted preview is dropped, and the
// reveal route (config_env.py 1098) is called only to copy a key from one profile to another inside this process
// (designAccess, giveProviders), and to ask a provider that lists its own models which it serves the key (servedModels,
// #643). The key goes into the PUT bodies only and no Engine text comes back.
// A model is checked against the profile's own keys (web_routers/profiles.py 124-150), so the key is written first.
// A profile made after the key was set is not cloned from the space: a clone copies the space's whole `skills` folder
// (hermes_cli/profiles.py 43-46 and 1305-1333), a local Skill outranks the shared folder (agent/skill_utils.py 400-424)
// and no web route of the pinned Engine deletes a local Skill. It is given the space's keys instead (giveProviders,
// #660).
export const keyProfile=/^(cs|co|ag)-[0-9a-f]{32}$/;
export const keyValue=/^[\x21-\x7e]{8,4096}$/;
// Agent profiles only: the space is named apart, and a Company profile must be the space's own Company's.
const keyTargets=(space,profiles)=>typeof space==='string'&&spaceName.test(space)&&Array.isArray(profiles)
 &&profiles.every(name=>typeof name==='string'&&keyProfile.test(name)&&!name.startsWith('cs-')&&(!name.startsWith('co-')||name.slice(3)===space.slice(3)));
const readState=response=>response.status===404?'missing':refusal(response);
// The space the Engine does not serve is a failure of the Company's setup, not a profile still to be made.
export const spaceState=state=>state==='missing'?'failed':state;
/** @param {any} connection @param {string} profile */
export async function providerTable(connection,profile) {
 const read=await manage(connection,`/api/env${query(profile)}`);
 if(!read.response.ok) return {state:readState(read.response),rows:null};
 if(!read.result||typeof read.result!=='object'||Array.isArray(read.result)) return {state:'failed',rows:null};
 const rows=[];
 for(const [env,row] of Object.entries(read.result)) {
  if(row?.category!=='provider'||row.is_password!==true||row.provider_primary!==true||typeof row.provider!=='string'||!row.provider) continue;
  if(rows.some(found=>found.provider===row.provider)) continue;
  rows.push({provider:row.provider,label:typeof row.provider_label==='string'&&row.provider_label?row.provider_label:row.provider,env,set:row.is_set===true});
 }
 return {state:'found',rows};
}
// One Agent profile's table; a profile the Engine did not answer for is unread, and the others are still asked.
/** @param {any} connection @param {string} profile */
const profileTable=(connection,profile)=>providerTable(connection,profile).catch(()=>({state:'unreachable',rows:null}));
export const shown=rows=>rows.map(({provider,label,set})=>({provider,label,set}));
/** @param {any} connection @param {{space:string,profiles:string[]}} target */
export async function readProviderKeys(connection,{space,profiles}) {
 const none=state=>({state,keys:null,lacking:null,leftover:null,unread:null});
 if(!keyTargets(space,profiles)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const table=await providerTable(connection,space);
  if(table.state!=='found') return none(spaceState(table.state));
  const held=table.rows.filter(row=>row.set).map(row=>row.provider);
  // lacking: a key the space holds is missing, also from a profile the Engine has not made yet. leftover: a removal that
  // stopped part way left a key the space no longer holds. unread: the Engine could not say, so neither is known.
  const lacking=[]; const leftover=[]; const unread=[];
  for(const profile of profiles) {
   const own=await profileTable(connection,profile);
   if(own.state==='missing') { if(held.length) lacking.push(profile); continue; }
   if(own.state!=='found') { unread.push(profile); continue; }
   if(held.some(provider=>!own.rows.some(row=>row.provider===provider&&row.set))) lacking.push(profile);
   if(own.rows.some(row=>row.set&&!held.includes(row.provider))) leftover.push(profile);
  }
  return {state:'found',keys:shown(table.rows),lacking,leftover,unread};
 } catch { return none('unreachable'); }
}
// A removed Agent's profile is kept in the Engine (#299), so a key it still holds is found here and taken by the next
// removal. held: the providers each profile holds a key of, none for a profile the Engine does not serve. unread: the
// Engine could not say.
/** @param {any} connection @param {{space:string,profiles:string[]}} target */
export async function readHeldKeys(connection,{space,profiles}) {
 const none=state=>({state,held:null,unread:null});
 if(!keyTargets(space,profiles)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 const tables=await Promise.all(profiles.map(profile=>profileTable(connection,profile)));
 /** @type {Record<string,string[]>} */
 const held={}; const unread=[];
 tables.forEach((own,at)=>{
  if(own.state==='missing') held[profiles[at]]=[];
  else if(own.state!=='found') unread.push(profiles[at]);
  else held[profiles[at]]=own.rows.filter(row=>row.set).map(row=>row.provider);
 });
 return {state:'found',held,unread};
}
// The Company's default model for the provider: the first the Engine lists for it in the space once the key is there,
// of those the provider serves the key when it says which (#643). Null when the provider lists none; undefined when the
// Engine did not answer, so no profile's model is settled.
/** @param {any} connection @param {string} space @param {string} provider @returns {Promise<string|null|undefined>} */
export async function defaultModel(connection,space,provider) {
 try {
  const read=await manage(connection,`/api/model/options${query(space)}`,{timeout:20000});
  if(!read.response.ok) return undefined;
  const row=Array.isArray(read.result?.providers)?read.result.providers.find(found=>found?.slug===provider):undefined;
  const listed=Array.isArray(row?.models)?row.models.filter(name=>typeof name==='string'&&name.trim()):[];
  const [model]=keepServed(listed,listed.length?await servedModels(connection,space,provider):null);
  return model||null;
 } catch { return undefined; }
}
// The models a provider serves the key this profile holds, read from the provider with the key and address the profile's
// own .env gives the Engine (lib/served-models.mjs). The key is read on the Engine's reveal route and never leaves this
// process but to the provider it is for, over HTTPS. Null for a provider that keeps the Engine's list, a profile holding
// no key, or a read that failed.
/** @param {any} connection @param {string} profile @param {string} provider @returns {Promise<string[]|null>} */
export async function servedModels(connection,profile,provider) {
 const source=servedListOf(provider);
 if(!source) return null;
 try {
  const [key,base]=await Promise.all([revealEnv(connection,profile,source.keyEnv),revealEnv(connection,profile,source.baseEnv)]);
  // The provider's own address is used only when the profile names none; an address the Engine could not read is not
  // replaced by it, so the list is never read from another place than the Engine sends the key.
  if(!key.value||!base.value&&!base.absent) return null;
  return await readServedModels({provider,key:key.value,base:base.value});
 } catch { return null; }
}
/** @param {any} connection @param {string} profile @param {{env:string,value:string,provider:string,model:string|null|undefined}} key */
async function writeProfileKey(connection,profile,{env,value,provider,model,design}) {
 try {
  const written=await manage(connection,`/api/env${query(profile)}`,{method:'PUT',body:{key:env,value}});
  if(!written.response.ok||written.result?.ok!==true) return stepState(written);
  // The Agent's design profile (#544) takes the same key and model; a write it refuses is this profile's outcome, so the
  // profile stays unfinished and the next set writes both again.
  if(design) {
   const mirrored=await manage(connection,`/api/env${query(design)}`,{method:'PUT',body:{key:env,value}});
   if(!mirrored.response.ok||mirrored.result?.ok!==true) return stepState(mirrored);
  }
  if(model===undefined) return 'modelUnread';
  if(!model) return 'noModel';
  const picked=await manage(connection,`/api/profiles/${encodeURIComponent(profile)}/model`,{method:'PUT',body:{provider,model}});
  if(!picked.response.ok||picked.result?.ok!==true) return stepState(picked);
  if(design) {
   const mirrored=await manage(connection,`/api/profiles/${encodeURIComponent(design)}/model`,{method:'PUT',body:{provider,model}});
   if(!mirrored.response.ok||mirrored.result?.ok!==true) return stepState(mirrored);
  }
  return 'written';
 } catch { return 'unreachable'; }
}
// profilesOnly writes the profiles alone, for a space that already holds this key; the space still names its env and model.
/** @param {any} connection @param {{space:string,profiles:string[],provider:string,value:string,profilesOnly?:boolean}} key */
export async function setProviderKey(connection,{space,profiles,provider,value,profilesOnly=false}) {
 const none=state=>({state,model:null,profiles:null});
 if(!keyTargets(space,profiles)||typeof provider!=='string') return none('failed');
 if(typeof value!=='string'||!keyValue.test(value)) return none('invalid');
 if(!reachable(connection)) return none('unreachable');
 try {
  const table=await providerTable(connection,space);
  if(table.state!=='found') return none(spaceState(table.state));
  const row=table.rows.find(found=>found.provider===provider);
  if(!row) return none('unknownProvider');
  if(!profilesOnly) {
   const written=await manage(connection,`/api/env${query(space)}`,{method:'PUT',body:{key:row.env,value}});
   // The Engine refuses a value that reads as its own redacted preview.
   if(written.response.status===400) return none('invalid');
   if(!written.response.ok||written.result?.ok!==true) return none(stepState(written));
  }
  const model=await defaultModel(connection,space,provider);
  // Each profile is asked even after one fails, so the next set finds the others done.
  const states={};
  const designs=await designProfiles(connection,profiles);
  for(const profile of profiles) {
   states[profile]=await writeProfileKey(connection,profile,{env:row.env,value,provider,model,design:designs.designs?.get(profile)});
   // Which Agents have a design profile is unknown: each Agent that could have one stays unfinished, to be asked again.
   if(!designs.designs&&designProfileOf(profile)&&['written','noModel'].includes(states[profile])) states[profile]=designs.state;
  }
  return {state:'written',model:model??null,profiles:states};
 } catch { return none('unreachable'); }
}
// The key leaves the space and each profile; a 404 is a profile that held none (or that the Engine has not made).
// Each profile keeps its model, which the next set writes again.
/** @param {any} connection @param {{space:string,profiles:string[],provider:string}} key */
export async function removeProviderKey(connection,{space,profiles,provider}) {
 const none=state=>({state,profiles:null});
 if(!keyTargets(space,profiles)||typeof provider!=='string') return none('failed');
 if(!reachable(connection)) return none('unreachable');
 const remove=async(profile,env)=>{
  try {
   const removed=await manage(connection,`/api/env${query(profile)}`,{method:'DELETE',body:{key:env}});
   if(removed.response.status===404) return 'nothing';
   return removed.response.ok&&removed.result?.ok===true?'removed':stepState(removed);
  } catch { return 'unreachable'; }
 };
 try {
  const table=await providerTable(connection,space);
  if(table.state!=='found') return none(spaceState(table.state));
  const row=table.rows.find(found=>found.provider===provider);
  if(!row) return none('unknownProvider');
  const fromSpace=await remove(space,row.env);
  if(fromSpace!=='removed'&&fromSpace!=='nothing') return none(fromSpace);
  const states={};
  const designs=await designProfiles(connection,profiles);
  for(const profile of profiles) {
   states[profile]=await remove(profile,row.env);
   // A design profile (#544) that keeps the key, or a list that could not say whether there is one, makes this profile's
   // removal unfinished, so it is asked again.
   if(!designs.designs) { if(designProfileOf(profile)) states[profile]=designs.state; continue; }
   const design=designs.designs.get(profile);
   const fromDesign=design?await remove(design,row.env):'nothing';
   if(fromDesign!=='removed'&&fromDesign!=='nothing') states[profile]=fromDesign;
   else if(fromDesign==='removed'&&states[profile]==='nothing') states[profile]='removed';
  }
  return {state:fromSpace==='removed'||Object.values(states).includes('removed')?'removed':'nothing',profiles:states};
 } catch { return none('unreachable'); }
}
