'use client';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

// The Agents each Company's grid has shown during this visit. It lives as long as the page does, so a page the router
// draws next (or the same page drawn again) knows what the grid held before it, and a page load starts it empty.
const shown=new Map<string,Set<string>>();

// The sidebar's Agents grid (app/shell.tsx). A tile that was not in it before during this visit, as when Lead has just
// made its Agent, flashes once (#134; design-reference: makeAgentFrom and the made card's end, is-flash removed after
// 1500ms). Nothing flashes when the page loads, nor in a Company the visit had not shown yet.
export default function AgentGrid({company,agents,children}:{company:string,agents:string[],children:ReactNode}) {
 const grid=useRef<HTMLUListElement>(null);
 const listed=agents.join(' ');
 useLayoutEffect(()=>{
  const now=listed?listed.split(' '):[];
  const before=shown.get(company);
  // Kept, not replaced: an Agent the grid left out for a moment (a read between two writes) does not flash again.
  shown.set(company,new Set([...(before||[]),...now]));
  if(!before) return;
  for(const id of now) {
   if(before.has(id)) continue;
   const tile=grid.current?.querySelector(`.agent-tile[data-agent="${CSS.escape(id)}"]`);
   if(!tile) continue;
   tile.classList.add('is-flash');
   // Not cleared when the grid is drawn again: the mark goes after its time even if another Agent arrives meanwhile.
   window.setTimeout(()=>tile.classList.remove('is-flash'),1500);
  }
 },[company,listed]);
 return <ul className="agent-grid" ref={grid}>{children}</ul>;
}
