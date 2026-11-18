import { hermesAt } from './bundled-hermes.mjs';
import { agentTarget } from './agent-about.mjs';
import { writeSetting } from './engine-settings.mjs';
import { effortLevels } from './engine-effort.mjs';

// An Agent's thinking level (#179): the key `agent.reasoning_effort` of the Agent's own Engine profile, written through
// #125's writeSetting (one key, read back) and never through a route of its own. The Engine's own source decides the
// choices (hermes_constants.py 1073: `none` plus `minimal`…`ultra`) and an absent value reads as medium. Only the Owner
// changes it: check_agent_owner_setting checks the save before the Engine is written, and log_engine_setting writes one
// Company log row with the old and new level once the Engine holds it. An Agent still on the Company's shared `co-`
// profile would change the main Agent too, so it is refused unless that profile is its own (agentTarget `own`, as #29
// decided for models).

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refused=state=>({state,effort:null});

// One save of the thinking level from the Agent's page. States: written (with the level the Engine holds), invalid (a
// value that is not one of the Engine's eight), notOwn (an Agent sharing another Agent's profile, or one not seen),
// notAllowed (below Owner), noEngine, or the Engine's refused / unreachable / failed / mismatch.
/** @param {any} db @param {{company:string,agent:unknown,effort:unknown,hermes?:{address:string,key:string}|null,driver?:object}} request */
export async function changeAgentEffort(db,{company,agent,effort,hermes=hermesAt(),driver={}}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)) return refused('invalid');
 if(typeof effort!=='string'||!effortLevels.includes(effort)) return refused('invalid');
 const target=await agentTarget(db,company,agent,hermes);
 if(target.state==='noEngine') return refused('noEngine');
 if(target.state!=='found'||!target.own) return refused('notOwn');
 const {error}=await db.rpc('check_agent_owner_setting',{c:company,agent});
 if(error) return refused(error.message==='agentSettingNotAllowed'?'notAllowed':'failed');
 const written=await writeSetting({...target,profile:target.profile},{setting:'agent.reasoning_effort',value:effort,driver});
 if(written.state==='invalid'||written.state==='owned'||written.state==='unknown'||written.state==='installOnly'||written.state==='profileOnly') return refused('invalid');
 if(written.state!=='saved'&&written.state!=='unchanged') return refused(written.state);
 // One row, with both levels: the Engine holds the new one and the reader keeps what it changed from.
 if(written.state==='saved') {
  const {error:logError}=await db.rpc('log_engine_setting',{c:company,agent,setting:'agent.reasoning_effort',old_value:written.old,new_value:written.new});
  if(logError) return refused('failed');
 }
 return {state:'written',effort};
}
