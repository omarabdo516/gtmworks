import { companyEngine } from './engine/handle.mjs';
import { signInProviders } from './engine/providers.mjs';
import { inOrder, providerOn, readProviderOrder } from './provider-order.mjs';
import { nameKey, placedName } from './provider-names.mjs';

// A request that runs out of one subscription account's quota goes on, on the next account of the same kind in the
// Owner's order (#621, spec #611; GLOSSARY: Provider). The Company's Engine does the moving itself (Hermes's credential
// pool, with scripts/engine-pool-order.sh), so no step the request already took is taken again and gtmworks runs no model
// loop. This module keeps the Engine in step with the Owner and reads back what it did:
//
// - the order: each provider's accounts, as the Settings list puts them (lib/provider-order.mjs inOrder), each with
//   whether the Owner switched it off, given to the root's pool at once when the Owner changes it, by the worker whenever
//   it differs from what the Engine last took, and again every few minutes so an Engine made again or restored follows
//   it too. A Company whose Owner never placed or switched a Provider keeps the Engine's own order;
// - the moves: each move the Engine recorded is copied once into the Company's log (record_provider_switches), as
//   gtmworks's own entry naming the two accounts as the Settings list names them then. A Conversation says nothing of it.
//
// Only entry ids, switches and the Owner's names pass through here: never a credential, a token preview or an Engine
// label (an email a token carries). A Company's Engine serves that Company only (ADR 0018), so its moves are its own.

const root='default';
const again=5*60*1000;

/** @typedef {{provider:string,account:string,exhausted?:boolean}} Account */
/** @typedef {{orders:Map<string,{sent:string,at:number}>,seen:Set<string>}} Memory */
/** @returns {Memory} */
const freshMemory=()=>({orders:new Map(),seen:new Set()});

// Each provider's accounts in the Owner's order, first to last, with their switches: the Engine's own list (its order
// for any the Owner did not place), as Settings draws it.
/** @param {Account[]} accounts @param {Record<string,import('./provider-order.mjs').Placed>} order */
export function accountOrders(accounts,order) {
 return Object.fromEntries(signInProviders.map(provider=>[provider,inOrder(accounts.filter(row=>row.provider===provider),order)
  .map(row=>({account:row.account,off:!providerOn(order,row)}))]).filter(([,entries])=>entries.length));
}

// The name an account reads under in Settings: the Owner's, or its kind's with its place in the Engine's list (ChatGPT,
// ChatGPT 2). An account the Engine no longer lists reads as its kind.
/** @param {Account[]} accounts @param {Record<string,string>} names @param {string} provider @param {string} account */
export function accountName(accounts,names,provider,account) {
 return placedName(names,provider,account,accounts.filter(row=>row.provider===provider).findIndex(row=>row.account===account)+1);
}


// Gives the Engine each provider's order when it differs from the last one it took, or it took it a while ago.
/** @param {any} providers the root profile's providers @param {Account[]} accounts @param {Record<string,import('./provider-order.mjs').Placed>} order @param {Memory} memory @param {number} now */
async function sendOrders(providers,accounts,order,memory,now) {
 for(const [provider,entries] of Object.entries(accountOrders(accounts,order))) {
  const sent=JSON.stringify(entries); const last=memory.orders.get(provider);
  if(last&&last.sent===sent&&now-last.at<again) continue;
  const written=await providers.writeAccountOrder(provider,entries);
  if(written.state==='written') memory.orders.set(provider,{sent,at:now});
  else if(written.state!=='unsupported') console.error('Provider order not given to the Engine',provider,written.state);
 }
}

// Copies each move the Engine recorded and this worker has not copied yet. A database that refused keeps them for the
// next pass; the database copies each move once whoever copies it (company_audit_switch).
/** @param {any} db @param {string} company @param {any} providers @param {Account[]} accounts @param {Record<string,string>} names @param {Memory} memory */
async function copySwitches(db,company,providers,accounts,names,memory) {
 const read=await providers.switches();
 if(read.state!=='found') return 0;
 const fresh=read.switches.filter(row=>!memory.seen.has(row.id));
 if(!fresh.length) return 0;
 const switches=fresh.map(row=>({id:row.id,provider:row.provider,from:row.from,to:row.to,at:row.at,
  from_name:accountName(accounts,names,row.provider,row.from),to_name:accountName(accounts,names,row.provider,row.to)}));
 const {data,error}=await db.rpc('record_provider_switches',{c:company,switches});
 if(error) { console.error('Provider switches not logged',error.code||''); return 0; }
 for(const row of fresh) memory.seen.add(row.id);
 // The Engine lists its last 100 moves: an id older than that is never read again.
 for(const id of [...memory.seen].slice(0,Math.max(0,memory.seen.size-200))) memory.seen.delete(id);
 return typeof data==='number'?data:0;
}

// The worker's pass over every Company with an Engine. `db` is the worker's service-role client; `memory` lives as long
// as the worker. Answers how many moves were new in the log.
/** @param {any} db @param {{memory?:Map<string,Memory>,now?:()=>number}} [options] */
export async function keepProviderAccounts(db,{memory=new Map(),now=Date.now}={}) {
 const {data,error}=await db.rpc('provider_accounts_work');
 if(error) throw error;
 let logged=0;
 for(const row of data||[]) {
  try {
   const at=await companyEngine(row.company_id);
   if(!at) continue;
   const connection=at.on(root)?.providers;
   if(!connection) continue;
   const listed=await connection.accounts();
   if(listed.state!=='found'||!listed.accounts) continue;
   const kept=Array.isArray(row.accounts)?row.accounts:[];
   const order=Object.fromEntries(kept.map(one=>[nameKey(one.provider,one.account),{place:Number.isSafeInteger(one.place)?one.place:null,enabled:one.enabled!==false}]));
   const names=Object.fromEntries(kept.filter(one=>typeof one.name==='string'&&one.name).map(one=>[nameKey(one.provider,one.account),one.name]));
   if(!memory.has(row.company_id)) memory.set(row.company_id,freshMemory());
   const mine=/** @type {Memory} */(memory.get(row.company_id));
   // A Company whose Owner never placed or switched a Provider leaves the Engine's own order as it is. One that did is
   // given it, also once every Provider is on again with no place, so a switch turned on reaches an Engine that missed it.
   if(kept.some(one=>one.ordered===true)) await sendOrders(connection,listed.accounts,order,mine,now());
   logged+=await copySwitches(db,row.company_id,connection,listed.accounts,names,mine);
  } catch(failure) { console.error('Provider accounts not kept:',row.company_id,failure?.message||'unknown error'); }
 }
 return logged;
}

// The Owner just changed the order or a switch (app/api/provider-order): the Engine takes it at once rather than at the
// worker's next pass. `db` is the Owner's own session, which reads the order under row-level security. A failure here is
// not the change's: the database kept it, and the worker gives it to the Engine.
/** @param {any} db @param {{company:string}} change */
export async function applyAccountOrder(db,{company}) {
 try {
  const connection=(await companyEngine(company))?.on(root)?.providers;
  if(!connection) return;
  const [order,listed]=await Promise.all([readProviderOrder(db,company),connection.accounts()]);
  if(!order||listed.state!=='found'||!listed.accounts) return;
  await sendOrders(connection,listed.accounts,order,freshMemory(),0);
 } catch { console.error('Provider order not given to the Engine yet'); }
}
