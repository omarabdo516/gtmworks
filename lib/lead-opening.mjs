import { randomUUID } from 'node:crypto';
import { i18n } from './i18n.mjs';

// #434: Lead opens a new Company's first Conversation. When an active Owner opens the main Agent's chat, or an empty
// Conversation with it, while the Company has a model and nothing was written in it yet, the database makes Lead's
// message, in the Owner's language, the first of the Owner's Conversation with it: it says Lead manages the team and asks what the Company sells, to whom, and the goal now
// (open_first_conversation, once per Company). The Owner's answer is met with the first Agents to make, through the
// brief of its Run (lib/lead-offer.mjs). `service` is a service-role client, so nobody else can write Lead's words.

/** Lead's opening, in the Owner's language. @param {string} language @param {{owner:string,lead:string,company:string}} names */
const openingWords=(language,{owner,lead,company})=>i18n(language).t('leadOpening',owner,lead,company);

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
