import { engineOf } from './company-engine.mjs';
import { signInTarget } from './company-sign-in.mjs';
import { readConfig, readSavedConfig, readConfigSchema, readConfigDefaults, readSkills, readLearningGraph } from './hermes.mjs';
import { readSettings, learningModeOf } from './engine-settings.mjs';

// The Learning section (#28): how each of a Company's Agents learns, and what each learned. Modes are the Engine's two
// write approvals (#125, engine-settings.mjs) read from every Agent's own profile: both off is "by itself", both on is
// "ask first", and one of each is mixed and shown as it reads. What an Agent learned is its rules from the database
// (agent_rules, a removed one included so it can be brought back), the Skills the Engine's learning graph says it wrote
// on its own (#180, no version), and the Company's shared lessons: its approved rules that are not removed, shown once
// for the Company. The Engine is reached only through lib/hermes.mjs (ADR 0008); the profile never leaves this module.
const drivers={config:readConfig,saved:readSavedConfig,schema:readConfigSchema,defaults:readConfigDefaults,read:readSkills,learned:readLearningGraph};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {any} db @param {{company:string,hermes?:{address:string,key:string}|null,driver?:object}} request */
export async function readCompanyLearning(db,{company,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 if(typeof company!=='string'||!uuid.test(company)) return {state:'failed',agents:null,rules:null,lessons:null};
 const use={...drivers,...driver};
 const [agentsAnswer,rulesAnswer,modesAnswer]=await Promise.all([
  db.rpc('company_app_agents',{c:company}),
  db.from('agent_rules').select('id,agent_id,body,said_by,said_at,removed_at,suggestion,teller:people!said_by(name)')
   .eq('company_id',company).or('suggestion.is.null,suggestion.eq.approved').order('said_at',{ascending:false}),
  db.rpc('company_learning_modes',{c:company}),
 ]);
 if(agentsAnswer.error||!Array.isArray(agentsAnswer.data)) return {state:'failed',agents:null,rules:null,lessons:null};
 const rules=(Array.isArray(rulesAnswer.data)?rulesAnswer.data:[])
  .filter(rule=>rule&&typeof rule.id==='string'&&typeof rule.agent_id==='string')
  .map(rule=>({id:rule.id,agent:rule.agent_id,body:String(rule.body??''),saidBy:rule.said_by??null,
   saidByName:typeof rule.teller?.name==='string'?rule.teller.name:null,saidAt:rule.said_at,
   removed:rule.removed_at!=null,shared:rule.suggestion==='approved'}));
 const rows=agentsAnswer.data.map(row=>({id:row.agent,name:row.name,own:row.own===true,profile:row.profile}));
 // Which Agents chose a mode of their own (#28): null here means the Agent follows the Company, and the per-Agent control
 // offers that choice back. A modes read that failed leaves it unknown, so no control invites a choice it cannot keep.
 const choices=Array.isArray(modesAnswer.data)?new Map(modesAnswer.data.map(row=>[row.agent,row.learning_mode_choice==='auto'||row.learning_mode_choice==='ask'?row.learning_mode_choice:null])):null;
 // A profile two Agents share is one mode for both: neither is offered an override, since a write would change the other.
 const sharedProfiles=new Set(rows.map(row=>row.profile).filter(profile=>rows.filter(row=>row.profile===profile).length>1));
 const target=rows.length?await signInTarget(db,company,hermes):null;
 const reads=new Map(await Promise.all([...new Set(rows.map(row=>row.profile))].map(async profile=>{
  if(!target) return /** @type {const} */([profile,{mode:null,learned:null}]);
  const [settings,skills,graph]=await Promise.all([
   readSettings({...target,profile},{driver:use}),
   use.read({...target,profile}),
   use.learned({...target,profile}),
  ]);
  const learned=skills.state!=='found'||graph.state!=='found'?null
   :skills.skills.filter(skill=>!skill.shared&&(graph.learned||[]).includes(skill.name)).map(skill=>({name:skill.name,description:skill.description}));
  return /** @type {const} */([profile,{mode:settings.state==='found'?learningModeOf(settings.settings):null,learned}]);
 })));
 const agents=rows.map(({id,name,own,profile})=>({id,name,own,shared:sharedProfiles.has(profile),follow:choices?choices.get(id)===null:null,...reads.get(profile)}));
 return {state:'found',agents,rules,lessons:rules.filter(rule=>rule.shared&&!rule.removed)};
}
