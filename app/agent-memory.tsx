'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import type { MemoryNote } from '@/lib/engine.mjs';

// One Agent's memory (#350; design-reference: memoryHTML, memNoteHTML): the notes its own Engine profile holds, or the
// empty state, and what the Company keeps apart from them. It is drawn in the Agent's details panel and, later, in
// Settings, so it takes the notes and the flags rather than reading them itself. Editing, forgetting and searching are
// not built yet (#191, #192). An Owner gets "Reset memory", which asks first; the server checks the Role again
// (/api/agent-memory, check_memory_reset) and writes one log row with no note text.
export type AgentMemoryProps={company:string,agent:{id:string,name:string},notes:MemoryNote[],main:boolean,canReset:boolean};
export function AgentMemory({company,agent,notes,main,canReset}:AgentMemoryProps) {
 const {t}=useI18n(); const router=useRouter();
 const [asking,setAsking]=useState(false); const [pending,setPending]=useState(false); const [failed,setFailed]=useState(false);
 const resetButton=useRef<HTMLButtonElement>(null); const cancelButton=useRef<HTMLButtonElement>(null); const asked=useRef(false);
 // The question takes the focus, on Cancel (the harmless answer); closing it gives it back to "Reset memory".
 useEffect(()=>{
  if(asking) cancelButton.current?.focus();
  else if(asked.current) resetButton.current?.focus();
  asked.current=asking;
 },[asking]);
 const ask=()=>{ setFailed(false); setAsking(true); };
 const keep=()=>{ setAsking(false); };
 const reset=async()=>{
  if(pending) return;
  setPending(true); setFailed(false);
  try {
   const response=await fetch('/api/agent-memory',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({company,agent:agent.id}),cache:'no-store'});
   if(!response.ok) { setFailed(true); setPending(false); return; }
   setAsking(false); setPending(false); router.refresh();
  } catch { setFailed(true); setPending(false); }
 };
 return <section className="dp-sec" aria-labelledby="mem-h">
  <h3 className="dp-label" id="mem-h"><span>{t('memoryHeading',agent.name)} <span className="muted num">{notes.length}</span></span>
   {canReset&&!asking&&<button ref={resetButton} type="button" className="link-btn" aria-expanded={false} onClick={ask}>{t('memoryReset')}</button>}</h3>
  <p className="mem-intro">{t('memoryIntro')}</p>
  <p className="mem-know"><ShellIcon name="book"/><span>{t('memoryKnow',agent.name)}</span></p>
  {main&&<p className="mem-main">{t('memoryMain',agent.name)}</p>}
  {asking&&<div className="panel-card mem-confirm">
   <p className="panel-empty">{t('memoryResetAsk',agent.name)}</p>
   <div className="panel-form__row panel-form__row--end">
    <button ref={cancelButton} type="button" className="btn btn--secondary" disabled={pending} onClick={keep}>{t('cancel')}</button>
    <button type="button" className="btn btn--primary" aria-busy={pending} disabled={pending} onClick={reset}>{t('memoryReset')}</button>
   </div></div>}
  {failed&&<p className="set-err" role="alert">{t('memoryResetFailed')}</p>}
  {notes.length
   ?<ul className="panel-card">{notes.map(note=><li key={note.id} className="panel-row mem-note" data-mem-row={note.id}><span className="mem-note__t" dir="auto">{note.text}</span></li>)}</ul>
   :<div className="panel-card"><p className="panel-empty">{t('memoryEmpty',agent.name)}</p></div>}
 </section>;
}
