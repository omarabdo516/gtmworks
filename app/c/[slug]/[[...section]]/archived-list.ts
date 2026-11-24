'use client';
import { useEffect, useRef, useState } from 'react';
import { searchFold } from '@/lib/arabic-search.mjs';
import type { ArchivedCursor, ArchivedPage, ArchivedWant } from '@/lib/archived-cards';

// The board's archive list (#705; design-reference-card: the board's archive icon, bt-search), read a page at a time,
// newest archived first, as All conversations is. Handed in (work-actions.ts' archivedCardList), so this client file never
// imports the server module.
export type ReadArchived<C>=(company:string,want:ArchivedWant,after:ArchivedCursor|null)=>Promise<ArchivedPage<C>|null>;
type Want=Required<ArchivedWant>;
type Listed={id:number,title:string,agent_id?:string|null,project_id?:number|null,archived_at?:string|null};

// A search asks the database once typing pauses.
const searchPause=250;
// What is asked, as one value an effect can follow: the search as typed, trimmed, and the board's two filters.
const keyOf=(want:Want)=>JSON.stringify([want.q.trim(),want.agent,want.project]);
const wantOf=(key:string):Want=>{ const [q,agent,project]=JSON.parse(key) as [string,string|null,number|null]; return {q,agent,project}; };
const blank=keyOf({q:'',agent:null,project:null});
// The server's first page by what it holds: the board is read again often (a move, an Agent at work), and a first page
// that holds the same Cards keeps the pages "Show more" added under it.
const pageKey=(page:ArchivedPage<Listed>|null)=>page?JSON.stringify([page.items.map(c=>[c.id,c.archived_at]),page.next]):'';
// Whether a Card answers what is asked, as archived_card_list reads it: the rows shown while the database is asked.
const answers=(want:Want)=>{ const fold=searchFold(want.q); return (c:Listed)=>(!want.agent||c.agent_id===want.agent)&&(want.project==null||c.project_id===want.project)&&(!fold||searchFold(c.title).includes(fold)); };

// The server's first page shows while nothing is searched or filtered. A search or a filter asks the database while the
// list is open; until it answers, the rows already read that match are shown. "Show more" adds the next page after the
// rows shown, only once they answer what is asked. A first page the server reads with other Cards (one archived or
// restored) asks again; a Card restored from a later page leaves the list at once (`drop`). Each answer counts only
// while it is the newest asked.
export function useArchivedList<C extends Listed>(company:string,first:ArchivedPage<C>|null,want:Want,read:ReadArchived<C>|undefined,open:boolean) {
 const wanted=keyOf(want);
 const served=pageKey(first);
 const [held,setHeld]=useState<{for:string,from:string,page:ArchivedPage<C>|null}|null>(null);
 const [loading,setLoading]=useState(false);
 const asked=useRef(0);
 useEffect(()=>{
  const ask=++asked.current;
  if(!open||!read||wanted===blank) return;
  const asking=wantOf(wanted);
  const timer=window.setTimeout(()=>{ void read(company,asking,null).catch(()=>null).then(found=>{ if(ask===asked.current) setHeld({for:wanted,from:served,page:found}); }); },asking.q?searchPause:0);
  return ()=>window.clearTimeout(timer);
 },[wanted,served,company,open,read]);
 const fresh=!!held&&held.for===wanted&&held.from===served;
 const settled=fresh||wanted===blank;
 const page:ArchivedPage<C>|null=fresh?held.page:wanted===blank?first:(()=>{ const shown=(held?.from===served&&held.page)||first; return shown&&{items:shown.items.filter(answers(want)),next:null}; })();
 const more=async():Promise<'failed'|void>=>{
  const after=page?.next; if(!after||loading||!settled||!read||!page) return;
  const ask=asked.current; setLoading(true);
  const next=await read(company,wantOf(wanted),after).catch(()=>null);
  setLoading(false);
  if(ask!==asked.current) return;
  if(!next) return 'failed';
  const known=new Set(page.items.map(c=>c.id));
  setHeld({for:wanted,from:served,page:{items:[...page.items,...next.items.filter(c=>!known.has(c.id))],next:next.next}});
 };
 const drop=(ids:number[])=>setHeld(now=>now?.page?{...now,page:{...now.page,items:now.page.items.filter(c=>!ids.includes(c.id))}}:now);
 return {page,settled,loading,more,drop,searched:wanted!==blank};
}
