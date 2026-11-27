// #143: what Lead is told with each Run, besides its profile's own instructions. The brief is pinned once per Run
// (pin_run_brief) and names the person's role, the Owner's first name and the Agents that person sees. Lead's own words
// are the Engine's, but the words of the offer and its choices are the approved reference's, so they are given here in
// English and in Egyptian Arabic (the catalogue pair beside this file), and the Engine writes them in the person's
// language.
//
// A person who may read but not write is offered nothing. Anyone else is offered one question for work no Agent of
// theirs does: "Make it?" to an Owner, "Ask <Owner> for it?" to a Manager or a Contributor, with "Not now" as the other
// choice. A job an Agent on the list does is given to that Agent as a Card on the board, not offered as a new Agent.
//
// #167: a Manager's or a Contributor's brief also lists the jobs of the Agents hidden from them (`hidden`), each with the
// first name and Role of the person who opens one for them, and never the Agent's name. For such a job Lead says, in the
// reference's words, that it belongs to an agent they do not have and asks whether to request it, and shows the card
// that asks (ask_to_open_agent); it never offers to make an Agent for that job.
//
// Spec #831 (#844): every Agent's Run carries the brief (pinned the same way), and an Agent gives a job to another Agent,
// or keeps long work of its own, as a Card on the Company's board with the Engine's own Kanban tool, kanban_create
// (docs/engine-probes/kanban-board.md, sections 4 and 5): the brief names each Agent's board name (the profile the
// Engine knows it by, `board`) and the Run's own (`self`). gtmworks offers no tool of its own for it and reads nothing
// of it from the reply. A job command sent to the main Agent (#358, #470) asks it to make one Card for the Agent of that
// role. A brief pinned before this change has neither `main` nor `self`: it was the main Agent's, with no board.
import en from './messages/lead-offer.en.json' with { type: 'json' };
import ar from './messages/lead-offer.ar.json' with { type: 'json' };
import { jobCommandIn } from './composer-mentions.mjs';

/** @typedef {{job:string,asks:string,role:'owner'|'manager'|string}} HiddenJob */
/** @typedef {{name:string,job:string,board?:string|null,role?:string|null}} BriefAgent */
/** @typedef {{role:'owner'|'manager'|'contributor'|'viewer'|null,owner:string|null,agents:BriefAgent[],opening?:string|null,hidden?:HiddenJob[],main?:boolean,self?:string|null}} LeadBrief */

// #434: the Owner's answer to the opening Lead wrote with its questions about the Company (lib/lead-opening.mjs), and only
// that Run (pin_run_brief), is met with the first Agents to make, each offered with the Owner's own question.
/** @param {string} opening */
const openingBrief=opening=>`You opened this conversation, before they wrote anything, with this message:\n\n${opening}\n\nTheir message answers it: propose the first two or three agents to make for this company from what they told you, each with its name and its job, then ask the question below about each one in turn, the first one first.`;

const list=/** @param {BriefAgent} agent */ agent=>`- ${agent.name.trim()}: ${String(agent.job??'').trim()}${agent.board?` (board name: ${agent.board})`:''}`;
/** @param {string} phrase @param {string} name */
const fill=(phrase,name)=>phrase.replace('{0}',name);
// The one question this person's Role is asked, with the reference's words in English and in Egyptian Arabic, and what
// the answer makes Lead do in the same Run.
/** @param {'owner'|'manager'|'contributor'} role @param {string} ownerEn @param {string} ownerAr @param {boolean} [hidden] */
const offerWords=(role,ownerEn,ownerAr,hidden=false)=>{
 const asked=role==='owner'
  ?`the question "${en.makeIt}" with the choices "${en.makeItChoice}" and "${en.notNow}" (in Arabic: «${ar.makeIt}» with «${ar.makeItChoice}» and «${ar.notNow}»). After "${en.makeItChoice}", call create_agent in the same run for the work they asked for.`
  :`the question "${fill(en.askForIt,ownerEn)}" with the choices "${fill(en.askForItChoice,ownerEn)}" and "${en.notNow}" (in Arabic: «${fill(ar.askForIt,ownerAr)}» with «${fill(ar.askForItChoice,ownerAr)}» and «${ar.notNow}»). After "${fill(en.askForItChoice,ownerEn)}", call request_agent in the same run for the work they asked for.`;
 return `When they ask for work that none of those agents does${hidden?' and that is none of the jobs listed above':''}, ask them one question before you act, in their language and with these words and choices: ${asked} After "${en.notNow}", say you can make it whenever they want, and make nothing. When the job belongs to one of the agents above, give it to that agent as a card on the board instead of asking this.`;
};

// The jobs of the Agents hidden from the person, as the brief lists them: never a name, only the job and the words to
// say, which name the person who opens one.
/** @param {HiddenJob[]} jobs */
const hiddenWords=jobs=>{
 const said=(/** @type {HiddenJob} */ entry,/** @type {typeof en} */ words)=>words.hiddenAsk.replace(/\{([01])\}/g,(_,index)=>index==='0'?entry.asks.trim():entry.role==='owner'?words.roleOwner:words.roleManager);
 const lines=jobs.map(entry=>`- "${entry.job.trim()}": say "${said(entry,en)}" (in Arabic: «${said(entry,ar)}»)`);
 return `Some work in this company belongs to agents this person does not have. Never name those agents, never guess or describe who they are, and never offer to make an agent for this work. Their jobs, each with the words to say when the person asks for that work:\n${lines.join('\n')}\nWhen they ask for work that belongs to one of these jobs, say those words in their language, then call ask_to_open_agent in the same run with the job exactly as written above. The card under your reply asks them and sends the request; do nothing more for that work until they have their answer.`;
};

// How a Card is made on the Company's board (the Engine's own Kanban board), and the Run's own board name.
/** @param {string} self */
const boardWords=self=>`Your company's board is your agent engine's own Kanban board, which every member of the company reads. To give a job to another agent of your company, or to keep long work of your own on the board, make a card with kanban_create: a short title, the job and what it needs from this chat as its body, and as its assignee the board name of the agent who does it (yours is ${self}). That agent starts on it by itself, and you are told its result when it ends. Say in your reply which card you made and for which agent.`;
// A job command (#358, #470): the job after the command goes to the Agent of its role as one Card, by the same rule the
// composer and the send path read it with (lib/composer-mentions.mjs), over the Agents the person sees.
/** @param {BriefAgent[]} agents @param {string} message */
const commandWords=(agents,message)=>{
 const job=jobCommandIn(message,agents);
 const agent=job&&agents.find(each=>each.name===job.agent&&each.board);
 return job&&agent?`This message is the job command ${job.command} for ${agent.name}: make one card for ${agent.name} with kanban_create, its assignee ${agent.board}, for this job: ${job.goal}\nSay in your reply that you gave the job to ${agent.name}; do the job yourself only if the card could not be made.`:'';
};

/**
 * The text a Run carries: for the main Agent, the team its person sees and the offer to make one more (or to ask the
 * Owner for one); for every Agent, the board names it gives a job to as a Card, and, to the main Agent, the job command
 * the message is. Blank for a person with no place in the Company, whose Runs start none.
 * @param {LeadBrief} brief
 * @param {string} [message] the person's message the Run answers
 * @returns {string}
 */
export function leadInstructions(brief,message='') {
 const role=brief?.role ?? null;
 if(!role) return '';
 const agents=(Array.isArray(brief.agents)?brief.agents:[]).filter(agent=>agent&&typeof agent.name==='string'&&agent.name.trim());
 const self=role!=='viewer'&&typeof brief.self==='string'&&brief.self?brief.self:null;
 const board=self?boardWords(self):'';
 if(brief.main===false) {
  if(!self) return '';
  const others=agents.filter(agent=>agent.board);
  return [others.length?`The other agents of your company, each with its board name:\n${others.map(list).join('\n')}`:'',board].filter(Boolean).join('\n\n');
 }
 const job=self?commandWords(agents,message):'';
 return [leadOffer(brief,role,self?agents:agents.map(({board:_name,...agent})=>agent)),board,job].filter(Boolean).join('\n\n');
}

/** @param {LeadBrief} brief @param {NonNullable<LeadBrief['role']>} role @param {BriefAgent[]} agents */
function leadOffer(brief,role,agents) {
 const sees=agents.length
  ?`The person writing to you sees these agents on their team besides you. They are the whole team that person sees: never name an agent that is not on this list.\n${agents.map(list).join('\n')}`
  :'The person writing to you sees no other agent on their team yet.';
 if(role==='viewer') return `${sees}\n\nThey may read but not write: never offer to make an agent, and never offer to ask for one.`;
 if(role!=='owner'&&role!=='manager'&&role!=='contributor') return sees;
 const owner=typeof brief.owner==='string'&&brief.owner.trim()?brief.owner.trim():null;
 const opening=role==='owner'&&typeof brief.opening==='string'&&brief.opening.trim()?`${openingBrief(brief.opening.trim())}\n\n`:'';
 const jobs=role==='owner'?[]:(Array.isArray(brief.hidden)?brief.hidden:[]).filter(entry=>entry&&typeof entry.job==='string'&&entry.job.trim()&&typeof entry.asks==='string'&&entry.asks.trim());
 const hidden=jobs.length?`${hiddenWords(jobs)}\n\n`:'';
 return `${sees}\n\n${opening}${hidden}${offerWords(role,owner||en.ownerFallback,owner||ar.ownerFallback,jobs.length>0)}`;
}
