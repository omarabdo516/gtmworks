// #143: what Lead is told with each Run, besides its profile's own instructions. The brief is pinned once per Run
// (pin_lead_brief) and names the person's role, the Owner's first name and the Agents that person sees. Lead's own words
// are the Engine's, but the words of the offer and its choices are the approved reference's, so they are given here in
// English and in Egyptian Arabic (the catalogue pair beside this file), and the Engine writes them in the person's
// language.
//
// A person who may read but not write is offered nothing. Anyone else is offered one question for work no Agent of
// theirs does: "Make it?" to an Owner, "Ask <Owner> for it?" to a Manager or a Contributor, with "Not now" as the other
// choice. A job an Agent on the list does is handed to that Agent with hand_to_agent, not offered as a new Agent.
import en from './messages/lead-offer.en.json' with { type: 'json' };
import ar from './messages/lead-offer.ar.json' with { type: 'json' };

/** @typedef {{role:'owner'|'manager'|'contributor'|'viewer'|null,owner:string|null,agents:{name:string,job:string}[]}} LeadBrief */

const list=/** @param {{name:string,job:string}} agents */ agent=>`- ${agent.name.trim()}: ${agent.job.trim()}`;
/** @param {string} phrase @param {string} name */
const fill=(phrase,name)=>phrase.replace('{0}',name);
// The one question this person's Role is asked, with the reference's words in English and in Egyptian Arabic, and what
// the answer makes Lead do in the same Run.
/** @param {'owner'|'manager'|'contributor'} role @param {string} ownerEn @param {string} ownerAr */
const offerWords=(role,ownerEn,ownerAr)=>{
 const asked=role==='owner'
  ?`the question "${en.makeIt}" with the choices "${en.makeItChoice}" and "${en.notNow}" (in Arabic: «${ar.makeIt}» with «${ar.makeItChoice}» and «${ar.notNow}»). After "${en.makeItChoice}", call create_agent in the same run for the work they asked for.`
  :`the question "${fill(en.askForIt,ownerEn)}" with the choices "${fill(en.askForItChoice,ownerEn)}" and "${en.notNow}" (in Arabic: «${fill(ar.askForIt,ownerAr)}» with «${fill(ar.askForItChoice,ownerAr)}» and «${ar.notNow}»). After "${fill(en.askForItChoice,ownerEn)}", call request_agent in the same run for the work they asked for.`;
 return `When they ask for work that none of those agents does, ask them one question before you act, in their language and with these words and choices: ${asked} After "${en.notNow}", say you can make it whenever they want, and make nothing. When the job belongs to one of the agents above, hand it to that agent with hand_to_agent instead of asking this.`;
};

/**
 * The text a Run of the main Agent carries: the team its person sees, and the offer to make one more (or to ask the
 * Owner for one). Blank for a person with no place in the Company, whose Runs start none.
 * @param {LeadBrief} brief
 * @returns {string}
 */
export function leadInstructions(brief) {
 const role=brief?.role ?? null;
 if(!role) return '';
 const agents=(Array.isArray(brief.agents)?brief.agents:[]).filter(agent=>agent&&typeof agent.name==='string'&&agent.name.trim());
 const sees=agents.length
  ?`The person writing to you sees these agents on their team besides you. They are the whole team that person sees: never name an agent that is not on this list.\n${agents.map(list).join('\n')}`
  :'The person writing to you sees no other agent on their team yet.';
 if(role==='viewer') return `${sees}\n\nThey may read but not write: never offer to make an agent, and never offer to ask for one.`;
 if(role!=='owner'&&role!=='manager'&&role!=='contributor') return sees;
 const owner=typeof brief.owner==='string'&&brief.owner.trim()?brief.owner.trim():null;
 return `${sees}\n\n${offerWords(role,owner||en.ownerFallback,owner||ar.ownerFallback)}`;
}
