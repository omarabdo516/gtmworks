'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon, type ShellIconName } from '@/components/shell-icon';

export type CardMenuItem={key:string,icon:ShellIconName,label:string,run:()=>void};

// Where each arrow key, Home and End move the focus, from item `index` of `count` (as the account menu's do).
const moves:Record<string,(index:number,count:number)=>number>={ArrowDown:(i,n)=>(i+1)%n,ArrowUp:(i,n)=>(i-1+n)%n,Home:()=>0,End:(_,n)=>n-1};

// The Card's "More" menu (#670; design-reference-card: #cw-more, popHTML 'more'): a round button in the Card's head that
// opens its menu with the keyboard on the first item. Arrow Down and Up move through the items and wrap, Home and End go
// to the ends, Escape closes it back to the button without closing the Card, Tab closes it and moves on, and a press
// outside closes it. Choosing an item closes it, gives the button the keyboard back, then runs the item.
export function CardMenu({items}:{items:CardMenuItem[]}) {
 const {t}=useI18n(); const [open,setOpen]=useState(false); const id=useId();
 const box=useRef<HTMLDivElement>(null); const button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!open) return;
  box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  const outside=(event:PointerEvent)=>{ if(!box.current?.contains(event.target as Node)) setOpen(false); };
  document.addEventListener('pointerdown',outside);
  return ()=>document.removeEventListener('pointerdown',outside);
 },[open]);
 const close=()=>{ setOpen(false); button.current?.focus(); };
 const keys=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
  if(event.key==='Tab') { setOpen(false); return; }
  const move=moves[event.key]; if(!move) return;
  event.preventDefault();
  const list=[...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  list[move(list.indexOf(event.target as HTMLElement),list.length)]?.focus();
 };
 return <div ref={box} className="card-menu">
  <button ref={button} type="button" className="circle-btn" aria-label={t('cardMore')} title={t('cardMore')} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(!open)}><ShellIcon name="dots"/></button>
  {open&&<div className="menu card-menu__pop" id={id} role="menu" aria-label={t('cardMore')} onKeyDown={keys}>
   {items.map(item=><button key={item.key} type="button" className="menu__item" role="menuitem" onClick={()=>{ close(); item.run(); }}><ShellIcon name={item.icon}/><span className="menu__t">{item.label}</span></button>)}
  </div>}
 </div>;
}
