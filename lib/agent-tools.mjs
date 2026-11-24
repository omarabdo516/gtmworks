// The tools gtmworks offers an Agent through the engine contract (ADR 0009), one entry per tool name: what the engine
// is told, how a call's arguments are read, and what gtmworks does with a call. The database decides which tools a run
// is offered and pins their text at its first start (pin_run); the model decides when to call one; gtmworks
// decides whether it is allowed, when the call is carried out, in the database. A call to an unknown tool, or with
// arguments that do not read, is ignored and never holds up closing its run.

import { instructionsOf, roleAppNames, roleTemplates } from './role-templates.mjs';
import { agentSoul } from './company-profiles.mjs';
import { settleHolds } from './provider-keys.mjs';
import { apps, appByKey } from './app-catalogue.mjs';
import { engineSettings } from './engine-settings.mjs';
// Every app an Agent may ask its person for: the catalogue and the ready-made servers, not the form that adds one.
const connectableApps=apps.filter(entry=>entry.source!=='own');

/** @param {unknown} value @param {number} most */
const text=(value,most)=>typeof value==='string'&&!value.includes('\u0000')&&value.trim().length>=1&&value.trim().length<=most?value.trim():null;

// A channel Run's calls are carried out for its message (#148), not a Conversation: the card tools name the message
// whose Run showed the card. An asked Agent's Run (#477) serves a handover, and its calls are carried out for that one.
/** @typedef {{db:any,engine:import('./engine.mjs').Engine,profile:string,conversation?:string,channel?:{message:number},handover?:{id:number},run:string,call:string}} ToolContext */
/** @typedef {{state:'created',agent:string|null}|{state:'requested',request:number}|{state:'proposed',proposal:number}|{state:'saved'|'suggested',rule:string}|{state:'shown',card:number}|{state:'invalid',reason:string}|{state:'refused'|'invalid'|'engineNotReady'|'engineUnreachable'|'ignored'}} ToolOutcome */

/** @param {any} db @param {string} name @param {object} args */
async function answered(db,name,args) {
 const {data,error}=await db.rpc(name,args);
 if(error) throw error;
 return data;
}

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

// An Agent's temperament (ADR 0027, GLOSSARY: Temperament): the character its face carries, which changes nothing in its
// work. Lead may give one when it makes or requests an Agent; left out, the role's or the one the team uses least. The
// database holds the list and refuses any other value (lead_agent_temperament).
const temperaments=/** @type {const} */([['calm','steady, confident work such as leading or coding'],['energetic','quick, restless work such as running ads'],
 ['warm','friendly work with people such as customers or sales'],['dreamy','creative work such as writing or design'],
 ['neat','careful, orderly work such as numbers or reports'],['caring','patient, attentive work such as reviewing or support']]);
// With a template, a name, job or apps left out is the role's; one given replaces it and is checked as always.
const agentParameters={type:'object',additionalProperties:false,properties:{
 template:{type:'string',enum:Object.keys(roleTemplates),description:'A ready-made role: meta (Meta ads manager), hook (ad critic), writer (SEO content writer), numbers (numbers analyst), coder (website coding agent).'},
 name:{type:'string',maxLength:100,description:'A short name for the agent.'},
 job:{type:'string',maxLength:200,description:'One sentence: the work it does.'},
 apps:{type:'array',maxItems:8,items:{type:'string',maxLength:40},description:'The apps it will use.'},
 temperament:{type:'string',enum:temperaments.map(([value])=>value),description:`The character its face carries, which changes nothing in how it works; pick the one that fits its job: ${temperaments.map(([value,suits])=>`${value} (${suits})`).join(', ')}. Leave it out to use the ready-made role's, or the one the team has least.`}}};
/** @typedef {{template:keyof typeof roleTemplates|null,name:string,job:string,apps:string[],temperament:string|null}} AgentArgs */
/** @param {unknown} args @returns {AgentArgs|null} */
function agentOf(args) {
 const value=/** @type {{template?:unknown,name?:unknown,job?:unknown,apps?:unknown,temperament?:unknown}|null} */(args);
 const id=value?.template;
 if(id!=null&&!(typeof id==='string'&&Object.hasOwn(roleTemplates,id))) return null;
 const template=id==null?null:/** @type {keyof typeof roleTemplates} */(id);
 const role=template&&roleTemplates[template];
 const name=role&&value?.name==null?role.name:text(value?.name,100); const job=role&&value?.job==null?role.job:text(value?.job,200);
 const listed=template&&value?.apps==null?roleAppNames(template):value?.apps;
 const apps=Array.isArray(listed)&&listed.length<=8?listed.map(app=>text(app,40)):null;
 // Any word reaches the database, which refuses one off the list in words the model can act on.
 const temperament=value?.temperament==null?null:text(value.temperament,40);
 if(value?.temperament!=null&&!temperament) return null;
 return name&&job&&apps&&!apps.includes(null)?{template,name,job,apps:/** @type {string[]} */(apps),temperament}:null;
}
// Lead's temperament for the Agent its call makes or requests, kept by the database before that call (#696). Answers the
// database's refusal, or null once it is kept or when none was given.
/** @param {ToolContext} context @param {AgentArgs} args @returns {Promise<ToolOutcome|null>} */
async function keepTemperament({db,conversation,run,call},{temperament}) {
 if(!temperament) return null;
 const kept=await answered(db,'lead_agent_temperament',{conversation,run,call,temperament});
 return kept?.state==='kept'?null:kept;
}
// A role's instructions go with its id; the database fits them to the Company when the Agent is made.
/** @param {ToolContext} context @param {AgentArgs} args */
const agentCall=({conversation,run,call},{template,name,job,apps})=>({conversation,run,call,agent_name:name,job,apps,...(template?{template,instructions:instructionsOf(template)}:{})});

// A card under the Agent's reply (#136): every kind is one row the database keeps once per run and call
// (agent_show_card, or channel_show_card for a channel's Run, #148), and the database alone judges whether the card
// holds (reply_card_valid). A card tool reads the model's words only, trimmed, and never one holding NUL or a lone
// surrogate (half of an emoji), which the database cannot store, so its run still closes.
/** @param {unknown} value */
const plain=value=>typeof value==='string'&&!value.includes('\u0000')&&value.isWellFormed()?value.trim():null;
/** @typedef {{title:string|null,content:Record<string,unknown>}} CardArgs */
/** @param {string} kind @param {import('./engine.mjs').ToolSpec} spec @param {(args:unknown)=>CardArgs|null} parse */
const cardTool=(kind,spec,parse)=>({spec,parse,
 /** @param {ToolContext} context @param {CardArgs} args @returns {Promise<ToolOutcome>} */
 run:({db,conversation,channel,run,call},{title,content})=>channel
  ? answered(db,'channel_show_card',{message:channel.message,run,call,kind,title,content})
  : answered(db,'agent_show_card',{conversation,run,call,kind,title,content})});
/** @param {unknown} args @returns {CardArgs|null} */
function draftOf(args) {
 const value=/** @type {{title?:unknown,line?:unknown,rows?:unknown}|null} */(args);
 const rows=value?.rows??[];
 if(!value||typeof value!=='object'||!Array.isArray(rows)) return null;
 return {title:plain(value.title),content:{line:plain(value.line),rows:rows.map(row=>({label:plain(row?.label),value:plain(row?.value)}))}};
}
// #137: a verdict passes only as the model's true or false; anything else reaches the database as null, which refuses it.
/** @param {unknown} args @returns {CardArgs|null} */
function reviewOf(args) {
 const value=/** @type {{title?:unknown,line?:unknown,items?:unknown,decision?:unknown}|null} */(args);
 if(!value||typeof value!=='object') return null;
 const items=Array.isArray(value.items)?value.items.map(item=>({text:plain(item?.text),fine:typeof item?.fine==='boolean'?item.fine:null,note:plain(item?.note)})):null;
 return {title:plain(value.title),content:{line:plain(value.line),items,decision:plain(value.decision)}};
}

// #139: a draft's title, line and rows, with the app. An address left out, null or blank (models often send "" for an
// optional field) is kept out of the card; one given is sent as read, so an address that is not https, or not a string,
// reaches the database and is refused there. A note is only the Agent's closing words, so one that cannot be kept (not
// a string, or holding NUL) is dropped and one over its limit is cut, and the step still reaches its person.
/** @param {string} key @param {unknown} value */
const optional=(key,value)=>{ const read=plain(value); return value==null||read===''?{}:{[key]:read}; };
// A text cut to at most `most` characters, never inside one, ending in "…" when it was cut.
/** @param {string} text @param {number} most */
export const cut=(text,most)=>{ const points=Array.from(text); return points.length<=most?text:`${points.slice(0,most-1).join('').trimEnd()}…`; };
/** @param {unknown} value */
const closing=value=>{ const read=plain(value); return read?{note:cut(read,240)}:{}; };
/** @param {unknown} args @returns {CardArgs|null} */
function handOf(args) {
 const draft=draftOf(args);
 if(!draft) return null;
 const value=/** @type {{app?:unknown,url?:unknown,note?:unknown}} */(args);
 return {title:draft.title,content:{app:plain(value.app),...draft.content,...optional('url',value.url),...closing(value.note)}};
}

// #203: an app on gtmworks's list the Agent needs, with its reason. Only a listed app that the Run's profile (the Agent's
// own, ADR 0016) does not have connected reaches the database, so a card always asks for something real; the Engine's
// answer is read when the call is carried out, and an Engine that does not answer leaves the run open for a retry. The
// card keeps the app's key and the reason: whether it is connected is read from the Engine whenever the card is drawn.
/** @param {unknown} args @returns {{app:string,reason:string}|null} */
function connectOf(args) {
 const value=/** @type {{app?:unknown,reason?:unknown}|null} */(args);
 const app=appByKey(value?.app); const reason=plain(value?.reason);
 return app&&app.source!=='own'&&reason&&Array.from(reason).length<=200?{app:app.key,reason}:null;
}
/** @param {ToolContext} context @param {{app:string,reason:string}} args @returns {Promise<ToolOutcome>} */
async function askForApp({db,engine,conversation,run,call},{app,reason}) {
 const read=engine.apps?await engine.apps():{state:/** @type {const} */('failed'),apps:null};
 if(read.state==='unreachable') return {state:'engineUnreachable'};
 const state=read.apps?.find(entry=>entry.key===app)?.state;
 if(!state||state==='connected') return {state:'ignored'};
 return answered(db,'agent_show_card',{conversation,run,call,kind:'connect',title:appByKey(app)?.name,content:{app,reason}});
}

// #317, #475: any Agent hands work to another Agent of its Company (decision 0057). The call is kept when the asking
// Agent's Run closes (lead_hand_to_agent), and lib/handovers.mjs then runs the job on that Agent's own profile and brings
// the asking Agent back with what came of it. The model gives an Agent's exact name, the job and the context; nothing
// is resolved here.
const handOverParameters={type:'object',additionalProperties:false,required:['agent','goal'],properties:{
 agent:{type:'string',maxLength:100,description:'The exact name of the agent the work belongs to, as the team knows it.'},
 goal:{type:'string',maxLength:500,description:'The job, in one or two sentences, as the person asked for it.'},
 context:{type:'string',maxLength:2000,description:'What that agent needs from this chat to do the job: the decisions, figures and links already here.'}}};
// The same parameters with `agent` limited to the names given: the enum a Conversation's or a channel's tool is sent.
/** @param {string[]} names */
const handOverParametersFor=names=>({...handOverParameters,properties:{...handOverParameters.properties,agent:{...handOverParameters.properties.agent,enum:names}}});
/** @param {unknown} args @returns {{agent:string,goal:string,context:string|null}|null} */
function handOverOf(args) {
 const value=/** @type {{agent?:unknown,goal?:unknown,context?:unknown}|null} */(args);
 const agent=text(value?.agent,100); const goal=text(value?.goal,500);
 // #354: an optional context the model left blank is none, and one past its length is cut, as a note is (closing), so a
 // job Lead said it handed over always reaches its Agent.
 const kept=plain(value?.context);
 return agent&&goal?{agent,goal,context:kept?cut(kept,2000):null}:null;
}
/** @param {ToolContext} context @param {{agent:string,goal:string,context:string|null}} args @returns {Promise<ToolOutcome>} */
async function handToAgent({db,conversation,channel,handover,run,call},{agent,goal,context}) {
 // #150: the same handover inside a channel, kept by the channel message whose Run made the call. #477: a call made in an
 // asked Agent's Run is kept under the handover that Run serves, in the same chat or channel. The database names the
 // target, whatever the model names.
 const {data,error}=handover
  ? await db.rpc('handover_hand_to_agent',{h:handover.id,run,call,agent_name:agent,goal,context})
  : channel
  ? await db.rpc('channel_hand_to_agent',{message:channel.message,run,call,agent_name:agent,goal,context})
  : await db.rpc('lead_hand_to_agent',{conversation,run,call,agent_name:agent,goal,context});
 if(error) throw error;
 return data;
}

// #19: a change to an Agent's own Engine profile, proposed with its reason, for the Company's Owner to approve (ADR 0016:
// the profile is the Agent). The model sends every value as text; a toolset's and a listed setting's are read here into
// the type that setting holds (lib/engine-settings.mjs), so the database keeps the value the writer will be given. The
// database alone decides what is on the list and keeps anything else as refused (agent_change_listed); the Engine is
// never called when a proposal is made, only once an Owner approves it (lib/agent-changes.mjs).
const changeKinds=/** @type {const} */(['model','instructions','toolset','setting']);
const changeParameters={type:'object',additionalProperties:false,required:['change','value','reason'],properties:{
 agent:{type:'string',maxLength:100,description:'Only when you are the main agent and the change is for another agent of the team: its exact name. Leave it out for a change to yourself.'},
 change:{type:'string',enum:[...changeKinds],description:'What would change: model (the model the agent thinks with), instructions (its core instructions, the whole new text), toolset (a tool group the Owner switches per agent; only delegation, its sub-agents) or setting (one of its settings).'},
 setting:{type:'string',maxLength:120,description:'For toolset, the tool group (delegation). For setting, the setting\'s key, one of: '+engineSettings.filter(entry=>entry.key!=='model').map(entry=>entry.key).join(', ')+'. Leave it out for model and instructions.'},
 value:{type:'string',maxLength:20000,description:'The value after the change: for model, provider/model such as anthropic/claude-sonnet-5-5; for instructions, the whole new text; for toolset, on or off; for setting, its new value.'},
 reason:{type:'string',maxLength:500,description:'One or two sentences, in the person\'s language: why the change helps the work.'}}};
/** @typedef {{agent:string|null,change:typeof changeKinds[number],setting:string|null,value:unknown,reason:string}} ChangeArgs */
/** @param {string|null} setting @param {string} value */
function changeValue(setting,value) {
 const entry=engineSettings.find(found=>found.key===setting);
 if(entry?.type==='boolean') return value==='true'?true:value==='false'?false:value;
 if(entry?.type==='number') { const number=Number(value); return value.trim()!==''&&Number.isFinite(number)?number:value; }
 return value;
}
/** @param {unknown} args @returns {ChangeArgs|null} */
function changeOf(args) {
 const read=/** @type {{agent?:unknown,change?:unknown,setting?:unknown,value?:unknown,reason?:unknown}|null} */(args);
 const change=changeKinds.find(kind=>kind===read?.change);
 const reason=text(read?.reason,500);
 const agent=read?.agent==null||plain(read.agent)===''?null:text(read.agent,100);
 const setting=read?.setting==null||plain(read.setting)===''?null:text(read.setting,120);
 if(!change||!reason||(read?.agent!=null&&plain(read.agent)!==''&&!agent)||(read?.setting!=null&&plain(read.setting)!==''&&!setting)) return null;
 // Instructions are kept as written, with their own spacing; every other value is one trimmed word or line.
 const raw=read?.value;
 const given=typeof raw==='boolean'||typeof raw==='number'?String(raw):change==='instructions'?(typeof raw==='string'&&raw.trim()&&!raw.includes('\u0000')&&raw.length<=20000?raw:null):text(raw,500);
 if(given===null) return null;
 const switched=new Map([['on',true],['true',true],['off',false],['false',false]]);
 const value=change==='toolset'?switched.get(given.toLowerCase())??given:change==='setting'?changeValue(setting,given):given;
 return {agent,change,setting:change==='model'||change==='instructions'?null:setting,value,reason};
}
/** @param {ToolContext} context @param {ChangeArgs} args @returns {Promise<ToolOutcome>} */
const proposeChange=({db,conversation,run,call},{agent,change,setting,value,reason})=>
 answered(db,'agent_propose_change',{conversation,run,call,agent_name:agent,change,setting,value,reason});

// An Agent is made only while the Engine has the Company's own profile ready (ADR 0014): Lead runs there, and it is the
// profile an Agent falls back to when its own cannot be made (ADR 0016), unless the Company holds a provider key (#299).
/** @param {import('./engine.mjs').Engine} engine @param {string} profile @returns {Promise<'ready'|'engineNotReady'|'engineUnreachable'>} */
export async function engineReady(engine,profile) {
 const found=await engine.readAgent(profile);
 if(found.state==='unreachable') return 'engineUnreachable';
 return found.state==='found'&&found.agent.ready?'ready':'engineNotReady';
}

// A set the Engine never answered counts as a held key until it is settled from the space (#299), so an Agent made
// meanwhile waits on its own profile. Once the set's window has passed, the database names the space to read
// (lead_key_settle) and what the Engine finds there settles it; an Engine that cannot say leaves it held.
/** @param {ToolContext} context */
async function settleUnanswered({db,engine,conversation}) {
 if(!engine.readKeys) return;
 try {
  const {data,error}=await db.rpc('lead_key_settle',{conversation});
  if(error||typeof data?.company!=='string'||typeof data?.space!=='string'||!Number.isSafeInteger(data?.seen)) return;
  const found=await engine.readKeys(data.space);
  if(found.state==='found') await settleHolds(db,data.company,found,data.seen);
 } catch { return; }
}

// Where a new Agent's profile takes the Company's Providers from (#660): Lead runs on the Company's own profile,
// `co-<company>`, and the Company's shared space is `cs-<company>` (ADR 0016), whose API keys it is given beside Lead's
// model. Lead on any other profile names none, and the Agent is made as before.
/** @param {string} profile @returns {{providers?:import('./engine.mjs').CompanyProviders}} */
const companyProviders=profile=>/^co-[0-9a-f]{32}$/.test(profile)?{providers:{space:`cs-${profile.slice(3)}`,keeper:profile}}:{};

const agentTools={
 // Lead's: offered only to an active Owner talking to the Company's main Agent on the Company's own profile.
 create_agent:{
  spec:/** @type {import('./engine.mjs').ToolSpec} */({name:'create_agent',
   description:'Adds a lasting agent to the company\'s team for a job the person asked someone to take on, such as running their Meta ads. Use it only when they asked for that. When the job is one of the ready-made roles, give its template: the agent then starts from that role\'s proven instructions, and its name, job and apps are the role\'s unless you give others. Without a template, give the name, job and apps.',
   parameters:agentParameters}),
  parse:agentOf,
  // An Engine that does not answer keeps the run open, so a later pass carries the call out once it answers. The
  // database then checks the Conversation's person and Agent and makes the Agent once per run and call.
  // The Agent's own profile (ADR 0016) is made first, under the name the database derives for the call, since the Engine
  // cannot take part in the database's one step that makes the Agent: that step attaches the Agent to it when the Engine
  // made it with the fixed set of tools and it can answer, and to Lead's profile as before otherwise. The Engine gives
  // the profile the Company's Providers as they stand (#660): the space's API keys and Lead's model, the root's
  // subscriptions being every profile's already, so it answers with no step from the Owner. While the Company holds a
  // provider key it is attached to its own profile whatever the Engine answered, and waits there only while the Company
  // has no account that gives it a model (#299), so it never runs with Lead's memory; the worker gives a waiting one the
  // Providers again until it answers (releaseKeyWaits), and makes one the Engine could not provide, as a lost one is. A
  // profile made for a call that then made no Agent is removed again; no Agent can
  // ever name it, since its name is that call's.
  /** @param {ToolContext} context @param {AgentArgs} args @returns {Promise<ToolOutcome>} */
  async run(context,args) {
   const refused=await keepTemperament(context,args);
   if(refused) return refused;
   const call=agentCall(context,args);
   // A call that already made its Agent answers it before the Engine is asked, so a repeat never waits on the Engine.
   /** @type {{state:'created',agent:string|null}|{profile:string,soul:string|null}|null} */
   const read=await answered(context.db,'lead_agent_profile',{conversation:call.conversation,run:call.run,call:call.call,instructions:call.instructions??null});
   if(read&&'state' in read) return read;
   const plan=read;
   const ready=await engineReady(context.engine,context.profile);
   if(ready!=='ready') return {state:ready};
   const made=plan?await context.engine.provideAgent({name:plan.profile,instructions:agentSoul(plan.soul),...companyProviders(context.profile)}):null;
   if(made?.state==='unreachable') return {state:'engineUnreachable'};
   const own=plan&&(made?.state==='provided'||made?.state==='noModel')?{own_profile:true,...(made.state==='noModel'?{own_answers:false}:{})}:{};
   await settleUnanswered(context);
   const outcome=await answered(context.db,'lead_create_agent',{...call,...own});
   if(plan&&made&&outcome?.state!=='created') await context.engine.removeAgent(plan.profile);
   return outcome;
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
   const refused=await keepTemperament(context,args);
   if(refused) return refused;
   const {data,error}=await context.db.rpc('lead_request_agent',agentCall(context,args));
   if(error) throw error;
   return data;
  },
 },
 // Offered by every Agent to any writer talking to it (#317, #475): a job for another Agent of the same Company, which
 // runs on its own profile and comes back here as the asking Agent's next turn. The database checks who may hand over
 // and that the target is another Agent of the Company, and keeps one handover per run and call. A Conversation's Run
 // is sent conversationHandOverSpec below, which names the Company's Agents; this text is what it extends.
 hand_to_agent:{
  spec:/** @type {import('./engine.mjs').ToolSpec} */({name:'hand_to_agent',
   description:'Hands a job in this chat to another agent of the team, which does it on its own and reports back here. Use it when the person asks for work that belongs to another agent, such as the Meta ads or the numbers. Give that agent\'s exact name, the job in a sentence or two as the person asked for it, and the context it needs from this chat. It works after your reply: say in your reply that you handed the job to it, and its result comes back here and you answer with it.',
   parameters:handOverParameters}),
  parse:handOverOf,
  run:handToAgent,
 },
 // Any Agent's: offered while the Conversation's person is an active Owner or Manager of the Company (#18). The rule
 // is then in this Agent's profile SOUL.md for every later run, whoever writes to it (lib/agent-rules.mjs).
 save_rule:{
  spec:/** @type {import('./engine.mjs').ToolSpec} */({name:'save_rule',
   description:'Saves a lasting rule the person told you to follow in your work from now on, such as "from now on, send nothing to a customer before I see it", in whatever language they said it. gtmworks gives you every saved rule with each of your later messages, from anyone in the company, until a person removes it. Use it only when they told you such a rule, and confirm the rule to them in your reply.',
   parameters:ruleParameters}),
  parse:ruleOf,
  run:keepRule,
 },
 // Any Agent's, in place of save_rule while the Conversation's person is an active Contributor (#25): the rule reaches
 // the Agent's SOUL.md once an Owner or a Manager approves it (#345), and not before. run_tools offers this version.
 suggest_team_rule:{
  spec:/** @type {import('./engine.mjs').ToolSpec} */({name:'suggest_team_rule',
   description:'Sends a lasting rule the person told you to follow in your work from now on, such as "from now on, send nothing to a customer before I see it", in whatever language they said it, to the company\'s Owner and Managers as a suggestion for the whole team. It does not reach you yet: once one of them approves it, gtmworks gives it to you for all your later work, with anyone in the company. Use it only when they told you such a rule, and say in your reply that you suggested it for the team and will follow it once it is approved.',
   parameters:ruleParameters}),
  parse:ruleOf,
  run:keepRule,
 },
 // The version a run pinned before 20270214000000 may have, kept byte for byte as it resends it; no new run is offered it,
 // as it says the rule reaches the teller at once, which is no longer so (#345).
 suggest_rule:{
  spec:/** @type {import('./engine.mjs').ToolSpec} */({name:'suggest_rule',
   description:'Saves a lasting rule the person told you to follow in your work with them from now on, such as "from now on, send nothing to a customer before I see it", in whatever language they said it. gtmworks gives it to you with each of their later messages at once, and sends it to the company\'s Owner and Managers as a suggestion for the whole team: once one of them approves it, it goes with everyone\'s messages. Use it only when they told you such a rule, and say both in your reply: you work this way with them from now on, and you suggested it for the team.',
   parameters:ruleParameters}),
  parse:ruleOf,
  run:keepRule,
 },
 // Any Agent's, offered while the Conversation's person is an active Owner, Manager or Contributor who sees it.
 show_draft:cardTool('draft',/** @type {import('./engine.mjs').ToolSpec} */({name:'show_draft',
  description:'Shows the person a draft you prepared for them, such as a campaign plan or an article outline, as a card under your reply: a title, one line under it, and up to eight label and value rows. The card only shows the draft: it approves, publishes and spends nothing. Use it when you prepared such a draft, and say in your reply what it is.',
  parameters:{type:'object',additionalProperties:false,required:['title','line'],properties:{
   title:{type:'string',maxLength:100,description:'The draft\'s name, such as "Campaign plan".'},
   line:{type:'string',maxLength:160,description:'One line under the title: what the draft is and where it goes, such as "Draft · Meta Ads".'},
   rows:{type:'array',maxItems:8,description:'The draft\'s main points, in order.',items:{type:'object',additionalProperties:false,required:['label','value'],properties:{
    label:{type:'string',maxLength:40,description:'A short name, such as "Budget".'},
    value:{type:'string',maxLength:240,description:'What it is, such as "EGP 500 a day".'}}}}}}}),draftOf),
 // Any Agent's, offered as show_draft is (#137).
 show_review:cardTool('review',/** @type {import('./engine.mjs').ToolSpec} */({name:'show_review',
  description:'Shows the person your review of texts you were asked to review, such as ad copy or an article\'s claims, as a card under your reply: a title, one line under it, one verdict per reviewed text (fine, or needs an edit, with your note), then your decision. The card only shows your review: it approves, publishes and spends nothing. Use it when you reviewed such texts, and say in your reply what you reviewed.',
  parameters:{type:'object',additionalProperties:false,required:['title','line','items','decision'],properties:{
   title:{type:'string',maxLength:100,description:'What you reviewed, such as "December ad copy review".'},
   line:{type:'string',maxLength:160,description:'One line under the title: how many texts, where they go and when, such as "3 texts · Meta Ads · before they go out".'},
   items:{type:'array',minItems:1,maxItems:8,description:'One verdict per reviewed text, in the order you reviewed them.',items:{type:'object',additionalProperties:false,required:['text','fine','note'],properties:{
    text:{type:'string',maxLength:240,description:'The reviewed text, as written.'},
    fine:{type:'boolean',description:'true when the text is fine as it is, false when it needs an edit.'},
    note:{type:'string',maxLength:240,description:'Why, and for an edit what to write instead.'}}}},
   decision:{type:'string',maxLength:160,description:'Your decision on the whole, such as "2 ready, 1 back to Ads with the alternative".'}}}}),reviewOf),
 // Any Agent's, offered as show_draft is (#139): a step no Agent may do, handed to the person.
 hand_over:cardTool('hand',/** @type {import('./engine.mjs').ToolSpec} */({name:'hand_over',
  description:'Hands the person a step you may not do yourself, such as publishing, paying or sending to a customer, as a card under your reply: a title, one line under it, the app the step is done in, up to eight label and value rows, the address of your draft when it has one, and a closing note. The person does the step in that app and presses Done it on the card. The card does not do the step: it approves, publishes and spends nothing. Use it when your work reaches such a step, and say in your reply what is left for them to do.',
  parameters:{type:'object',additionalProperties:false,required:['title','line','app'],properties:{
   title:{type:'string',maxLength:100,description:'The step, such as "Publish the article".'},
   line:{type:'string',maxLength:160,description:'One line under the title: what is ready and where, such as "The draft is ready in WordPress".'},
   app:{type:'string',maxLength:40,description:'The app the step is done in, such as WordPress.'},
   rows:{type:'array',maxItems:8,description:'What the person needs to know to do the step, in order.',items:{type:'object',additionalProperties:false,required:['label','value'],properties:{
    label:{type:'string',maxLength:40,description:'A short name, such as "Title".'},
    value:{type:'string',maxLength:240,description:'What it is.'}}}},
   url:{type:'string',maxLength:2000,description:'The https address of your draft in that app, when it has one. The person opens it in a new tab.'},
   note:{type:'string',maxLength:240,description:'A closing note shown on the card after the person marks the step done, such as what you will do next. A longer note is cut.'}}}}),handOf),
 // Any Agent's, offered as show_draft is (#203): an app it needs and does not have.
 ask_for_app:{
  spec:/** @type {import('./engine.mjs').ToolSpec} */({name:'ask_for_app',
   description:'Asks the person to connect an app you need for this work and do not have, as a card under your reply with the app and your reason. Only the company\'s Owner connects it, for you only, by signing in to the app themselves; until then you work without it. The card only asks: it approves, publishes and spends nothing. Use it when the work needs an app on this list that you cannot use yet, and say in your reply what you could do once it is connected.',
   parameters:{type:'object',additionalProperties:false,required:['app','reason'],properties:{
    app:{type:'string',enum:connectableApps.map(entry=>entry.key),description:'The app you need.'},
    reason:{type:'string',maxLength:200,description:'One line, in the person\'s language: why you need it, such as "To read which leads bought, so I can work out the return."'}}}}),
  parse:connectOf,
  run:askForApp,
 },
 // Any Agent's, offered as show_draft is (#19): a change to its own settings, or Lead's to another Agent's, that waits
 // for the Owner. Nothing changes until the Owner approves it.
 propose_change:{
  spec:/** @type {import('./engine.mjs').ToolSpec} */({name:'propose_change',
   description:'Proposes a change to your own settings, for the company\'s Owner to approve: your model, your core instructions, your sub-agents (toolset delegation), or one of your settings. The main agent may also propose one for another agent of the team, by its name. Nothing changes until the Owner approves it, and a change that is not on this list is refused; to get an app, use ask_for_app instead. Your memory and your skills are not proposed: you keep them yourself. Use it when a change would clearly help the work the person asked for, give the reason, and say in your reply that you proposed it and that nothing changes before the Owner\'s OK.',
   parameters:changeParameters}),
  parse:changeOf,
  run:proposeChange,
 },
 // The main Agent's, offered only while its person has an Agent hidden from them (#167; run_tools). The Run is told those
 // Agents' jobs and never their names (lib/lead-offer.mjs), so a call names a job; the database makes the card only for
 // an Agent with that job that is really hidden from the Conversation's person, in the same Company
 // (agent_ask_to_open), and ignores any other.
 ask_to_open_agent:{
  spec:/** @type {import('./engine.mjs').ToolSpec} */({name:'ask_to_open_agent',
   description:'Shows the person a card under your reply that asks whether to request an agent they do not have, for work that belongs to one of the jobs you were told are with agents hidden from them. The card names who opens agents for them; only their own press sends the request, and the answer comes back in this chat. Use it when they ask for such work, give that job exactly as you were told it, never name or describe the agent, and say in your reply that the job belongs to an agent they do not have and ask whether to request it.',
   parameters:{type:'object',additionalProperties:false,required:['job'],properties:{
    job:{type:'string',maxLength:200,description:'The job the work belongs to, exactly as it was written in your list of jobs with agents this person does not have.'}}}}),
  parse:(/** @type {unknown} */ args)=>{ const job=text(/** @type {{job?:unknown}|null} */(args)?.job,200); return job?{job}:null; },
  /** @param {ToolContext} context @param {{job:string}} args @returns {Promise<ToolOutcome>} */
  run:({db,conversation,run,call},{job})=>answered(db,'agent_ask_to_open',{conversation,run,call,job}),
 },
};

// Every tool's spec as the exact text the engine is sent, by name: the database pins the text of the ones a run is
// offered (pin_run), and every retry sends that text.
export const agentToolSpecs=Object.values(agentTools).map(tool=>tool.spec);
/** @returns {Record<string,string>} */
export const toolSpecTexts=()=>Object.fromEntries(agentToolSpecs.map(spec=>[spec.name,JSON.stringify(spec)]));

// The tool named for one place (#475, #476): the Company's other Agents with their job line, each name once. Their names
// are the enum of the one thing it may name, the list is written into its text, and the whole text is pinned with the
// Run (pin_run, pin_channel_run), so a retry sends the same request whoever the team became meanwhile. The answer comes
// back to the Agent that asked, which then replies: to the person in a Conversation, to the channel in a channel, where
// the asked Agent's answer also shows under its own name.
// Each place fills one sentence: "Hands a job {where} which does it…", "…the context it needs from {from}", and "Its answer
// comes back to you, the agent that asked, {back}". `where` ends in its comma, and `back` finishes the sentence.
const handOverPlaces={
 chat:{where:'in this chat to another agent of your company,',from:'this chat',back:'never to the person, and you then reply to the person with what came of it.'},
 channel:{where:'in this channel to another agent of your company, in this channel or not,',from:'this channel',back:'and shows in this channel under its own name; you then reply to the channel with what came of it.'},
 // #477: an asked Agent hands a part of the job it was given on, and answers the Agent that asked it once its own answer
 // came back.
 handover:{where:'you were given, or a part of it, to another agent of your company,',from:'the job you were given',back:'never to the person, and you then answer the agent that gave you the job with what came of it.'},
};
/** @param {{name:string,job?:string|null}[]} agents @param {keyof typeof handOverPlaces} place @returns {import('./engine.mjs').ToolSpec} */
const namedHandOverSpec=(agents,place)=>{
 const {where,from,back}=handOverPlaces[place];
 const names=[...new Set(agents.map(agent=>agent.name.trim()))];
 const lines=names.map(name=>{ const job=agents.find(agent=>agent.name.trim()===name)?.job?.trim(); return job?`- ${name}: ${job}`:`- ${name}`; });
 return {...agentTools.hand_to_agent.spec,
  description:`Hands a job ${where} which does it on its own and answers you. Use it when the work, or a part of it you need, belongs to another agent, such as the Meta ads or last campaign's numbers. Name one of these agents exactly; each is listed with its job:\n${lines.join('\n')}\nGive the job in a sentence or two, and the context it needs from ${from}. It works after your reply: say in your reply which agent you asked. Its answer comes back to you, the agent that asked, ${back}`,
  parameters:handOverParametersFor(names)};
};
/** The Agents the database listed that have a name. @param {unknown[]} agents @returns {{name:string,job?:string|null}[]} */
const namedAgents=agents=>agents.flatMap(agent=>{ const listed=/** @type {{name?:unknown,job?:unknown}|null} */(agent); return typeof listed?.name==='string'&&listed.name.trim()?[{name:listed.name,job:typeof listed.job==='string'?listed.job:null}]:[]; });
/** @param {{name:string,job?:string|null}[]} agents */
export const conversationHandOverSpec=agents=>namedHandOverSpec(agents,'chat');
/** @param {{name:string,job?:string|null}[]} agents */
export const channelHandOverSpec=agents=>namedHandOverSpec(agents,'channel');
/** The one gtmworks tool an asked Agent's Run is offered (#477), as the exact text pinned with its handover
 * (pin_handover_tools): hand_to_agent naming the Agents the database listed for it (begin_handover's targets), and nothing when
 * there is none. No tool that shows the person a card: nobody reads that Run. @param {unknown[]} agents @returns {string|null} */
export const handoverToolSpecText=agents=>{ const targets=namedAgents(agents); return targets.length?JSON.stringify(namedHandOverSpec(targets,'handover')):null; };
/** The tools a Conversation's Run may be offered, as the exact text pin_run pins: hand_to_agent names the Agents the
 * database listed for it (conversation_handover_agents), and is left out when there is none to hand to.
 * @param {{name:string,job?:string|null}[]} agents @returns {Record<string,string>} */
export const conversationToolSpecTexts=agents=>{
 const texts=Object.fromEntries(Object.entries(toolSpecTexts()).filter(([name])=>name!=='hand_to_agent'));
 const targets=namedAgents(agents);
 return targets.length?{...texts,hand_to_agent:JSON.stringify(conversationHandOverSpec(targets))}:texts;
};
/** The tools a channel Run may be offered, as the exact text pinned with it (pin_channel_run): the card tools, and
 * hand_to_agent naming the Agents the database listed for it (channel_handover_targets), left out when there is none.
 * @param {{name:string,job?:string|null}[]} agents @returns {Record<string,string>} */
export const channelToolSpecTexts=agents=>{
 const texts=toolSpecTexts();
 const specs={show_draft:texts.show_draft,show_review:texts.show_review,hand_over:texts.hand_over};
 const targets=namedAgents(agents);
 return targets.length?{...specs,hand_to_agent:JSON.stringify(channelHandOverSpec(targets))}:specs;
};

/** @param {Omit<ToolContext,'call'>} context @param {import('./engine.mjs').ToolCall} call @returns {Promise<ToolOutcome>} */
export async function runToolCall(context,call) {
 const tool=Object.hasOwn(agentTools,call.name)?agentTools[/** @type {keyof typeof agentTools} */(call.name)]:undefined;
 const args=tool?.parse(call.arguments);
 return tool&&args?tool.run({...context,call:call.id},args):{state:'ignored'};
}
