import { useEffect, useSyncExternalStore } from 'react';

// The Runs open in the Conversation this person is reading, for the working motion on its Agent's tile (#184;
// design-reference: runningAgents, syncLive). A Run that ends leaves its Agent `done` for the reference's moment, then
// the entry goes. Leaving the Conversation forgets its Agent at once, so no check marks a Run nobody saw end.
type LiveRun='thinking'|'done';
const doneMs=1600;

const runs=new Map<string,LiveRun>();
const ends=new Map<string,number>();
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};};

function set(agent:string,run:LiveRun|undefined) {
 window.clearTimeout(ends.get(agent)); ends.delete(agent);
 if(run) runs.set(agent,run); else runs.delete(agent);
 if(run==='done') ends.set(agent,window.setTimeout(()=>set(agent,undefined),doneMs));
 listeners.forEach(listener=>listener());
}

function report(agent:string,open:boolean) {
 const was=runs.get(agent);
 if(open&&was!=='thinking') set(agent,'thinking');
 else if(!open&&was==='thinking') set(agent,'done');
}

export function useReportRun(agent:string|undefined,open:boolean) {
 useEffect(()=>{ if(agent) report(agent,open); },[agent,open]);
 useEffect(()=>()=>{ if(agent&&runs.has(agent)) set(agent,undefined); },[agent]);
}

export function useLiveRun(agent:string|undefined):LiveRun|undefined {
 return useSyncExternalStore(subscribe,()=>agent?runs.get(agent):undefined,()=>undefined);
}
