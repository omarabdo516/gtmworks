import { companyEngine } from './engine/handle.mjs';
import { workerUpkeep } from './upkeep-schedule.mjs';

// The rows gtmworks keeps for Conversations (#881, spec #864: whose it is, with which Agent, the Engine's session id).
// A Conversation is its Engine session, so a row whose session the Engine no longer holds, as when its Agent was
// deleted there, is forgotten by this slow check for drift (ADR 0031 item 4): one pass every five minutes, never on a
// page read. A session an hour old or less is never asked about (conversation_drift), so a session chosen before its
// first Run is never taken for gone. A row whose Agent is gone from gtmworks is forgotten without asking (decision
// 0074: deleting an Agent deletes its Conversations). A profile the Engine answers with something other than its list
// forgets nothing, and an Engine that does not answer is left alone a while (lib/upkeep-schedule.mjs). Kept in the
// worker's memory only; a restart checks at once.
// shortcut: a profile is read 100 sessions a page, 50 pages at most; a profile with more sessions forgets nothing.
const driftMemory={drift:0};
const driftEvery=300000;
const page=100, pages=50;

/** Every session id a profile holds, archived ones too, or null when the list could not be read to its end.
 * @param {any} on @returns {Promise<Set<string>|null>} */
async function heldSessions(on) {
 const held=new Set();
 for(let at=0;at<pages;at++) {
  const read=await on.sessions.list({offset:at*page,limit:page});
  if(read.state==='missing') return held;
  if(read.state!=='found') return null;
  for(const session of read.sessions) held.add(session.id);
  if(read.sessions.length<page||(at+1)*page>=read.total) return held;
 }
 return null;
}

/** @param {any} db the worker's database @param {{memory?:{drift:number},health?:ReturnType<typeof import('./upkeep-schedule.mjs').upkeepSchedule>,now?:()=>number}} [options] */
export async function keepConversationRows(db,{memory=driftMemory,health=workerUpkeep,now=Date.now}={}) {
 const done={forgotten:0};
 if(memory.drift&&now()-memory.drift<driftEvery) return done;
 memory.drift=now();
 const {data:rows,error}=await db.rpc('conversation_drift');
 if(error) throw new Error(error.message);
 /** @type {Map<string,any>} */ const engines=new Map();
 for(const {company_id:company,profile,sessions} of rows||[]) {
  let gone=/** @type {string[]} */(sessions||[]);
  if(profile) {
   if(!engines.has(company)) engines.set(company,await companyEngine(company));
   const engine=engines.get(company);
   if(!engine||!health.ready(engine.address)) continue;
   const on=engine.on(profile); if(!on) continue;
   let held;
   try { held=await heldSessions(on); } catch { held=null; }
   if(!held) { health.failed(engine.address); continue; }
   health.answered(engine.address);
   gone=gone.filter(session=>!held.has(session));
  }
  if(!gone.length) continue;
  const {data:forgotten,error:failed}=await db.rpc('forget_conversations',{c:company,sessions:gone});
  if(failed) { console.error('Conversation rows not forgotten:',company,failed.message); continue; }
  done.forgotten+=Number(forgotten)||0;
 }
 return done;
}
