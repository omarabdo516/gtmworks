// The names the Owner gives the Company's Providers (#618; GLOSSARY: Provider). A subscription is named by the Engine's
// id for its account (lib/hermes.mjs readSubscriptionAccounts) and a key by `key` beside its provider, so two of one
// kind read apart. The database keeps only the name (provider_names); every Member reads it under row-level security,
// and rename_provider checks the Owner itself, so a Manager, any other Member or another Company's person changes
// nothing, whatever reaches the route. No credential passes through here.

const provider=/^[a-z0-9][a-z0-9._-]{0,63}$/;
const account=/^[A-Za-z0-9_-]{1,64}$/;
// The account a key is named by: a Company holds one key per provider.
export const keyAccount='key';
export const nameLimit=60;
/** @param {string} provider @param {string} account */
export const nameKey=(provider,account)=>`${provider}:${account}`;

// Every Provider's name of the Company, by nameKey; an empty object when none is set or the read failed, so each reads
// under its kind's own name.
/** @param {any} db @param {string} company @returns {Promise<Record<string,string>>} */
export async function readProviderNames(db,company) {
 try {
  const {data,error}=await db.from('provider_names').select('provider,account,name').eq('company_id',company);
  if(error||!Array.isArray(data)) return {};
  return Object.fromEntries(data.filter(row=>typeof row?.name==='string').map(row=>[nameKey(row.provider,row.account),row.name]));
 } catch { return {}; }
}

const refusals={'42501':[403,'providerNotAllowed'],'22023':[400,'providerNameInvalid']};
// The Owner names a Provider, or gives back its kind's name with an empty one.
/** @param {any} db @param {{company:string,provider:unknown,account:unknown,name:unknown}} change */
export async function renameProvider(db,{company,provider:slug,account:id,name}) {
 if(typeof slug!=='string'||!provider.test(slug)||typeof id!=='string'||!account.test(id)||typeof name!=='string') return {status:400,body:{error:'providerNameInvalid'}};
 const given=name.trim();
 if(given.length>nameLimit||/[\u0000-\u001f\u007f]/.test(given)) return {status:400,body:{error:'providerNameInvalid'}};
 const {error}=await db.rpc('rename_provider',{c:company,provider:slug,account:id,name:given});
 if(!error) return {status:200,body:{name:given||null}};
 const [status,code]=refusals[/** @type {keyof typeof refusals} */(error.code)]||[502,'providerNameFailed'];
 return {status,body:{error:code}};
}

// A removed account's name goes with it. The Engine already removed the account, so a failed write is not the step's
// failure: the name then waits, unread, under an id the Engine no longer lists.
/** @param {any} db @param {{company:string,provider:string,account:string}} gone */
export async function forgetProviderName(db,{company,provider:slug,account:id}) {
 try {
  const {error}=await db.rpc('rename_provider',{c:company,provider:slug,account:id,name:''});
  if(error) console.error('Provider name not removed',error.code||'');
 } catch { console.error('Provider name not removed'); }
}
