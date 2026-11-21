import { randomUUID } from 'node:crypto';
// #370: the database's held changes as the signed-in person reaches them (hold_agent_change, finish_agent_change,
// drop_agent_change) and the worker's pass (finish_held_agent_changes), for node tests that stand in for the database.
// `refuse` answers the refusal a hold gets, or null; `failLogs` and `failDrops` are how many log and drop calls the
// database fails first. Every
// call is kept, so a test can see that no note's text ever reached the database's log.
/** @param {{refuse?:(args:any)=>string|null,failLogs?:number,failDrops?:number}} [options] */
export function heldChanges({refuse=()=>null,failLogs=0,failDrops=0}={}) {
 const held=new Map(); const logged=[]; const dropped=[]; const calls=[]; let failing=failLogs; let failingDrops=failDrops;
 const log=change=>logged.push({c:change.c,agent:change.agent,act:change.act,skill:change.skill});
 /** @param {string} name @param {any} args */
 const rpc=(name,args)=>{
  if(name==='hold_agent_change') {
   const refusal=refuse(args); if(refusal) return {data:null,error:{message:refusal}};
   const id=randomUUID(); held.set(id,args); return {data:id,error:null};
  }
  if(name==='finish_agent_change') {
   calls.push({name,args});
   if(failing>0) { failing--; return {data:null,error:{message:'the database did not answer'}}; }
   const change=held.get(args.change); held.delete(args.change); if(change) log(change);
   return {data:Boolean(change),error:null};
  }
  if(name==='drop_agent_change') { calls.push({name,args}); if(failingDrops>0) { failingDrops--; return {data:null,error:{message:'the database did not answer'}}; } if(held.delete(args.change)) dropped.push(args.change); return {data:null,error:null}; }
  if(name==='finish_held_agent_changes') { const count=held.size; for(const change of held.values()) log(change); held.clear(); return {data:count,error:null}; }
  return null;
 };
 return {rpc,held,logged,dropped,calls,fail:count=>{ failing=count; }};
}
