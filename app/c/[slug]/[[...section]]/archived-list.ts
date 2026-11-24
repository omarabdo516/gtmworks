'use client';
import { useEffect, useRef, useState } from 'react';
import { searchFold } from '@/lib/arabic-search.mjs';
import type { ArchivedCursor, ArchivedPage, ArchivedWant } from '@/lib/archived-cards';

// The board's archive list (#705; design-reference-card: the board's archive icon, bt-search), read a page at a time,
// newest archived first, as All conversations is. Handed in (work-actions.ts' archivedCardList), so this client file never
// imports the server module.
export type ReadArchived<C>=(company:string,want:ArchivedWant,after:ArchivedCursor|null)=>Promise<ArchivedPage<C>|null>;
export type ArchiveWant={q:string,agent:string|null,project:number|null};
type Listed={id:number,title:string,agent_id?:string|null,project_id?:number|null};

// A search asks the database once typing pauses.
const searchPause=250;
const keyOf=(want:ArchiveWant)=>JSON.stringify([want.q.trim(),want.agent,want.project]);
const wantOf=(key:string):ArchiveWant=>{ const [q,agent,project]=JSON.parse(key) as [string,string|null,number|null]; return {q,agent,project}; };
const blank=keyOf({q:'',agent:null,project:null});
// Whether a Card answers what is asked, as archived_card_list reads it: the list shown while the database is asked.
const answers=(want:ArchiveWant)=>{ const fold=searchFold(want.q); return (c:Listed)=>(!want.agent||c.agent_id===want.agent)&&(want.project==null||c.project_id===want.project)&&(!fold||searchFold(c.title).includes(fold)); };

// The server's first page shows while nothing is searched or filtered. A search or a filter asks the database while the
// list is open; until it answers, the rows already read that match are shown. "Show more" adds the next page after the
// rows shown, only once they answer what is asked. The server's page read again (an archive or a restore refreshes it)
// asks again, so a Card that left the archive leaves the list. Each answer counts only while it is the newest asked.
export function useArchivedList<C extends Listed>(company:string,first:ArchivedPage<C>|null,want:ArchiveWant,read:ReadArchived<C>|undefined,open:boolean) {
 const wanted=keyOf(want);
 const [held,setHeld]=useState<{for:string,from:ArchivedPage<C>|null,page:ArchivedPage<C>|null}|null>(null);
 const [loading,setLoading]=useState(false);
 const asked=useRef(0);
 useEffect(()=>{
  const ask=++asked.current;
  if(!open||!read||wanted===blank) return;
  const asking=wantOf(wanted);
  const timer=window.setTimeout(()=>{ void read(company,asking,null).catch(()=>null).then(found=>{ if(ask===asked.current) setHeld({for:wanted,from:first,page:found}); }); },asking.q?searchPause:0);
  return ()=>window.clearTimeout(timer);
 },[wanted,first,company,open,read]);
 const fresh=!!held&&held.for===wanted&&held.from===first;
 const settled=fresh||wanted===blank;
 const page:ArchivedPage<C>|null=fresh?held.page:wanted===blank?first:(()=>{ const shown=held?.from===first?held.page:first; return shown&&{items:shown.items.filter(answers(want)),next:null}; })();
 const more=async():Promise<'failed'|void>=>{
  const after=page?.next; if(!after||loading||!settled||!read||!page) return;
  const ask=asked.current; setLoading(true);
  const next=await read(company,wantOf(wanted),after).catch(()=>null);
  setLoading(false);
  if(ask!==asked.current) return;
  if(!next) return 'failed';
  const known=new Set(page.items.map(c=>c.id));
  setHeld({for:wanted,from:first,page:{items:[...page.items,...next.items.filter(c=>!known.has(c.id))],next:next.next}});
 };
 return {page,settled,loading,more,searched:wanted!==blank};
}
