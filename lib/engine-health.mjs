import { engineStateLine } from './diagnostics.mjs';

// Each Engine's health as the worker's upkeep sees it (#772, ADR 0031 point 4). A failed call keeps its cause (timed
// out, refused, name not found, no network, error answer); after one, the Engine is left alone a while before the next
// call, longer after each failure in a row (2 s, 4 s, … up to five minutes), so a slow or stopped Engine is not asked
// every pass. A change of state is logged once, with its cause, and once more when the Engine answers again
// (docs/production-logs.md: engine_state). Kept in the worker's memory only; a restart starts every Engine as answering.
const firstWait=2000; const longestWait=300000;
/** @param {{now?:()=>number,write?:(line:string)=>void}} [options] */
export function engineHealth({now=Date.now,write=console.log}={}) {
 /** @type {Map<string,{failures:number,cause:string,next:number}>} */
 const down=new Map();
 const nameOf=address=>{ try { return new URL(address).host; } catch { return 'unknown'; } };
 return {
  /** Whether the Engine at this address may be asked now. @param {string} address */
  ready(address) { const known=down.get(address); return !known||now()>=known.next; },
  /** A call to the Engine failed, for this cause. @param {string} address @param {string} cause */
  failed(address,cause) {
   const known=down.get(address); const failures=(known?.failures??0)+1;
   if(!known||known.cause!==cause) write(engineStateLine({engine:nameOf(address),state:'down',cause}));
   down.set(address,{failures,cause,next:now()+Math.min(firstWait*2**(failures-1),longestWait)});
  },
  /** A call to the Engine was answered. @param {string} address */
  answered(address) {
   if(!down.has(address)) return;
   down.delete(address);
   write(engineStateLine({engine:nameOf(address),state:'up',cause:null}));
  },
 };
}
// The worker's one record, shared by its passes.
export const workerHealth=engineHealth();

// Each item of a pass, at most `limit` at a time, so one slow item never holds the others back.
/** @template T @param {T[]} items @param {number} limit @param {(item:T)=>Promise<void>} each */
export async function inLanes(items,limit,each) {
 let next=0;
 const lane=async()=>{ while(next<items.length) await each(items[next++]); };
 await Promise.all(Array.from({length:Math.min(limit,items.length)},lane));
}
