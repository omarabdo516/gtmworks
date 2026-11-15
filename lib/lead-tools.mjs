// The tools gtmworks offers the main Agent (Lead) through the engine contract (ADR 0009), one entry per tool name: what
// the engine is told, how a call's arguments are read, and what gtmworks does with a call. The model decides when to
// call a tool; gtmworks decides whether it is allowed, when the call is carried out, in the database. A call to an
// unknown tool, or with arguments that do not read, is ignored and never holds up closing its run.
import { instructionsOf, roleTemplates } from './role-templates.mjs';

/** @param {unknown} value @param {number} most */
const text=(value,most)=>typeof value==='string'&&!value.includes('\u0000')&&value.trim().length>=1&&value.trim().length<=most?value.trim():null;

/** @typedef {{db:any,engine:import('./engine.mjs').Engine,profile:string,conversation:string,run:string,call:string}} ToolContext */
/** @typedef {{state:'created',agent:string|null}|{state:'refused'|'invalid'|'engineNotReady'|'engineUnreachable'|'ignored'}} ToolOutcome */

const leadTools={
 create_agent:{
  spec:/** @type {import('./engine.mjs').ToolSpec} */({name:'create_agent',
   description:'Adds a lasting agent to the company\'s team for a job the person asked someone to take on, such as running their Meta ads. Use it only when they asked for that. When the job is one of the ready-made roles, give its template: the agent then starts from that role\'s proven instructions, and its name, job and apps are the role\'s unless you give others. Without a template, give the name, job and apps.',
   parameters:{type:'object',additionalProperties:false,properties:{
    template:{type:'string',enum:Object.keys(roleTemplates),description:'A ready-made role: meta (Meta ads manager), hook (ad critic), writer (SEO content writer), numbers (numbers analyst), coder (website coding agent).'},
    name:{type:'string',maxLength:100,description:'A short name for the agent.'},
    job:{type:'string',maxLength:200,description:'One sentence: the work it does.'},
    apps:{type:'array',maxItems:8,items:{type:'string',maxLength:40},description:'The apps it will use.'}}}}),
  // With a template, a name, job or apps left out is the role's; one given replaces it and is checked as always.
  /** @param {unknown} args */
  parse(args) {
   const value=/** @type {{template?:unknown,name?:unknown,job?:unknown,apps?:unknown}|null} */(args);
   const id=value?.template;
   if(id!=null&&!(typeof id==='string'&&Object.hasOwn(roleTemplates,id))) return null;
   const template=id==null?null:/** @type {keyof typeof roleTemplates} */(id);
   const role=template&&roleTemplates[template];
   const name=role&&value?.name==null?role.name:text(value?.name,100); const job=role&&value?.job==null?role.job:text(value?.job,200);
   const listed=role&&value?.apps==null?role.apps:value?.apps;
   const apps=Array.isArray(listed)&&listed.length<=8?listed.map(app=>text(app,40)):null;
   return name&&job&&apps&&!apps.includes(null)?{template,name,job,apps:/** @type {string[]} */(apps)}:null;
  },
  // The Agent shares the Company's own profile with Lead (ADR 0014): the Engine must have that profile ready, or nothing
  // is made. An Engine that does not answer keeps the run open, so a later pass carries the call out once it answers.
  // The database then checks the Conversation's person and Agent and makes the Agent once per run and call.
  // A role's instructions go with its id; the database fits them to the Company.
  /** @param {ToolContext} context @param {{template:keyof typeof roleTemplates|null,name:string,job:string,apps:string[]}} args @returns {Promise<ToolOutcome>} */
  async run({db,engine,profile,conversation,run,call},{template,name,job,apps}) {
   const found=await engine.readAgent(profile);
   if(found.state==='unreachable') return {state:'engineUnreachable'};
   if(found.state!=='found'||!found.agent.ready) return {state:'engineNotReady'};
   const {data,error}=await db.rpc('lead_create_agent',{conversation,run,call,agent_name:name,job,apps,...(template?{template,instructions:instructionsOf(template)}:{})});
   if(error) throw error;
   return data;
  },
 },
};
export const leadToolSpecs=Object.values(leadTools).map(tool=>tool.spec);

/** @param {Omit<ToolContext,'call'>} context @param {import('./engine.mjs').ToolCall} call @returns {Promise<ToolOutcome>} */
export async function runToolCall(context,call) {
 const tool=Object.hasOwn(leadTools,call.name)?leadTools[/** @type {keyof typeof leadTools} */(call.name)]:undefined;
 const args=tool?.parse(call.arguments);
 return tool&&args?tool.run({...context,call:call.id},args):{state:'ignored'};
}
