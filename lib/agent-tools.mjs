// The tools gtmworks offers an Agent through the engine contract (ADR 0009), one entry per tool name: what the engine
// is told, how a call's arguments are read, and what gtmworks does with a call. The database decides which tools a run
// is offered and pins their names at its first reservation (pinned_run); the model decides when to call one; gtmworks
// decides whether it is allowed, when the call is carried out, in the database. A call to an unknown tool, or with
// arguments that do not read, is ignored and never holds up closing its run.

/** @param {unknown} value @param {number} most */
const text=(value,most)=>typeof value==='string'&&!value.includes('\u0000')&&value.trim().length>=1&&value.trim().length<=most?value.trim():null;

/** @typedef {{db:any,engine:import('./engine.mjs').Engine,profile:string,conversation:string,run:string,call:string}} ToolContext */
/** @typedef {{state:'created',agent:string|null}|{state:'saved',rule:string}|{state:'refused'|'invalid'|'engineNotReady'|'engineUnreachable'|'ignored'}} ToolOutcome */

export const agentTools={
 // Lead's: offered only to an active Owner talking to the Company's main Agent on the Company's own profile.
 create_agent:{
  spec:/** @type {import('./engine.mjs').ToolSpec} */({name:'create_agent',
   description:'Adds a lasting agent to the company\'s team for a job the person asked someone to take on, such as running their Meta ads. Use it only when they asked for that.',
   parameters:{type:'object',additionalProperties:false,required:['name','job','apps'],properties:{
    name:{type:'string',maxLength:100,description:'A short name for the agent.'},
    job:{type:'string',maxLength:200,description:'One sentence: the work it does.'},
    apps:{type:'array',maxItems:8,items:{type:'string',maxLength:40},description:'The apps it will use.'}}}}),
  /** @param {unknown} args */
  parse(args) {
   const value=/** @type {{name?:unknown,job?:unknown,apps?:unknown}|null} */(args);
   const name=text(value?.name,100); const job=text(value?.job,200);
   const apps=Array.isArray(value?.apps)&&value.apps.length<=8?value.apps.map(app=>text(app,40)):null;
   return name&&job&&apps&&!apps.includes(null)?{name,job,apps:/** @type {string[]} */(apps)}:null;
  },
  // The Agent shares the Company's own profile with Lead (ADR 0014): the Engine must have that profile ready, or nothing
  // is made. An Engine that does not answer keeps the run open, so a later pass carries the call out once it answers.
  // The database then checks the Conversation's person and Agent and makes the Agent once per run and call.
  /** @param {ToolContext} context @param {{name:string,job:string,apps:string[]}} args @returns {Promise<ToolOutcome>} */
  async run({db,engine,profile,conversation,run,call},{name,job,apps}) {
   const found=await engine.readAgent(profile);
   if(found.state==='unreachable') return {state:'engineUnreachable'};
   if(found.state!=='found'||!found.agent.ready) return {state:'engineNotReady'};
   const {data,error}=await db.rpc('lead_create_agent',{conversation,run,call,agent_name:name,job,apps});
   if(error) throw error;
   return data;
  },
 },
 // Any Agent's: offered while the Conversation's person is an active Owner or Manager of the Company (#18). The rule
 // then goes with every later run of this Agent, whoever writes to it.
 save_rule:{
  spec:/** @type {import('./engine.mjs').ToolSpec} */({name:'save_rule',
   description:'Saves a lasting rule the person told you to follow in your work from now on, such as «من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها» (from now on, send nothing to a customer before I see it). gtmworks gives you every saved rule with each of your later messages, from anyone in the company, until a person removes it. Use it only when they told you such a rule, and confirm the rule to them in your reply.',
   parameters:{type:'object',additionalProperties:false,required:['rule'],properties:{
    rule:{type:'string',maxLength:500,description:'The rule as the person said it, in their own words and language.'}}}}),
  /** @param {unknown} args */
  parse(args) {
   const rule=text(/** @type {{rule?:unknown}|null} */(args)?.rule,500);
   return rule?{rule}:null;
  },
  /** @param {ToolContext} context @param {{rule:string}} args @returns {Promise<ToolOutcome>} */
  async run({db,conversation,run,call},{rule}) {
   const {data,error}=await db.rpc('agent_save_rule',{conversation,run,call,rule});
   if(error) throw error;
   return data;
  },
 },
};

// The specs of the tools the database pinned for a run, in this table's order whatever order the names came in, so a
// retry sends the same request. A name this version does not know is left out.
/** @param {unknown} names @returns {import('./engine.mjs').ToolSpec[]} */
export const toolSpecs=names=>Object.values(agentTools).map(tool=>tool.spec).filter(spec=>Array.isArray(names)&&names.includes(spec.name));

/** @param {Omit<ToolContext,'call'>} context @param {import('./engine.mjs').ToolCall} call @returns {Promise<ToolOutcome>} */
export async function runToolCall(context,call) {
 const tool=Object.hasOwn(agentTools,call.name)?agentTools[/** @type {keyof typeof agentTools} */(call.name)]:undefined;
 const args=tool?.parse(call.arguments);
 return tool&&args?tool.run({...context,call:call.id},args):{state:'ignored'};
}
