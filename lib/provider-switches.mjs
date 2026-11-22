import { subscriptionNames as brand } from './activity-log.mjs';
import { engineOf } from './company-engine.mjs';
import { readAccountSwitches, readSubscriptionAccounts, signInProviders, writeAccountOrder } from './hermes.mjs';
import { inOrder, providerOn, readProviderOrder } from './provider-order.mjs';
import { nameKey } from './provider-names.mjs';

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
const drivers={accounts:readSubscriptionAccounts,order:writeAccountOrder,switches:readAccountSwitches};

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
 const own=names[nameKey(provider,account)];
 if(own) return own;
 const at=accounts.filter(row=>row.provider===provider).findIndex(row=>row.account===account);
 return at>0?`${brand[/** @type {keyof typeof brand} */(provider)]} ${at+1}`:brand[/** @type {keyof typeof brand} */(provider)];
}

// Gives the Engine each provider's order when it differs from the last one it took, or it took it a while ago.
/** @param {any} connection @param {Account[]} accounts @param {Record<string,import('./provider-order.mjs').Placed>} order @param {Memory} memory @param {typeof drivers} use @param {number} now */
async function sendOrders(connection,accounts,order,memory,use,now) {
 for(const [provider,entries] of Object.entries(accountOrders(accounts,order))) {
  const sent=JSON.stringify(entries); const last=memory.orders.get(provider);
  if(last&&last.sent===sent&&now-last.at<again) continue;
  const written=await use.order(connection,provider,entries);
  if(written.state==='written') memory.orders.set(provider,{sent,at:now});
  else if(written.state!=='unsupported') console.error('Provider order not given to the Engine',provider,written.state);
 }
}

// Copies each move the Engine recorded and this worker has not copied yet. A database that refused keeps them for the
// next pass; the database copies each move once whoever copies it (company_audit_switch).
/** @param {any} db @param {string} company @param {any} connection @param {Account[]} accounts @param {Record<string,string>} names @param {Memory} memory @param {typeof drivers} use */
async function copySwitches(db,company,connection,accounts,names,memory,use) {
 const read=await use.switches(connection);
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
/** @param {any} db @param {{memory?:Map<string,Memory>,driver?:Partial<typeof drivers>,engineFor?:(company:string)=>Promise<any>,now?:()=>number}} [options] */
export async function keepProviderAccounts(db,{memory=new Map(),driver={},engineFor=engineOf,now=Date.now}={}) {
 const use={...drivers,...driver};
 const {data,error}=await db.rpc('provider_accounts_work');
 if(error) throw error;
 let logged=0;
 for(const row of data||[]) {
  try {
   const at=await engineFor(row.company_id);
   if(!at) continue;
   const connection={...at,profile:root};
   const listed=await use.accounts(connection);
   if(listed.state!=='found'||!listed.accounts) continue;
   const kept=Array.isArray(row.accounts)?row.accounts:[];
   const order=Object.fromEntries(kept.map(one=>[nameKey(one.provider,one.account),{place:Number.isSafeInteger(one.place)?one.place:null,enabled:one.enabled!==false}]));
   const names=Object.fromEntries(kept.filter(one=>typeof one.name==='string'&&one.name).map(one=>[nameKey(one.provider,one.account),one.name]));
   if(!memory.has(row.company_id)) memory.set(row.company_id,freshMemory());
   const mine=/** @type {Memory} */(memory.get(row.company_id));
   // A Company whose Owner never placed or switched a Provider leaves the Engine's own order as it is. One that did is
   // given it, also once every Provider is on again with no place, so a switch turned on reaches an Engine that missed it.
   if(kept.some(one=>one.ordered===true)) await sendOrders(connection,listed.accounts,order,mine,use,now());
   logged+=await copySwitches(db,row.company_id,connection,listed.accounts,names,mine,use);
  } catch(failure) { console.error('Provider accounts not kept:',row.company_id,failure?.message||'unknown error'); }
 }
 return logged;
}

// The Owner just changed the order or a switch (app/api/provider-order): the Engine takes it at once rather than at the
// worker's next pass. `db` is the Owner's own session, which reads the order under row-level security. A failure here is
// not the change's: the database kept it, and the worker gives it to the Engine.
/** @param {any} db @param {{company:string,hermes?:Promise<any>|any,driver?:Partial<typeof drivers>}} change */
export async function applyAccountOrder(db,{company,hermes=engineOf(company),driver={}}) {
 const use={...drivers,...driver};
 try {
  const at=await hermes;
  if(!at) return;
  const connection={...at,profile:root};
  const [order,listed]=await Promise.all([readProviderOrder(db,company),use.accounts(connection)]);
  if(!order||listed.state!=='found'||!listed.accounts) return;
  await sendOrders(connection,listed.accounts,order,freshMemory(),use,0);
 } catch { console.error('Provider order not given to the Engine yet'); }
}
