// The tools gtmworks offers an Agent through the engine contract (ADR 0009), one entry per tool name: what the engine
// is told, how a call's arguments are read, and what gtmworks does with a call. The database decides which tools a run
// is offered and pins their text at its first start (pin_run); the model decides when to call one; gtmworks
// decides whether it is allowed, when the call is carried out, in the database. A call to an unknown tool, or with
// arguments that do not read, is ignored and never holds up closing its run.

import { instructionsOf, roleAppNames, roleTemplates } from './role-templates.mjs';
import { toolPolicy } from './agent-levels.mjs';
import { agentSoul } from './company-profiles.mjs';
import { settleHolds } from './provider-keys.mjs';
import { apps, appByKey } from './app-catalogue.mjs';

/** @param {unknown} value @param {number} most */
const text=(value,most)=>typeof value==='string'&&!value.includes('\u0000')&&value.trim().length>=1&&value.trim().length<=most?value.trim():null;

// A channel Run's calls are carried out for its message (#148), not a Conversation: the card tools name the message
// whose Run showed the card.
/** @typedef {{db:any,engine:import('./engine.mjs').Engine,profile:string,conversation?:string,channel?:{message:number},run:string,call:string}} ToolContext */
/** @typedef {{state:'created',agent:string|null}|{state:'requested',request:number}|{state:'saved'|'suggested',rule:string}|{state:'shown',card:number}|{state:'refused'|'invalid'|'engineNotReady'|'engineUnreachable'|'ignored'}} ToolOutcome */

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
 return app&&reason&&Array.from(reason).length<=200?{app:app.key,reason}:null;
}
/** @param {ToolContext} context @param {{app:string,reason:string}} args @returns {Promise<ToolOutcome>} */
async function askForApp({db,engine,conversation,run,call},{app,reason}) {
 const read=engine.apps?await engine.apps():{state:/** @type {const} */('failed'),apps:null};
 if(read.state==='unreachable') return {state:'engineUnreachable'};
 const state=read.apps?.find(entry=>entry.key===app)?.state;
 if(!state||state==='connected') return {state:'ignored'};
 return answered(db,'agent_show_card',{conversation,run,call,kind:'connect',title:appByKey(app)?.name,content:{app,reason}});
}

// #317: only the Lead hands work to another Agent (decision 0043). The call is kept when Lead's Run closes
// (lead_hand_to_agent), and lib/handovers.mjs then runs the job on that Agent's own profile and brings Lead back with
// what came of it. The model gives an Agent's exact name, the job and the context; nothing is resolved here.
const handOverParameters={type:'object',additionalProperties:false,required:['agent','goal'],properties:{
 agent:{type:'string',maxLength:100,description:'The exact name of the agent the work belongs to, as the team knows it.'},
 goal:{type:'string',maxLength:500,description:'The job, in one or two sentences, as the person asked for it.'},
 context:{type:'string',maxLength:2000,description:'What that agent needs from this chat to do the job: the decisions, figures and links already here.'}}};
/** @param {unknown} args @returns {{agent:string,goal:string,context:string|null}|null} */
function handOverOf(args) {
 const value=/** @type {{agent?:unknown,goal?:unknown,context?:unknown}|null} */(args);
 const agent=text(value?.agent,100); const goal=text(value?.goal,500);
 const raw=value?.context; const brief=raw==null?null:text(raw,2000);
 return agent&&goal&&(raw==null||brief)?{agent,goal,context:brief}:null;
}
/** @param {ToolContext} context @param {{agent:string,goal:string,context:string|null}} args @returns {Promise<ToolOutcome>} */
async function handToAgent({db,conversation,channel,run,call},{agent,goal,context}) {
 // #150: the same handover inside a channel, kept by the channel message whose Run made the call. Only the channel's own
 // Agents are targets, whatever the model names.
 const {data,error}=channel
  ? await db.rpc('channel_hand_to_agent',{message:channel.message,run,call,agent_name:agent,goal,context})
  : await db.rpc('lead_hand_to_agent',{conversation,run,call,agent_name:agent,goal,context});
 if(error) throw error;
 return data;
}

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
  // made it with the level's tools and it can answer, and to Lead's profile as before otherwise. While the Company holds
  // a provider key it is attached to its own profile whatever the Engine answered, and waits there for the Owner's next
  // set unless it can answer (#299), so it never runs with Lead's memory; one the Engine could not provide is then made
  // by the worker, as a lost one is. A profile made for a call that then made no Agent is removed again; no Agent can
  // ever name it, since its name is that call's.
  /** @param {ToolContext} context @param {AgentArgs} args @returns {Promise<ToolOutcome>} */
  async run(context,args) {
   const call=agentCall(context,args);
   // A call that already made its Agent answers it before the Engine is asked, so a repeat never waits on the Engine.
   /** @type {{state:'created',agent:string|null}|{profile:string,soul:string|null,level:import('./engine.mjs').AgentLevel}|null} */
   const read=await answered(context.db,'lead_agent_profile',{conversation:call.conversation,run:call.run,call:call.call,instructions:call.instructions??null});
   if(read&&'state' in read) return read;
   const plan=read;
   const ready=await engineReady(context.engine,context.profile);
   if(ready!=='ready') return {state:ready};
   const made=plan?await context.engine.provideAgent({name:plan.profile,instructions:agentSoul(plan.soul),level:plan.level}):null;
   if(made?.state==='unreachable') return {state:'engineUnreachable'};
   const own=plan&&(made?.state==='provided'||made?.state==='noModel')?{own_level:plan.level,own_policy:toolPolicy,...(made.state==='noModel'?{own_answers:false}:{})}:{};
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
   const {data,error}=await context.db.rpc('lead_request_agent',agentCall(context,args));
   if(error) throw error;
   return data;
  },
 },
 // Offered by the Lead to any writer talking to it (#317): a job for another Agent of the same Company, which runs on
 // its own profile and comes back here as Lead's next turn. The database checks who may hand over and that the target
 // is an Agent of the Company the person sees, and keeps one handover per run and call.
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
    app:{type:'string',enum:apps.map(entry=>entry.key),description:'The app you need.'},
    reason:{type:'string',maxLength:200,description:'One line, in the person\'s language: why you need it, such as "To read which leads bought, so I can work out the return."'}}}}),
  parse:connectOf,
  run:askForApp,
 },
};

// Every tool's spec as the exact text the engine is sent, by name: the database pins the text of the ones a run is
// offered (pin_run), and every retry sends that text.
export const agentToolSpecs=Object.values(agentTools).map(tool=>tool.spec);
/** @returns {Record<string,string>} */
export const toolSpecTexts=()=>Object.fromEntries(agentToolSpecs.map(spec=>[spec.name,JSON.stringify(spec)]));

// #150: the same tool inside a channel, told the channel's other Agents alone: they are the enum of the one thing it may
// name, and the whole list is pinned with its Run (channel_runs.tools, pin_channel_run). The database also refuses a
// target outside the channel, so a name the model wrote from anywhere else reaches nothing.
/** @param {string[]} names @returns {import('./engine.mjs').ToolSpec} */
export const channelHandOverSpec=names=>({...agentTools.hand_to_agent.spec,
 description:'Hands a job in this channel to another agent of it, which does it on its own and reports back here. Use it when the person asks for work that belongs to another agent of this channel, such as the Meta ads or the numbers. Name one of the channel\'s agents exactly, from this list: ' + names.join(', ') + '. Give the job in a sentence or two as the person asked for it, and the context it needs from this channel. It works after your reply: say in your reply that you handed the job to it, and its result comes back here and you answer with it.',
 parameters:{...handOverParameters,properties:{...handOverParameters.properties,agent:{...handOverParameters.properties.agent,enum:names}}}});
// The tools a channel Run may be offered, as the exact text pinned with it (pin_channel_run), and the channel's handover
// only when the database named the Agents it may go to (#150).
/** @param {string[]} names @returns {Record<string,string>} */
export const channelToolSpecTexts=names=>{
 const texts=toolSpecTexts();
 const specs={show_draft:texts.show_draft,show_review:texts.show_review,hand_over:texts.hand_over};
 return names.length?{...specs,hand_to_agent:JSON.stringify(channelHandOverSpec(names))}:specs;
};

/** @param {Omit<ToolContext,'call'>} context @param {import('./engine.mjs').ToolCall} call @returns {Promise<ToolOutcome>} */
export async function runToolCall(context,call) {
 const tool=Object.hasOwn(agentTools,call.name)?agentTools[/** @type {keyof typeof agentTools} */(call.name)]:undefined;
 const args=tool?.parse(call.arguments);
 return tool&&args?tool.run({...context,call:call.id},args):{state:'ignored'};
}
