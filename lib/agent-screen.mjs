import { engineOf } from './company-engine.mjs';
import { engineFor } from './engine.mjs';
import { uuid } from './company-apps.mjs';

// An Agent's Screen in its details (#712, spec #710): its state, "Wake it" and its picture, read through its Company's
// Engine on the Agent's own profile and never by an address the browser holds (ADR 0011). `db` is the signed-in
// person's own session: company_app_agents lists the Agents they see and the profile each runs on, so a hidden Agent,
// another Company's Agent and an Agent with no profile are all missing here. The profile never leaves this file.
//
// One awake Screen per Company (vault decision 0068): the pinned Engine gives a Company's sandbox one display and one
// browser profile, shared by its Agents, so one Agent's Screen is awake at a time. Each Agent's card reads its own
// profile's Screen: Awake only while its own profile holds the display. While another Agent of the Company the reader
// sees holds it, this Agent's Screen reads asleep with why a start would be refused now (`busy`, naming that Agent), and
// "Wake it" says so without asking the Engine, which would only fail after its 20 seconds. An Agent the reader does not
// see is never named: a start then fails on the Engine as it would, and reads as the start that did not come up.

/** @typedef {{state:'none'|'asleep'|'awake',control:'agent'|'person',refusal:null|'missing'|'busy',busy?:string}} AgentScreen */

// The Agents this person sees in this Company, each with the profile it runs on.
/** @param {any} db @param {string} company @returns {Promise<{agent:string,name:string,profile:string}[]|null>} */
async function seenAgents(db,company) {
 const {data,error}=await db.rpc('company_app_agents',{c:company});
 if(error||!Array.isArray(data)) return null;
 return data.filter(row=>typeof row?.agent==='string'&&typeof row.profile==='string').map(row=>({agent:row.agent,name:String(row.name??''),profile:row.profile}));
}

/** @param {any} db @param {{company:string,agent:unknown,hermes?:any,engine?:typeof engineFor}} request */
async function target(db,{company,agent,hermes=engineOf(company),engine=engineFor}) {
 if(typeof agent!=='string'||!uuid.test(agent)) return null;
 const [seen,connection]=await Promise.all([seenAgents(db,company),hermes]);
 const own=seen?.find(row=>row.agent===agent);
 if(!own||!seen) return null;
 return {own,seen,connection,engine};
}

// The Agent the reader sees whose profile holds the Company's one display now, other than this one, or null.
/** @param {any} at @returns {Promise<string|null>} */
async function holder(at) {
 const others=[...new Map(at.seen.filter(row=>row.profile!==at.own.profile).map(row=>[row.profile,row])).values()];
 const reads=await Promise.all(others.map(row=>at.engine({...at.connection,profile:row.profile}).screen()));
 const index=reads.findIndex(read=>read.state==='found'&&read.screen.state==='awake');
 return index<0?null:others[index].name;
}

// The Screen as the card draws it: found, with its state, or missing (no such Agent for this person) or unreachable. A
// Company with no Engine has no Screen to show (none).
/** @param {any} db @param {{company:string,agent:unknown,hermes?:any,engine?:typeof engineFor}} request @returns {Promise<{state:'found',screen:AgentScreen}|{state:'missing'|'unreachable'}>} */
export async function readAgentScreen(db,request) {
 const at=await target(db,request);
 if(!at) return {state:'missing'};
 if(!at.connection) return {state:'found',screen:{state:'none',control:'agent',refusal:null}};
 const read=await at.engine({...at.connection,profile:at.own.profile}).screen();
 if(read.state!=='found') return {state:read.state==='missing'?'missing':'unreachable'};
 if(read.screen.state!=='asleep'||read.screen.refusal) return {state:'found',screen:read.screen};
 const busy=await holder(at);
 return {state:'found',screen:busy?{...read.screen,refusal:'busy',busy}:read.screen};
}

// "Wake it": the database says first whether this person may (check_screen_wake: a Member who is not a Viewer and sees
// the Agent), then the Engine starts the Screen; an awake Screen is one row of the Company log with the person and the
// Agent (log_screen_woken). An Agent already awake is awake with nothing logged. Answers: awake, notStarted with why
// (missing, busy with the Agent that holds the display, failed), notAllowed, missing or unreachable.
/** @param {any} db @param {{company:string,agent:unknown,hermes?:any,engine?:typeof engineFor}} request */
export async function wakeAgentScreen(db,request) {
 const at=await target(db,request);
 if(!at) return {state:'missing'};
 const allowed=await db.rpc('check_screen_wake',{c:request.company,agent:at.own.agent});
 if(allowed.error) return {state:allowed.error.code==='42501'?'notAllowed':'failed'};
 if(!at.connection) return {state:'unreachable'};
 const engine=at.engine({...at.connection,profile:at.own.profile});
 const now=await engine.screen();
 if(now.state!=='found') return {state:now.state==='missing'?'missing':'unreachable'};
 if(now.screen.state==='awake') return {state:'awake'};
 if(now.screen.state==='none') return {state:'notStarted',reason:'failed'};
 if(now.screen.refusal==='missing') return {state:'notStarted',reason:'missing'};
 const busy=await holder(at);
 if(busy) return {state:'notStarted',reason:'busy',busy};
 const woken=await engine.wakeScreen();
 if(woken.state==='notStarted') return {state:'notStarted',reason:woken.reason};
 if(woken.state!=='awake') return {state:woken.state==='missing'?'missing':'unreachable'};
 await screenLogged(db,'log_screen_woken',request.company,at.own.agent);
 return {state:'awake'};
}

// One Company log row about a Screen (woken, control taken, control given back): what it records happened whatever the
// log says, so a row the database refuses is reported to the server's log and nothing else.
/** @param {any} db @param {'log_screen_woken'|'log_screen_taken'|'log_screen_given_back'} fn @param {string} company @param {string} agent */
export async function screenLogged(db,fn,company,agent) {
 const {error}=await db.rpc(fn,{c:company,agent});
 if(error) console.error(JSON.stringify({event:'screen_log_failed',fn,company,agent,code:error.code??null}));
}

// One picture of the Screen, for the card and the view: found (its type and bytes), asleep, withheld (a person controls
// it), missing, unreachable or failed.
/** @param {any} db @param {{company:string,agent:unknown,hermes?:any,engine?:typeof engineFor}} request */
export async function agentScreenPicture(db,request) {
 const at=await target(db,request);
 if(!at) return {state:'missing'};
 if(!at.connection) return {state:'asleep'};
 return await at.engine({...at.connection,profile:at.own.profile}).screenPicture();
}

// The steps handed over on an Agent's Screen that wait on this person (#714): the open hand cards with "on my screen" of
// their own Conversations (screen_hands), newest first. The sidebar's poll carries them, so the Agent's screen card, its
// view and the toast on arrival follow them wherever the person is. A read that fails is none.
/** @param {any} db @param {string} company @returns {Promise<{card:number,conversation:string,agent:string,agent_name:string,title:string,app:string}[]>} */
export async function screenHands(db,company) {
 const {data,error}=await db.rpc('screen_hands',{c:company});
 if(error||!Array.isArray(data)) return [];
 return data.flatMap(row=>Number.isSafeInteger(Number(row?.card))&&typeof row.conversation==='string'&&typeof row.agent==='string'
  ?[{card:Number(row.card),conversation:row.conversation,agent:row.agent,agent_name:String(row.agent_name??''),title:String(row.title??''),app:String(row.app??'')}]:[]);
}
