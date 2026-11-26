// When the worker's upkeep asks each Engine again (#772, ADR 0031 point 4). After a failed write (no answer, or an error
// answer), the Engine is left out of the upkeep a while, longer after each failure in a row (2 s, 4 s, … up to five
// minutes), so a slow or stopped Engine is not asked every pass; an answer puts it back. This is the upkeep's own
// schedule, not the Engine's health: that is the transport's (lib/engine/transport.mjs), which also writes the one log
// line for each change of it, so nothing here logs. Kept in the worker's memory only; a restart asks every Engine.
const firstWait=2000; const longestWait=300000;
/** @param {{now?:()=>number}} [options] */
export function upkeepSchedule({now=Date.now}={}) {
 /** @type {Map<string,{failures:number,next:number}>} */
 const down=new Map();
 return {
  /** Whether the upkeep may ask the Engine at this address now. @param {string} address */
  ready(address) { const known=down.get(address); return !known||now()>=known.next; },
  /** A write to the Engine failed. @param {string} address */
  failed(address) {
   const failures=(down.get(address)?.failures??0)+1;
   down.set(address,{failures,next:now()+Math.min(firstWait*2**(failures-1),longestWait)});
  },
  /** A write to the Engine was answered. @param {string} address */
  answered(address) { down.delete(address); },
 };
}
// The worker's one record, shared by its passes.
export const workerUpkeep=upkeepSchedule();

// Each item of a pass, at most `limit` at a time, so one slow item never holds the others back.
/** @template T @param {T[]} items @param {number} limit @param {(item:T)=>Promise<void>} each */
export async function inLanes(items,limit,each) {
 let next=0;
 const lane=async()=>{ while(next<items.length) await each(items[next++]); };
 await Promise.all(Array.from({length:Math.min(limit,items.length)},lane));
}
