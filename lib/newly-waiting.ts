import { useEffect, useRef, useState } from 'react';

// The Cards that just started waiting on the reader, for the reference's nudge (design-reference: syncWaitMarks): the
// first read is the baseline, and a Card that waits after it is marked for 1200ms. Kept by the board or the chat, not
// by the Card's element, which is drawn again in its new column.
export function useNewlyWaiting(ids:number[]):ReadonlySet<number> {
 const seen=useRef<Set<number>|null>(null);
 const [fresh,setFresh]=useState<ReadonlySet<number>>(()=>new Set());
 const timers=useRef(new Set<ReturnType<typeof setTimeout>>());
 const key=ids.join(',');
 useEffect(()=>{
  const now=new Set(key?key.split(',').map(Number):[]); const before=seen.current; seen.current=now;
  const added=before?[...now].filter(id=>!before.has(id)):[];
  if(!added.length) return;
  setFresh(current=>new Set([...current,...added]));
  const timer=setTimeout(()=>{ timers.current.delete(timer); setFresh(current=>new Set([...current].filter(id=>!added.includes(id)))); },1200);
  timers.current.add(timer);
 },[key]);
 useEffect(()=>{ const pending=timers.current; return ()=>pending.forEach(clearTimeout); },[]);
 return fresh;
}
