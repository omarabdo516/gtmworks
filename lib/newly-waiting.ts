import { useEffect, useRef, useState } from 'react';

// The Cards that just started waiting on the reader, for the reference's nudge (design-reference: syncWaitMarks): the
// first read is the baseline, and a Card that waits after it is marked for 1200ms from its latest start. Kept by the
// board or the chat, not by the Card's element, which is drawn again in its new column.
export function useNewlyWaiting(ids:number[]):ReadonlySet<number> {
 const seen=useRef<Set<number>|null>(null);
 const [fresh,setFresh]=useState<ReadonlySet<number>>(()=>new Set());
 const timers=useRef(new Map<number,ReturnType<typeof setTimeout>>());
 const key=ids.join(',');
 useEffect(()=>{
  const now=new Set(key?key.split(',').map(Number):[]); const before=seen.current; seen.current=now;
  const added=before?[...now].filter(id=>!before.has(id)):[];
  if(!added.length) return;
  setFresh(current=>new Set([...current,...added]));
  for(const id of added) {
   clearTimeout(timers.current.get(id));
   timers.current.set(id,setTimeout(()=>{ timers.current.delete(id); setFresh(current=>new Set([...current].filter(other=>other!==id))); },1200));
  }
 },[key]);
 useEffect(()=>{ const pending=timers.current; return ()=>pending.forEach(clearTimeout); },[]);
 return fresh;
}
