'use client';
// A chat's Card on the board (#144), kept apart from the board's server actions so a component test reaches only client
// modules.
import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { CompanyAgentFace } from '@/components/company-agent-face';

// A Card's own Agent (work_cards.agent_id), the one whose chat put it on the board.
export type CardAgent={id:string,connection_id:string,name:string,speciality:string};

// The chat's corner pill opens the board on its Card (design-reference: show-on-board): an Agent filter that would hide
// it goes back to all, then the Card comes into view, takes the keyboard and flashes once.
export function useShowCard(show:number|undefined,{hides,showAll,board}:{hides:boolean,showAll:()=>void,board:string}) {
 const router=useRouter();
 if(show&&hides) showAll();
 useEffect(()=>{
  if(!show) return;
  const shown=document.querySelector<HTMLElement>(`#board-cols .kcard[data-card-id="${show}"]`);
  if(shown) {
   shown.scrollIntoView({block:'nearest',inline:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
   shown.classList.add('is-flash');
   shown.addEventListener('animationend',()=>shown.classList.remove('is-flash'),{once:true});
   shown.querySelector<HTMLElement>('a')?.focus({preventScroll:true});
  }
  // Shown once: a reload of the board does not show it again.
  router.replace(board,{scroll:false});
 },[show,router,board]);
}

// The foot of a Card a chat put on the board: its Agent whole, then the Agent's job (the reference's chan), then its date.
export function ChatCardFoot({agent,job,due}:{agent:CardAgent,job:string,due?:ReactNode}) {
 return <span className="kcard__foot"><span className="kcard__agent kcard__agent--own card-avatars"><span aria-hidden="true"><CompanyAgentFace agent={agent} size={18}/></span><bdi>{agent.name}</bdi></span>{job&&<span className="kcard__job od-truncate">· <bdi>{job}</bdi></span>}{due}</span>;
}
