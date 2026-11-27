import { companyEngine, seenAgents } from './engine/handle.mjs';
import { readSettings, learningModeOf } from './engine-settings.mjs';

// The Learning section (#28): how each of a Company's Agents learns, and what each learned. Modes are the Engine's two
// write approvals (#125, engine-settings.mjs) read from every Agent's own profile: both off is "by itself", both on is
// "ask first", and one of each is mixed and shown as it reads. What an Agent learned is its rules from the database
// (agent_rules, a removed one included so it can be brought back), the Skills the Engine's learning graph says it wrote
// on its own (#180, no version), and the Company's shared lessons: its approved rules that are not removed, shown once
// for the Company. The Engine is reached only through the Engine handle (lib/engine/, ADR 0008); the profile never leaves this module.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What the database holds of the section (#898, ADR 0030): the Agents the reader sees, each Agent's own mode choice, and
// the rules and shared lessons, drawn before the Engine is read. Each Agent has no mode and no learned Skills here.
/** @param {any} db @param {{company:string}} request */
export async function readStoredLearning(db,{company}) {
 const stored=await storedLearning(db,company);
 return stored.state==='found'?{state:'found',agents:stored.rows.map(({id,name,own,shared,follow})=>({id,name,own,shared,follow,mode:null,learned:null})),rules:stored.rules,lessons:stored.lessons}:stored;
}
/** @param {any} db @param {string} company */
async function storedLearning(db,company) {
 if(typeof company!=='string'||!uuid.test(company)) return /** @type {const} */({state:'failed',agents:null,rules:null,lessons:null});
 const [agentsAnswer,rulesAnswer,modesAnswer]=await Promise.all([
  seenAgents(db,company),
  db.from('agent_rules').select('id,agent_id,body,said_by,said_at,removed_at,suggestion,teller:people!said_by(name)')
   .eq('company_id',company).or('suggestion.is.null,suggestion.eq.approved').order('said_at',{ascending:false}),
  db.rpc('company_learning_modes',{c:company}),
 ]);
 if(!agentsAnswer) return /** @type {const} */({state:'failed',agents:null,rules:null,lessons:null});
 const rules=(Array.isArray(rulesAnswer.data)?rulesAnswer.data:[])
  .filter(rule=>rule&&typeof rule.id==='string'&&typeof rule.agent_id==='string')
  .map(rule=>({id:rule.id,agent:rule.agent_id,body:String(rule.body??''),saidBy:rule.said_by??null,
   saidByName:typeof rule.teller?.name==='string'?rule.teller.name:null,saidAt:rule.said_at,
   removed:rule.removed_at!=null,shared:rule.suggestion==='approved'}));
 // Which Agents chose a mode of their own (#28): null here means the Agent follows the Company, and the per-Agent control
 // offers that choice back. A modes read that failed leaves it unknown, so no control invites a choice it cannot keep.
 const choices=Array.isArray(modesAnswer.data)?new Map(modesAnswer.data.map(row=>[row.agent,row.learning_mode_choice==='auto'||row.learning_mode_choice==='ask'?row.learning_mode_choice:null])):null;
 const profiles=agentsAnswer.map(row=>row.profile);
 // A profile two Agents share is one mode for both: neither is offered an override, since a write would change the other.
 const rows=agentsAnswer.map(row=>({id:row.agent,name:row.name,own:row.own===true,shared:profiles.filter(profile=>profile===row.profile).length>1,follow:choices?choices.get(row.agent)===null:null,profile:row.profile}));
 return /** @type {const} */({state:'found',rows,rules,lessons:rules.filter(rule=>rule.shared&&!rule.removed)});
}

/** @param {any} db @param {{company:string}} request */
export async function readCompanyLearning(db,{company}) {
 const stored=await storedLearning(db,company);
 if(stored.state!=='found') return stored;
 const {rows,rules,lessons}=stored;
 const target=rows.length?await companyEngine(company,{reader:db}):null;
 const reads=new Map(await Promise.all([...new Set(rows.map(row=>row.profile))].map(async profile=>{
  const at=target?.on(profile);
  if(!target||!at) return /** @type {const} */([profile,{mode:null,learned:null}]);
  const [settings,skills,graph]=await Promise.all([
   readSettings(at,{root:target.on('default')}),
   at.skills.read(),
   at.skills.learned(),
  ]);
  const learned=skills.state!=='found'||graph.state!=='found'?null
   :skills.skills.filter(skill=>!skill.shared&&(graph.learned||[]).includes(skill.name)).map(skill=>({name:skill.name,description:skill.description}));
  return /** @type {const} */([profile,{mode:settings.state==='found'?learningModeOf(settings.settings):null,learned}]);
 })));
 const agents=rows.map(({profile,...agent})=>({...agent,...reads.get(profile)}));
 return {state:'found',agents,rules,lessons};
}
