'use client';
// A chat's Card on the board (#144), kept apart from the board's server actions so a component test reaches only client
// modules.
import { useEffect, useState } from 'react';

// A Card's own Agent (work_cards.agent_id), the one whose chat put it on the board.
export type CardAgent={id:string,connection_id:string,name:string,speciality:string};

// The chat's corner pill opens the board on its Card (design-reference: show-on-board): an Agent filter that would hide
// it goes back to all, then the Card comes into view, takes the keyboard and flashes once.
export function useShowCard(show:number|undefined,{hides,showAll,board}:{hides:boolean,showAll:()=>void,board:string}) {
 // Once per Card shown: clearing `show` from the address leaves it in the board's props, and a filter the person picks
 // afterwards must stay.
 const [seen,setSeen]=useState<number|undefined>();
 if(show!==seen) { setSeen(show); if(show&&hides) showAll(); }
 useEffect(()=>{
  if(!show) return;
  const shown=document.querySelector<HTMLElement>(`#board-cols .kcard[data-card-id="${show}"]`);
  if(shown) {
   shown.scrollIntoView({block:'nearest',inline:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
   shown.classList.add('is-flash');
   // Only the flash's own end: a progress bar growing in when the board opens (#131) ends inside the Card too.
   const flashed=(event:AnimationEvent)=>{ if(event.target!==shown) return; shown.classList.remove('is-flash'); shown.removeEventListener('animationend',flashed); };
   shown.addEventListener('animationend',flashed);
   shown.querySelector<HTMLElement>('a')?.focus({preventScroll:true});
  }
  // Shown once: a reload does not show it again. Only the address changes, so the board keeps the Card the server read
  // for `show` past the list's cap (Next keeps native history updates in step with the router).
  window.history.replaceState(null,'',board);
 },[show,board]);
}
