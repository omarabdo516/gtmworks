'use client';
import { useEffect, useRef, type RefObject } from 'react';

// One tooltip for every symbol and icon-only control inside a box (design-reference-card: GTIP, tipShow, tipHide): it
// names what [data-tip] holds. A mouse or a pen resting on it shows it after 420 ms (at once while one shows), keyboard
// focus reached by the keyboard shows it, and on a phone a long press of 480 ms shows it and the tap that follows does nothing; Escape, a scroll,
// a resize, leaving it or a press elsewhere hide it. It sits in the box itself, so a modal dialog's top layer holds it.
export function CardTips({box}:{box:RefObject<HTMLElement|null>}) {
 const tip=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const root=box.current; const el=tip.current; if(!root||!el) return;
  let on:HTMLElement|null=null; let keyed=false; let timer=0; let press=0; let swallow=false; let at={x:0,y:0};
  const show=(target:HTMLElement)=>{
   const text=target.dataset.tip; if(!text||!target.isConnected||target.getAttribute('aria-expanded')==='true') return;
   el.textContent=text; el.hidden=false;
   if(on!==target) { el.classList.remove('is-in'); void el.offsetWidth; el.classList.add('is-in'); }
   const r=target.getBoundingClientRect(); const w=el.offsetWidth; const h=el.offsetHeight;
   let top=r.top-h-8; if(top<8) top=r.bottom+8;
   const left=Math.max(8,Math.min(r.left+r.width/2-w/2,window.innerWidth-w-8));
   el.style.top=`${Math.round(top)}px`; el.style.left=`${Math.round(left)}px`; on=target;
  };
  const hide=()=>{ clearTimeout(timer); el.hidden=true; on=null; };
  const tipOf=(node:EventTarget|null)=>node instanceof Element?node.closest<HTMLElement>('[data-tip]'):null;
  const over=(event:PointerEvent)=>{ if(event.pointerType==='touch') return; const target=tipOf(event.target); if(target===on) return; clearTimeout(timer);
   if(!target) { hide(); return; } const quick=!el.hidden; timer=window.setTimeout(()=>show(target),quick?0:420); };
  const focus=(event:FocusEvent)=>{ const target=tipOf(event.target); if(target&&event.target===target&&keyed) show(target); else hide(); };
  const blur=()=>{ if(on&&!press) hide(); };
  const keys=(event:KeyboardEvent)=>{ keyed=true; if(event.key==='Escape'&&on) hide(); };
  const down=(event:PointerEvent)=>{ keyed=false; clearTimeout(press); press=0;
   if(event.pointerType!=='touch') { if(on) hide(); return; }
   const target=tipOf(event.target); if(!target) return; at={x:event.clientX,y:event.clientY};
   press=window.setTimeout(()=>{ show(target); swallow=!!on; press=0; },480); };
  const moved=(event:PointerEvent)=>{ if(press&&Math.hypot(event.clientX-at.x,event.clientY-at.y)>10) { clearTimeout(press); press=0; } };
  const lift=()=>{ clearTimeout(press); press=0; if(swallow) { clearTimeout(timer); timer=window.setTimeout(hide,1600); } };
  const click=(event:MouseEvent)=>{ if(swallow) { swallow=false; event.preventDefault(); event.stopPropagation(); } };
  root.addEventListener('pointerover',over); root.addEventListener('pointerleave',hide); root.addEventListener('focusin',focus); root.addEventListener('focusout',blur);
  root.addEventListener('keydown',keys,true); root.addEventListener('pointerdown',down,true); root.addEventListener('pointermove',moved,true);
  root.addEventListener('pointerup',lift,true); root.addEventListener('pointercancel',lift,true); root.addEventListener('click',click,true);
  window.addEventListener('scroll',hide,true); window.addEventListener('resize',hide);
  return ()=>{ clearTimeout(timer); clearTimeout(press);
   root.removeEventListener('pointerover',over); root.removeEventListener('pointerleave',hide); root.removeEventListener('focusin',focus); root.removeEventListener('focusout',blur);
   root.removeEventListener('keydown',keys,true); root.removeEventListener('pointerdown',down,true); root.removeEventListener('pointermove',moved,true);
   root.removeEventListener('pointerup',lift,true); root.removeEventListener('pointercancel',lift,true); root.removeEventListener('click',click,true);
   window.removeEventListener('scroll',hide,true); window.removeEventListener('resize',hide); };
 },[box]);
 return <div ref={tip} className="gtip" role="tooltip" hidden/>;
}
