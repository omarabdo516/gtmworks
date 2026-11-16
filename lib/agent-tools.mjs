// The tools gtmworks offers an Agent through the engine contract (ADR 0009), one entry per tool name: what the engine
// is told, how a call's arguments are read, and what gtmworks does with a call. The database decides which tools a run
// is offered and pins their text at its first start (pin_run); the model decides when to call one; gtmworks
// decides whether it is allowed, when the call is carried out, in the database. A call to an unknown tool, or with
// arguments that do not read, is ignored and never holds up closing its run.

import { instructionsOf, roleAppNames, roleTemplates } from './role-templates.mjs';

/** @param {unknown} value @param {number} most */
const text=(value,most)=>typeof value==='string'&&!value.includes('\u0000')&&value.trim().length>=1&&value.trim().length<=most?value.trim():null;

/** @typedef {{db:any,engine:import('./engine.mjs').Engine,profile:string,conversation:string,run:string,call:string}} ToolContext */
/** @typedef {{state:'created',agent:string|null}|{state:'requested',request:number}|{state:'saved'|'suggested',rule:string}|{state:'refused'|'invalid'|'engineNotReady'|'engineUnreachable'|'ignored'}} ToolOutcome */

// A lasting rule is the person's whole message (#18). save_rule and suggest_rule read and keep it the same way; the
// database decides its reach from the person's role when the call is carried out (agent_save_rule).
const ruleParameters={type:'object',additionalProperties:false,required:['rule'],properties:{
 rule:{type:'string',maxLength:500,description:'The person\'s whole message, copied word for word in their language. Anything else, a part of it included, is not saved.'}}};
/** @param {unknown} args */
const ruleOf=args=>{ const rule=text(/** @type {{rule?:unknown}|null} */(args)?.rule,500); return rule?{rule}:null; };
/** @param {ToolContext} context @param {{rule:string}} args @returns {Promise<ToolOutcome>} */
async function keepRule({db,conversation,run,call},{rule}) {
 const {data,error}=await db.rpc('agent_save_rule',{conversation,run,call,rule});
 if(error) throw error;
 return data;
}

// With a template, a name, job or apps left out is the role's; one given replaces it and is checked as always.
const agentParameters={type:'object',additionalProperties:false,properties:{
 template:{type:'string',enum:Object.keys(roleTemplates),description:'A ready-made role: meta (Meta ads manager), hook (ad critic), writer (SEO content writer), numbers (numbers analyst), coder (website coding agent).'},
 name:{type:'string',maxLength:100,description:'A short name for the agent.'},
 job:{type:'string',maxLength:200,description:'One sentence: the work it does.'},
 apps:{type:'array',maxItems:8,items:{type:'string',maxLength:40},description:'The apps it will use.'}}};
/** @typedef {{template:keyof typeof roleTemplates|null,name:string,job:string,apps:string[]}} AgentArgs */
/** @param {unknown} args @returns {AgentArgs|null} */
function agentOf(args) {
 const value=/** @type {{template?:unknown,name?:unknown,job?:unknown,apps?:unknown}|null} */(args);
 const id=value?.template;
 if(id!=null&&!(typeof id==='string'&&Object.hasOwn(roleTemplates,id))) return null;
 const template=id==null?null:/** @type {keyof typeof roleTemplates} */(id);
 const role=template&&roleTemplates[template];
 const name=role&&value?.name==null?role.name:text(value?.name,100); const job=role&&value?.job==null?role.job:text(value?.job,200);
 const listed=template&&value?.apps==null?roleAppNames(template):value?.apps;
 const apps=Array.isArray(listed)&&listed.length<=8?listed.map(app=>text(app,40)):null;
 return name&&job&&apps&&!apps.includes(null)?{template,name,job,apps:/** @type {string[]} */(apps)}:null;
}
// A role's instructions go with its id; the database fits them to the Company when the Agent is made.
/** @param {ToolContext} context @param {AgentArgs} args */
const agentCall=({conversation,run,call},{template,name,job,apps})=>({conversation,run,call,agent_name:name,job,apps,...(template?{template,instructions:instructionsOf(template)}:{})});

// The Agent shares the Company's own profile with Lead (ADR 0014): an Agent is made only while the Engine has that
// profile ready.
/** @param {import('./engine.mjs').Engine} engine @param {string} profile @returns {Promise<'ready'|'engineNotReady'|'engineUnreachable'>} */
export async function engineReady(engine,profile) {
 const found=await engine.readAgent(profile);
 if(found.state==='unreachable') return 'engineUnreachable';
 return found.state==='found'&&found.agent.ready?'ready':'engineNotReady';
}

const agentTools={
 // Lead's: offered only to an active Owner talking to the Company's main Agent on the Company's own profile.
 create_agent:{
  spec:/** @type {import('./engine.mjs').ToolSpec} */({name:'create_agent',
   description:'Adds a lasting agent to the company\'s team for a job the person asked someone to take on, such as running their Meta ads. Use it only when they asked for that. When the job is one of the ready-made roles, give its template: the agent then starts from that role\'s proven instructions, and its name, job and apps are the role\'s unless you give others. Without a template, give the name, job and apps.',
   parameters:agentParameters}),
  parse:agentOf,
  // An Engine that does not answer keeps the run open, so a later pass carries the call out once it answers. The
  // database then checks the Conversation's person and Agent and makes the Agent once per run and call.
  /** @param {ToolContext} context @param {AgentArgs} args @returns {Promise<ToolOutcome>} */
  async run(context,args) {
   const ready=await engineReady(context.engine,context.profile);
   if(ready!=='ready') return {state:ready};
   const {data,error}=await context.db.rpc('lead_create_agent',agentCall(context,args));
   if(error) throw error;
   return data;
  },
 },
 // Offered in place of create_agent to an active Manager or Contributor (run_tools). Nothing is made here, so the
 // Engine is not asked.
 request_agent:{
  spec:/** @type {import('./engine.mjs').ToolSpec} */({name:'request_agent',
   description:'Prepares a lasting agent for a job the person asked someone to take on, such as running their Meta ads, as a request for the company\'s Owner, who makes it or says no. Nothing is made until the Owner says yes. Use it only when they asked for that. When the job is one of the ready-made roles, give its template: the agent then starts from that role\'s proven instructions, and its name, job and apps are the role\'s unless you give others. Without a template, give the name, job and apps. Say in your reply that you sent the request to the Owner, that no agent exists yet, and that their answer will show here.',
   parameters:agentParameters}),
  parse:agentOf,
  /** @param {ToolContext} context @param {AgentArgs} args @returns {Promise<ToolOutcome>} */
  async run(context,args) {
   const {data,error}=await context.db.rpc('lead_request_agent',agentCall(context,args));
   if(error) throw error;
   return data;
  },
 },
 // Any Agent's: offered while the Conversation's person is an active Owner or Manager of the Company (#18). The rule
 // then goes with every later run of this Agent, whoever writes to it.
 save_rule:{
  spec:/** @type {import('./engine.mjs').ToolSpec} */({name:'save_rule',
   description:'Saves a lasting rule the person told you to follow in your work from now on, such as "from now on, send nothing to a customer before I see it", in whatever language they said it. gtmworks gives you every saved rule with each of your later messages, from anyone in the company, until a person removes it. Use it only when they told you such a rule, and confirm the rule to them in your reply.',
   parameters:ruleParameters}),
  parse:ruleOf,
  run:keepRule,
 },
 // Any Agent's, in place of save_rule while the Conversation's person is an active Contributor (#25): the rule goes with
 // that person's later runs at once, and with everyone's once an Owner or a Manager approves it.
 suggest_rule:{
  spec:/** @type {import('./engine.mjs').ToolSpec} */({name:'suggest_rule',
   description:'Saves a lasting rule the person told you to follow in your work with them from now on, such as "from now on, send nothing to a customer before I see it", in whatever language they said it. gtmworks gives it to you with each of their later messages at once, and sends it to the company\'s Owner and Managers as a suggestion for the whole team: once one of them approves it, it goes with everyone\'s messages. Use it only when they told you such a rule, and say both in your reply: you work this way with them from now on, and you suggested it for the team.',
   parameters:ruleParameters}),
  parse:ruleOf,
  run:keepRule,
 },
};

// Every tool's spec as the exact text the engine is sent, by name: the database pins the text of the ones a run is
// offered (pin_run), and every retry sends that text.
export const agentToolSpecs=Object.values(agentTools).map(tool=>tool.spec);
/** @returns {Record<string,string>} */
export const toolSpecTexts=()=>Object.fromEntries(agentToolSpecs.map(spec=>[spec.name,JSON.stringify(spec)]));

/** @param {Omit<ToolContext,'call'>} context @param {import('./engine.mjs').ToolCall} call @returns {Promise<ToolOutcome>} */
export async function runToolCall(context,call) {
 const tool=Object.hasOwn(agentTools,call.name)?agentTools[/** @type {keyof typeof agentTools} */(call.name)]:undefined;
 const args=tool?.parse(call.arguments);
 return tool&&args?tool.run({...context,call:call.id},args):{state:'ignored'};
}
