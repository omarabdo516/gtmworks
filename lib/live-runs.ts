import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import type { FaceState } from '@/components/face-life';

// What the chat a person has open knows of its Agents before any read of the server does (#700, spec #694): the Agent
// listens while the person types to it, thinks until its Run's first step, works after it, and is done for a moment
// when a Run the person watched ended well. Every face of that Agent on the page (the chat's head, the sidebar's tile,
// the reply being worked on) reads it here, beside the state the sidebar's poll keeps (app/sidebar-live), and shows the
// one `shownState` gives, so they agree at every moment. Leaving the chat forgets what it told, so nothing is done
// that nobody saw end.

// A Run the open chat watches: open before its first step, open after it, ended well, or ended any other way (failed,
// stopped, paused for a question). Only a Run seen open, then ended well, is done.
export type WatchedRun='thinking'|'working'|'well'|'ended';
type Phase='thinking'|'working'|'done';
const doneMs=1600;

const runs=new Map<string,Phase>();
const ends=new Map<string,number>();
const typing=new Map<string,Set<string>>();
const listeners=new Set<()=>void>();
const enders=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};};
const told=()=>listeners.forEach(listener=>listener());

function setPhase(agent:string,phase:Phase|undefined) {
 window.clearTimeout(ends.get(agent)); ends.delete(agent);
 if(phase) runs.set(agent,phase); else runs.delete(agent);
 if(phase==='done') ends.set(agent,window.setTimeout(()=>setPhase(agent,undefined),doneMs));
 told();
}

function report(agent:string,run:WatchedRun) {
 const was=runs.get(agent);
 if(run==='thinking'||run==='working') { if(was!==run) setPhase(agent,run); return; }
 if(was!=='thinking'&&was!=='working') return;
 setPhase(agent,run==='well'?'done':undefined);
 // However it ended, the server's state for it changed (idle, stuck, waiting): the sidebar asks again at once.
 enders.forEach(ender=>ender());
}

// The sidebar is told when a watched Run ends, so it reads every Agent's state again at once (app/sidebar-live).
export function onWatchedRunEnded(ender:()=>void) { enders.add(ender); return ()=>{ enders.delete(ender); }; }

// The open chat tells, for each Agent whose Run it watches, how that Run is now (`runs`, by Agent id).
export function useReportRuns(watched:Record<string,WatchedRun>) {
 const key=JSON.stringify(Object.entries(watched).sort());
 const watching=useRef<string[]>([]);
 useEffect(()=>{
  const now=JSON.parse(key) as [string,WatchedRun][];
  // An Agent the chat no longer watches (the place moved on to another) is forgotten, as on leaving.
  for(const agent of watching.current) if(!now.some(([one])=>one===agent)&&runs.has(agent)) setPhase(agent,undefined);
  for(const [agent,run] of now) report(agent,run);
  watching.current=now.map(([agent])=>agent);
 },[key]);
 useEffect(()=>()=>{ for(const agent of watching.current) if(runs.has(agent)) setPhase(agent,undefined); watching.current=[]; },[]);
}
export function useReportRun(agent:string|null|undefined,run:WatchedRun) {
 useReportRuns(agent?{[agent]:run}:{});
}

// A composer tells the Agents its person writes to now (none while the field is empty); sending empties the field.
export function useReportTyping(agents:string[]) {
 const source=useId(); const key=[...new Set(agents)].sort().join('\n');
 useEffect(()=>{
  if(!key) return;
  const to=key.split('\n');
  for(const agent of to) { const set=typing.get(agent)??new Set(); set.add(source); typing.set(agent,set); }
  told();
  return ()=>{ for(const agent of to) { const set=typing.get(agent); set?.delete(source); if(!set?.size) typing.delete(agent); } told(); };
 },[key,source]);
}

// What the open chat knows of one Agent now.
export type ChatKnows={run?:Phase,listening:boolean};
const nothing:ChatKnows={listening:false};
const known=new Map<string,ChatKnows>();
function knows(agent:string):ChatKnows {
 const run=runs.get(agent); const listening=!!typing.get(agent)?.size;
 if(!run&&!listening) return nothing;
 const was=known.get(agent);
 if(was&&was.run===run&&was.listening===listening) return was;
 const now={run,listening}; known.set(agent,now); return now;
}
export function useChatKnows(agent:string|null|undefined):ChatKnows {
 return useSyncExternalStore(subscribe,()=>agent?knows(agent):nothing,()=>nothing);
}

// The one state an Agent's face shows, from the state the server last told (`shared`) and what the open chat knows.
// Waiting on the person comes first; then the chat's own Run (thinking, working, done), which is newer than any read;
// listening shows only over idle and asleep, so typing to an Agent that works, waits or is stuck changes nothing.
export function shownState(shared:FaceState,chat:ChatKnows):FaceState {
 if(shared==='waiting') return shared;
 if(chat.run) return chat.run;
 if(chat.listening&&(shared==='idle'||shared==='asleep')) return 'listening';
 return shared;
}
