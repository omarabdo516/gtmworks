import { readProfileModels, readSubscriptionAccounts } from './hermes.mjs';

// Which accounts ran out on a Conversation's Run (#731). The pinned Engine's failed Run names no account: the first one
// names only its provider's kind, every later one nothing at all. Its credential pool does: GET /api/credentials/pool
// marks each account it found out of usage `last_status: exhausted` (lib/hermes.mjs readSubscriptionAccounts). So when a
// Run ends no_access, the closer reads every exhausted subscription account of the Company's root pool, each with its
// place among its provider's accounts as the Engine lists them (the place an unnamed one reads by: ChatGPT 2, as
// Settings names it), and the provider of the Agent's own model (GET /api/profiles). The database keeps those of the
// Run's provider (close_conversation_run_ran_out), which is the Agent's own unless the Run named another (#158).
// Only provider ids, entry ids and places leave here: never a label, a token preview or a count. Nothing read is an
// error: a pool or profile that cannot be read names no account, and the Run closes as before.

const root='default';
const drivers={accounts:readSubscriptionAccounts,profileModels:readProfileModels};

/** @typedef {{provider:string,account:string,place:number}} RanOut */
/** @param {{address:string,key:string,profile?:string}} connection the Run's own @param {Partial<typeof drivers>} [driver]
 * @returns {Promise<{ownProvider:string|null,accounts:RanOut[]}>} */
export async function ranOutAccounts(connection,driver={}) {
 const use={...drivers,...driver};
 const at={...connection,profile:root};
 const profile=connection.profile;
 const [listed,models]=await Promise.all([use.accounts(at).catch(()=>null),profile?use.profileModels(at,[profile]).catch(()=>null):null]);
 const own=models?.state==='found'?models.models?.[/** @type {string} */(profile)]?.provider:null;
 const accounts=listed?.state==='found'&&Array.isArray(listed.accounts)?listed.accounts:[];
 return {ownProvider:typeof own==='string'&&own?own:null,
  accounts:accounts.flatMap((row,at)=>row.exhausted?[{provider:row.provider,account:row.account,
   place:accounts.slice(0,at).filter(before=>before.provider===row.provider).length+1}]:[])};
}
