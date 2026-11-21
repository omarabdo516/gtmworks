'use client';
import { useEffect, useRef, useState } from 'react';
import Link from '@/lib/link';

// The sidebar's count of what waits on the reader (app/approvals-count.tsx). When it is drawn again during a visit with a
// higher count than before, it pops once (#131; design-reference: syncWaitMarks, .sb-count.is-pop); a page load, a count
// that falls or stays, and a count still on its way do not. Each rise draws the pill anew, so the pop plays again.
export function CountPill({href,current,label,count}:{href:string,current:boolean,label:string,count?:number}) {
 const seen=useRef<number|undefined>(undefined);
 const [pop,setPop]=useState({on:false,n:0});
 useEffect(()=>{
  if(count===undefined) return;
  const before=seen.current; seen.current=count;
  if(before===undefined) return;
  if(count>before) setPop(last=>({on:true,n:last.n+1}));
  else setPop(last=>last.on?{on:false,n:last.n}:last);
 },[count]);
 return <Link key={pop.n} className={`sb-count${count?'':' sb-count--none'}${pop.on?' is-pop':''}`} href={href} aria-current={current?'page':undefined} aria-label={label}><span className="sb-count__n">{count}</span></Link>;
}
