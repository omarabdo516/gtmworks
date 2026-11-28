import { randomUUID } from 'node:crypto';
import { i18n } from './i18n.mjs';

// #434: Lead opens a new Company's first Conversation. When an active Owner opens the main Agent's chat, or an empty
// Conversation with it, while the Company has a model and nothing was written in it yet, the database makes Lead's
// message, in the Owner's language, the first of the Owner's Conversation with it: it says Lead manages the team and asks what the Company sells, to whom, and the goal now
// (open_first_conversation, once per Company). The Owner's answer is met with the first Agents to make, through the
// brief of its Run (lib/lead-offer.mjs). `service` is a service-role client, so nobody else can write Lead's words.

/** Lead's opening, in the Owner's language. @param {string} language @param {{owner:string,lead:string,company:string}} names */
export const openingWords=(language,{owner,lead,company})=>i18n(language).t('leadOpening',owner,lead,company);

// #882: in a Company whose Conversations are the Engine's, the opening is no message. An Engine session holds a message
// only once a Run made it, and a Run would put a person's message before it, so the database marks the Conversation the
// main Agent opened (conversations.lead_opening) and the opening is drawn at its top from these words, in the Owner's
// language as they read it (lib/conversation-messages.ts). The Owner's answer is the session's first Run: it is given
// the opening as its history, so the Agent answers what it asked, and is told to propose the first Agents to make.
/** The opening of a Conversation on the Engine, from its person's name and language and the Agent's and Company's names
 * as the database or the page reads them. @param {{owner?:string|null,language?:string|null,lead:string,company?:string|null}} names */
export const openingFor=({owner,language,lead,company})=>openingWords(language==='ar'?'ar':'en',{owner:String(owner??'').split(' ')[0]||'',lead,company:company??''});

/** The first answer's Run, told it answers the opening. @param {string} opening @returns {{history:import('./engine.mjs').HistoryEntry[],instructions:string}} */
export function answeringOpening(opening) {
 return {history:[{role:'assistant',content:opening}],
  instructions:'You opened this conversation, before they wrote anything, with the message before theirs. Their message answers it: propose the first two or three agents to make for this company from what they told you, each with its name and its job.'};
}

/** The Conversation opened now, or null when the Company is not to be opened (something was written in it already, or
 * `person` is not an active Owner). `conversation` is the one to open when it is the Owner's with Lead, else the id a
 * new one gets. @param {any} service @param {{company:string,person:string,body:string,conversation?:string}} opening
 * @returns {Promise<string|null>} */
async function openFirstConversation(service,{company,person,body,conversation=randomUUID()}) {
 const {data,error}=await service.rpc('open_first_conversation',{c:company,person,conversation,body});
 if(error) throw new Error(error.message);
 return typeof data==='string'?data:null;
}

/** An Owner's visit to Lead, its empty chat or an empty Conversation with it: the opening is written once the Company has
 * a model (lib/provider-keys.mjs companyHasModel, #422), and never on a read that could not tell. Answers the Conversation
 * opened, or null. @param {any} service @param {{model:Promise<boolean|null>|boolean|null,company:string,person:string,conversation?:string,language:string,owner:string,lead:string,companyName:string}} visit */
export async function openOnVisit(service,{model,company,person,conversation,language,owner,lead,companyName}) {
 if(await model!==true) return null;
 return openFirstConversation(service,{company,person,conversation,body:openingWords(language,{owner:owner.split(' ')[0]||'',lead,company:companyName})});
}
