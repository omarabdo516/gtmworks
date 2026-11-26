import { ownProfile } from './skills.mjs';
import { agentName, manage, query, reachable, refusal } from './wire.mjs';

// A profile's settings (#125, ADR 0016), read and written through the Engine's config routes (v0.23.0
// hermes_cli/web_routers/config_env.py 81-161). The read merges the Engine's defaults over what the profile saved unless
// include_defaults=false asks for the saved values alone; the defaults route takes no profile; the schema gives each
// field's type and choices. A write deep-merges, so it states only its own keys (config.py 1373-1388), and is checked by
// the read-back its caller makes, never by a 200 alone.
const configState=state=>({state,config:null});
/** @param {any} connection */
export async function readConfig(connection) { return readConfigAt(connection,`/api/config${query(connection.profile)}`); }
/** @param {any} connection */
export async function readSavedConfig(connection) { return readConfigAt(connection,`/api/config${query(connection.profile)}&include_defaults=false`); }
async function readConfigAt(connection,path) {
 if(!agentName.test(connection.profile)) return configState('failed');
 if(!reachable(connection)) return configState('unreachable');
 try {
  const read=await manage(connection,path);
  if(!read.response.ok) return configState(refusal(read.response));
  if(!read.result||typeof read.result!=='object'||Array.isArray(read.result)) return configState('failed');
  return {state:'found',config:read.result};
 } catch { return configState('unreachable'); }
}
/** @param {any} connection */
export async function readConfigDefaults(connection) {
 if(!reachable(connection)) return configState('unreachable');
 try {
  const read=await manage(connection,'/api/config/defaults');
  if(!read.response.ok) return configState(refusal(read.response));
  if(!read.result||typeof read.result!=='object'||Array.isArray(read.result)) return configState('failed');
  return {state:'found',config:read.result};
 } catch { return configState('unreachable'); }
}
/** @param {any} connection */
export async function readConfigSchema(connection) {
 const none=state=>({state,schema:null});
 if(!agentName.test(connection.profile)) return none('failed');
 if(!reachable(connection)) return none('unreachable');
 try {
  const read=await manage(connection,`/api/config/schema${query(connection.profile)}`);
  if(!read.response.ok) return none(refusal(read.response));
  if(!read.result?.fields||typeof read.result.fields!=='object'||Array.isArray(read.result.fields)) return none('failed');
  return {state:'found',schema:read.result};
 } catch { return none('unreachable'); }
}
/** @param {any} connection @param {object} config */
export async function writeConfig(connection,config) {
 if(!agentName.test(connection.profile)||!config||typeof config!=='object'||Array.isArray(config)) return {state:'failed'};
 if(!reachable(connection)) return {state:'unreachable'};
 try {
  const written=await manage(connection,`/api/config${query(connection.profile)}`,{method:'PUT',body:{config}});
  if(!written.response.ok) return {state:written.response.status===404?'failed':refusal(written.response)};
  return {state:written.result?.ok===true?'written':'failed'};
 } catch { return {state:'unreachable'}; }
}

// An Agent's standing permissions (#166) are its own profile's command_allowlist, the list every "always" answer adds to
// (tools/approval.py _persist_choice; hermes_cli/config_defaults.py 1685-1686): gtmworks keeps no copy. A missing or
// empty list is none; anything but a list of strings is one the Engine itself ignores (_read_permanent_allowlist), and
// reads as failed rather than as none. Revoking one entry writes the list back without it — the config write replaces a
// list whole (config.py _deep_merge 1373-1388) — and reads it back, and the Engine stops honouring it at its next check,
// with no restart (_sync_permanent_from_disk 376-391). An entry already gone is gone, and nothing is written.
const allowlistState=state=>({state,entries:null});
/** @param {any} connection @returns {Promise<import('../engine.mjs').StandingPermissions>} */
export async function readStandingPermissions(connection) {
 if(!ownProfile.test(connection.profile)) return allowlistState('failed');
 const read=await readConfig(connection);
 if(read.state!=='found') return allowlistState(read.state==='missing'?'failed':read.state);
 const list=read.config.command_allowlist;
 if(list==null) return {state:'found',entries:[]};
 if(!Array.isArray(list)||list.some(entry=>typeof entry!=='string')) return allowlistState('failed');
 return {state:'found',entries:[...new Set(/** @type {string[]} */(list))]};
}
/** @param {any} connection @param {{entry:string,keep?:string[]}} change @returns {Promise<import('../engine.mjs').StandingRevoke>} */
export async function revokeStandingPermission(connection,{entry,keep=[]}) {
 if(!ownProfile.test(connection.profile)||typeof entry!=='string'||!entry) return {state:'failed'};
 // What this guarantees, and what it cannot: the pinned Engine has no route that removes one entry and no conditional
 // write (its config route replaces the list whole and shares no lock with its own save of an always answer:
 // tools/approval.py save_permanent_allowlist; config_env.py's _CONFIG_MUTATION_LOCK is the route's alone). So the
 // write is made safe for the writers gtmworks knows: `keep` names the always answers gtmworks is delivering or the
 // Engine just took, written back with the list, and the caller runs one revoke of a profile at a time
 // (lib/standing-permissions.mjs). The list is read twice and written only when both reads agree (three times at most),
 // and the read-back must hold every entry written. A grant made outside gtmworks (the Engine's own dashboard or command
 // line) in the instant between the last read and the write can still be overwritten; `revoked` means the entry is gone
 // and every entry gtmworks knew of is kept, not more. An atomic removal needs the Engine to offer one (#503).
 const same=(a,b)=>a.length===b.length&&a.every((each,index)=>each===b[index]);
 for(let attempt=0;attempt<3;attempt++) {
  const read=await readStandingPermissions(connection);
  if(read.state!=='found') return {state:read.state};
  if(!read.entries.includes(entry)) return {state:'gone'};
  const again=await readStandingPermissions(connection);
  if(again.state!=='found') return {state:again.state};
  if(!same(read.entries,again.entries)) continue;
  const kept=[...new Set([...read.entries,...keep.filter(each=>typeof each==='string'&&each)])].filter(each=>each!==entry);
  // From here the write was sent: an answer lost on the way, or a read-back that fails, may hide a write the Engine took,
  // and a write the Engine never confirmed may still land later (it runs the write on a worker thread of its own).
  // `removed` says what is known of the entry afterwards: 'no' only when the Engine confirmed the write and a read-back
  // still shows the entry; 'yes' when a read-back no longer shows it; else 'maybe'. `unconfirmed` is apart from it: a
  // write the Engine never confirmed may still land, even when another writer took the entry out before the read-back.
  const written=await writeConfig(connection,{command_allowlist:kept});
  const back=await readStandingPermissions(connection);
  if(written.state!=='written') return {state:written.state,removed:back.state==='found'&&!back.entries.includes(entry)?'yes':'maybe',unconfirmed:true};
  if(back.state!=='found') return {state:back.state,removed:'maybe'};
  if(back.entries.includes(entry)) return {state:'failed',removed:'no'};
  return {state:kept.every(each=>back.entries.includes(each))?'revoked':'failed',removed:'yes'};
 }
 return {state:'failed'};
}
