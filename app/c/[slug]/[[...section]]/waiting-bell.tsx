'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import Link from '@/lib/link';
import { ShellIcon } from '@/components/shell-icon';

type BellRow={key:string,href:string,title:string,sub?:string};
export type BellGroup={key:string,label:string,rows:BellRow[]};

const moves:Record<string,(index:number,count:number)=>number>={ArrowDown:(i,n)=>(i+1)%n,ArrowUp:(i,n)=>(i-1+n)%n,Home:()=>0,End:(_,n)=>n-1};

// The reader's own "Waiting on you" under the board's bell (#677; design-reference-card: #bt-wait, popHTML 'wl'): the
// Cards they can act on, the Cards assigned to them, the requests waiting for their answer and their mentions, in groups;
// the number on the bell is its rows. The button opens the menu with the keyboard on the first row; Arrow Down and Up move
// and wrap, Home and End go to the ends, Escape closes it back to the button, Tab closes it and moves on, a press outside
// closes it, and a row opens what it names.
export function WaitingBell({label,count,groups,empty}:{label:string,count:number,groups:BellGroup[],empty:string}) {
 const [open,setOpen]=useState(false); const id=useId();
 const box=useRef<HTMLDivElement>(null); const button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!open) return;
  box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  const outside=(event:PointerEvent)=>{ if(!box.current?.contains(event.target as Node)) setOpen(false); };
  document.addEventListener('pointerdown',outside);
  return ()=>document.removeEventListener('pointerdown',outside);
 },[open]);
 const keys=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); return; }
  if(event.key==='Tab') { setOpen(false); return; }
  const move=moves[event.key]; if(!move) return;
  event.preventDefault();
  const list=[...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  if(list.length) list[move(list.indexOf(event.target as HTMLElement),list.length)]?.focus();
 };
 const shown=groups.filter(group=>group.rows.length);
 return <div ref={box} className="waiting-bell">
  <button ref={button} type="button" className={`ib ib--bell${count?' has-n':''}`} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(!open)}><ShellIcon name="bell"/>{count>0&&<span className="num">{count}</span>}</button>
  {open&&<div className="menu waiting-bell__pop" id={id} role="menu" aria-label={label} onKeyDown={keys}>
   {shown.length?shown.map(group=><div key={group.key} role="group" aria-label={group.label}>
    <div className="menu__label" aria-hidden="true">{group.label}</div>
    {group.rows.map(row=><Link key={row.key} className="menu__item" role="menuitem" href={row.href} onClick={()=>setOpen(false)}><span className="menu__t"><bdi dir="auto">{row.title}</bdi>{row.sub&&<span className="menu__d">{row.sub}</span>}</span></Link>)}
   </div>):<p className="menu__label">{empty}</p>}
  </div>}
 </div>;
}
