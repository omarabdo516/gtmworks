import { accountId, nameKey } from './provider-names.mjs';

// The Owner's order of the Company's Providers, and which are switched off (#619, spec #611; GLOSSARY: Provider). A
// Provider is named as its name is (lib/provider-names.mjs): its provider and the Engine's id for its subscription
// account, or `key`. The pinned Engine has no state for a credential held but not used and reorders its pool from its
// command line only, so the database keeps both (provider_order); every Member reads them under row-level security, and
// order_providers, switch_provider and forget_provider check the Owner themselves. A switched-off Provider keeps its
// sign-in or key in the Engine, so switching it on again needs no new sign-in. No credential passes through here.

const provider=/^[a-z0-9][a-z0-9._-]{0,63}$/;
const orderLimit=64;
/** @typedef {{place:number|null,enabled:boolean}} Placed */

// Every Provider's place and switch, by nameKey; an empty object when none is kept or the read failed, so the list keeps
// the Engine's own order with every Provider on.
/** @param {any} db @param {string} company @returns {Promise<Record<string,Placed>>} */
export async function readProviderOrder(db,company) {
 try {
  const {data,error}=await db.from('provider_order').select('provider,account,place,enabled').eq('company_id',company);
  if(error||!Array.isArray(data)) return {};
  return Object.fromEntries(data.filter(row=>typeof row?.enabled==='boolean').map(row=>[nameKey(row.provider,row.account),
   {place:Number.isSafeInteger(row.place)?row.place:null,enabled:row.enabled}]));
 } catch { return {}; }
}

// The list in the Owner's order: each placed Provider in its place, then every other one in the order it came (the
// Engine's), so a Provider connected after the last ordering goes last. An entry with no account (an older sign-in the
// Engine lists no account for) has no place of its own.
/** @template {{provider:string,account:string|null}} T @param {T[]} entries @param {Record<string,Placed>} order @returns {T[]} */
export function inOrder(entries,order) {
 const placeOf=entry=>entry.account?order[nameKey(entry.provider,entry.account)]?.place??null:null;
 const placed=entries.filter(entry=>placeOf(entry)!==null).sort((a,b)=>/** @type {number} */(placeOf(a))-/** @type {number} */(placeOf(b)));
 return [...placed,...entries.filter(entry=>placeOf(entry)===null)];
}
/** Whether the Owner left this Provider switched on. @param {Record<string,Placed>} order @param {{provider:string,account:string|null}} entry */
export const providerOn=(order,entry)=>!entry.account||order[nameKey(entry.provider,entry.account)]?.enabled!==false;

const named=entry=>entry&&typeof entry==='object'&&typeof entry.provider==='string'&&provider.test(entry.provider)&&typeof entry.account==='string'&&accountId.test(entry.account);
const refusals={'42501':[403,'providerNotAllowed'],'22023':[400,'providerOrderInvalid']};
const refused=error=>{ const [status,code]=refusals[/** @type {keyof typeof refusals} */(error.code)]||[502,'providerOrderFailed']; return {status,body:{error:code}}; };

// The Owner puts the Providers in order: the whole list, first to last, each once.
/** @param {any} db @param {{company:string,entries:unknown}} change */
export async function orderProviders(db,{company,entries}) {
 if(!Array.isArray(entries)||!entries.length||entries.length>orderLimit||!entries.every(named)) return {status:400,body:{error:'providerOrderInvalid'}};
 const list=entries.map(entry=>({provider:entry.provider,account:entry.account}));
 if(new Set(list.map(entry=>nameKey(entry.provider,entry.account))).size!==list.length) return {status:400,body:{error:'providerOrderInvalid'}};
 const {error}=await db.rpc('order_providers',{c:company,entries:list});
 return error?refused(error):{status:200,body:{ordered:list.length}};
}

// The Owner switches one Provider off, or on again; its place stays.
/** @param {any} db @param {{company:string,provider:unknown,account:unknown,enabled:unknown}} change */
export async function switchProvider(db,{company,provider:slug,account,enabled}) {
 if(!named({provider:slug,account})||typeof enabled!=='boolean') return {status:400,body:{error:'providerOrderInvalid'}};
 const {data,error}=await db.rpc('switch_provider',{c:company,provider:slug,account,turned_on:enabled});
 return error?refused(error):{status:200,body:{enabled:data===true}};
}

// A removed Provider's place and switch go with it, as its name does. The Engine already removed it, so a failed write
// is not the step's failure: the row then waits, unread, unless a key of that provider is given again, which then starts
// where the removed one was. Answers whether it is gone.
/** @param {any} db @param {{company:string,provider:string,account:string}} gone @returns {Promise<boolean>} */
export async function forgetProviderOrder(db,{company,provider:slug,account}) {
 try {
  const {error}=await db.rpc('forget_provider',{c:company,provider:slug,account});
  if(!error) return true;
  console.error('Provider order not removed',error.code||'');
 } catch { console.error('Provider order not removed'); }
 return false;
}
