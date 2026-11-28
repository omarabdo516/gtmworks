
// Which accounts ran out on a Conversation's Run (#731). The pinned Engine's failed Run names no account: the first one
// names only its provider's kind, every later one nothing at all. Its credential pool does: GET /api/credentials/pool
// marks each account it found out of usage `last_status: exhausted` (lib/engine/providers.mjs readSubscriptionAccounts). So when a
// Run ends no_access, the Conversation's live read (app/api/conversation-live) reads every exhausted subscription account
// of the Company's root pool, each with its place among its provider's accounts as the Engine lists them (the place an
// unnamed one reads by: ChatGPT 2, as Settings names it), and the provider of the Agent's own model (GET /api/profiles),
// and names those of the Agent's own provider; nothing of it is kept (#883).
// Only provider ids, entry ids and places leave here: never a label, a token preview or a count. Nothing read is an
// error: a pool or profile that cannot be read names no account, and the Run's end is told as before.

/** @typedef {{provider:string,account:string,place:number}} RanOut */
/** @param {import('./engine/handle.mjs').CompanyEngine} engine the Run's Company's @param {string|null|undefined} profile the Run's own
 * @returns {Promise<{ownProvider:string|null,accounts:RanOut[]}>} */
export async function ranOutAccounts(engine,profile) {
 // The pool and every profile's model are read on the Engine's root profile.
 const root=/** @type {NonNullable<ReturnType<typeof engine.on>>} */(engine.on('default'));
 const [listed,models]=await Promise.all([root.providers.accounts().catch(()=>null),profile?root.models.ofProfiles([profile]).catch(()=>null):null]);
 const own=models?.state==='found'?models.models?.[/** @type {string} */(profile)]?.provider:null;
 const accounts=listed?.state==='found'&&Array.isArray(listed.accounts)?listed.accounts:[];
 return {ownProvider:typeof own==='string'&&own?own:null,
  accounts:accounts.flatMap((row,at)=>row.exhausted?[{provider:row.provider,account:row.account,
   place:accounts.slice(0,at).filter(before=>before.provider===row.provider).length+1}]:[])};
}
