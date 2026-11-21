import { engineOf } from './company-engine.mjs';
import { readStandingPermissions, revokeStandingPermission } from './hermes.mjs';
import { appByKey } from './app-catalogue.mjs';

// An Agent's standing permissions (#166): what it may do without asking again, every action a person answered with
// "Always allow" (#163). The list is the Engine's own, its own profile's command_allowlist, read through the driver;
// gtmworks keeps only its record of who allowed each entry and when (agent_permission_grants). `db` is the signed-in
// person's own session: company_app_agents lists only the Agents they see, so one hidden from them is not found, and an
// Agent still on the Company's shared profile has none of its own to show (its entries would be another Agent's). The
// database says who may revoke (check_permission_revoke: an active Owner or Manager who sees the Agent) and logs each
// revoke once (log_permission_revoked). The profile never leaves this module.
const drivers={read:readStandingPermissions,revoke:revokeStandingPermission};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// An app's tool as the pinned Engine keys it (tools/mcp_tool_handlers.py _trust_approval_key): mcp:<server>/<tool>.
const appTool=/^mcp:([^/\s]{1,200})\/(\S{1,200})$/;

/**
 * What a row's first line names: an app's tool by the app's name and the tool's, or the entry as the Engine wrote it.
 * @param {string} entry
 * @returns {{entry:string,app:{key:string,name:string},tool:string}|{entry:string,app:null,tool:null}}
 */
export function standingEntry(entry) {
 const found=appTool.exec(entry);
 if(!found) return {entry,app:null,tool:null};
 return {entry,app:{key:found[1],name:appByKey(found[1])?.name??found[1]},tool:found[2]};
}
/** The row's first line as one plain text, as the Company log names it: at most 300 characters, never half of one. @param {string} entry */
export const standingLabel=entry=>{ const read=standingEntry(entry); const label=read.app?`${read.app.name} · ${read.tool}`:entry; const chars=Array.from(label); return chars.length>300?`${chars.slice(0,299).join('')}…`:label; };

/** @param {any} db @param {string} company @param {unknown} agent */
async function shownAgent(db,company,agent) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)) return {state:'invalid'};
 const {data,error}=await db.rpc('company_app_agents',{c:company});
 if(error||!Array.isArray(data)) return {state:'failed'};
 const found=data.find(row=>row?.agent===agent);
 return found?{state:'found',agent:found}:{state:'missing'};
}

/**
 * @typedef {{entry:string,app:{key:string,name:string}|null,tool:string|null,allowedBy:string|null,allowedAt:string|null}} StandingPermission
 * The Agent's standing permissions in the Engine's order, each with who allowed it and when when gtmworks recorded it.
 * States: found, missing (an Agent the reader does not see), invalid, noEngine, or the Engine's refused / unreachable /
 * failed. An Agent on a profile that is not its own has none.
 * @param {any} db @param {{company:string,agent:unknown,hermes?:any,driver?:Partial<typeof drivers>}} request
 * @returns {Promise<{state:'found',permissions:StandingPermission[]}|{state:string,permissions:null}>}
 */
export async function readAgentPermissions(db,{company,agent,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const target=await shownAgent(db,company,agent);
 if(target.state!=='found') return {state:target.state,permissions:null};
 if(target.agent.own!==true) return {state:'found',permissions:[]};
 if(!hermes) return {state:'noEngine',permissions:null};
 const [read,grants]=await Promise.all([(driver.read||drivers.read)({...hermes,profile:target.agent.profile}),db.rpc('agent_permission_grants',{c:company,agent})]);
 if(read.state!=='found') return {state:read.state,permissions:null};
 // A record that could not be read is not drawn as "nobody allowed it".
 if(grants.error||!Array.isArray(grants.data)) return {state:'failed',permissions:null};
 const by=new Map(grants.data.map(row=>[row.entry,row]));
 return {state:'found',permissions:read.entries.map(entry=>{ const grant=by.get(entry); return {...standingEntry(entry),allowedBy:grant?.allowed_by??null,allowedAt:grant?.allowed_at??null}; })};
}

// Revokes of one profile run one at a time in this server, so two at once never write back each other's entry. Every
// revoke goes through this app; a grant comes from the Engine's own save, which the inflight entries cover.
const revoking=new Map();
/** @template T @param {string} profile @param {()=>Promise<T>} work @returns {Promise<T>} */
function oneAtATime(profile,work) {
 const before=revoking.get(profile)??Promise.resolve();
 const run=before.catch(()=>{}).then(work);
 const tail=run.catch(()=>{}).finally(()=>{ if(revoking.get(profile)===tail) revoking.delete(profile); });
 revoking.set(profile,tail);
 return run;
}

/**
 * One entry is removed from the Agent's own profile and logged once. States: revoked, gone (it was no longer there;
 * nothing is written or logged), missing, invalid, notAllowed, noEngine, or the Engine's refused / unreachable / failed.
 * A refusal changes nothing and logs nothing.
 * @param {any} db @param {{company:string,agent:unknown,entry:unknown,hermes?:any,driver?:Partial<typeof drivers>}} request
 */
export async function revokeAgentPermission(db,{company,agent,entry,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 if(typeof entry!=='string'||entry.length<1||entry.length>1000) return {state:'invalid'};
 const target=await shownAgent(db,company,agent);
 if(target.state!=='found') return {state:target.state};
 const {error}=await db.rpc('check_permission_revoke',{c:company,agent});
 if(error) return {state:error.message==='permissionNotAllowed'?'notAllowed':'failed'};
 if(target.agent.own!==true) return {state:'gone'};
 if(!hermes) return {state:'noEngine'};
 const engine=hermes;
 const revoked=await oneAtATime(target.agent.profile,async()=>{
  // What an Always allow may be adding right now is written back with the list (agent_permission_inflight).
  const inflight=await db.rpc('agent_permission_inflight',{c:company,agent});
  if(inflight.error||!Array.isArray(inflight.data)) return {state:'failed'};
  const keep=inflight.data.map(row=>typeof row==='string'?row:row?.agent_permission_inflight).filter(each=>typeof each==='string');
  return (driver.revoke||drivers.revoke)({...engine,profile:target.agent.profile},{entry,keep});
 });
 if(revoked.state!=='revoked') return {state:revoked.state};
 // The Engine no longer honours it, so the revoke is done whatever the log says: a log the database refuses is reported
 // to the server's log rather than drawn as a revoke that failed, which a retry would then find gone and never log.
 const logged=await db.rpc('log_permission_revoked',{c:company,agent,permission:standingLabel(entry),entry});
 if(logged.error) console.error(JSON.stringify({event:'standing_permission_log_failed',company,agent,code:logged.error.code??null}));
 return {state:'revoked',logged:!logged.error};
}
