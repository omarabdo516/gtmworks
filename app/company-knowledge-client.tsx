'use client';
import { useEffect, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { dateFormatter, dayOf } from '@/lib/activity-log.mjs';
import { madeDay, useZone } from './agent-made';
import { SettingsIcon } from './settings-icons';
import { InfoTip } from './settings-info';
import { saveCompanyKnowledge } from './company-knowledge-actions';
import { toast } from './toast';

type KnowledgeOutcome=Awaited<ReturnType<typeof saveCompanyKnowledge>>;
const saved:KnowledgeOutcome[]=['companyKnowledgeSaved','companyKnowledgeCleared','companyKnowledgeUnchanged'];

// One part of the Company knowledge as an Owner or a Manager sees it (#27; design-reference: sovKnowHTML, saveKnow): the
// page with its Edit button, which turns it into a text field. Escape cancels and Ctrl or Cmd+S saves; focus goes back to
// Edit either way. The server checks the Role again, and the page is read again once it has saved.
export default function KnowledgeEditor({company,part,title,body,children}:{company:string,part:string,title:string,body:string,children:ReactNode}) {
 const {t}=useI18n(); const router=useRouter();
 const [draft,setDraft]=useState<string|null>(null); const [error,setError]=useState<KnowledgeOutcome|''>('');
 const [pending,startTransition]=useTransition();
 const editButton=useRef<HTMLButtonElement>(null); const field=useRef<HTMLTextAreaElement>(null); const moved=useRef(false);
 const editing=draft!==null; const dirty=draft!==null&&draft.trim()!==body.trim();
 useEffect(()=>{ if(moved.current) (editing?field:editButton).current?.focus(); },[editing]);
 // A link that would leave the page with the text changed keeps the person here: the reference's sovDirty (#169).
 useEffect(()=>{
  if(!dirty) return;
  const leaving=(event:MouseEvent)=>{
   const target=event.target instanceof Element?event.target.closest('.sov a[href], #sov-close'):null;
   if(!target) return;
   event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
   toast(t('knowSaveOrCancel'));
   document.getElementById('know-save')?.focus();
  };
  document.addEventListener('click',leaving,true);
  return ()=>document.removeEventListener('click',leaving,true);
 },[dirty,t]);
 const open=()=>{ moved.current=true; setError(''); setDraft(body); };
 const close=()=>{ moved.current=true; setError(''); setDraft(null); };
 const save=()=>{ if(draft===null||pending) return; startTransition(async()=>{
  const outcome=await saveCompanyKnowledge(company,part,draft).catch(():KnowledgeOutcome=>'companyKnowledgeFailed');
  if(!saved.includes(outcome)) { setError(outcome); field.current?.focus(); return; }
  toast(t(outcome,title));
  // The page leaves edit mode together with the text read again, so the old text is never shown in between.
  startTransition(()=>{ close(); router.refresh(); });
 }); };
 const keys=(event:KeyboardEvent<HTMLElement>)=>{
  if(event.key==='Escape') { event.preventDefault(); close(); }
  // By the key's place, not its letter, so Ctrl+S also saves on an Arabic keyboard (where that key types «س»).
  else if((event.ctrlKey||event.metaKey)&&event.code==='KeyS') { event.preventDefault(); save(); }
 };
 return <article className="know-page" aria-labelledby={editing?'know-edit-l':'know-h'} aria-busy={pending||undefined} onKeyDown={editing?keys:undefined}>
  {editing?<>
   <div className="set-field"><span className="set-label-row"><label className="set-label" htmlFor="know-edit" id="know-edit-l">{t('knowEditPart',title)}</label>
    <InfoTip about={title} id="know-edit-hint">{t('knowEditHint')}</InfoTip></span>
    <textarea ref={field} className="set-input set-textarea know-ta" id="know-edit" rows={12} dir="auto" aria-describedby="know-edit-hint know-edit-err" aria-invalid={!!error||undefined} readOnly={pending}
     value={draft} onChange={event=>{ setDraft(event.target.value); setError(''); }}/>
    {error&&<span className="set-err" id="know-edit-err" role="alert">{t(error)}</span>}
   </div>
   <div className="panel-form__row panel-form__row--end"><button type="button" className="btn btn--secondary btn--sm" onClick={close}>{t('cancel')}</button>
    <button type="button" className="btn btn--primary btn--sm" id="know-save" disabled={pending} onClick={save}>{t('save')}</button></div>
  </>:<>
   <div className="know-page__top"><h4 className="know-page__h" id="know-h">{title}</h4>
    <button ref={editButton} type="button" className="btn btn--secondary btn--sm" id="know-edit-btn" onClick={open}><SettingsIcon name="pencil"/><span>{t('knowEdit')}</span></button></div>
   {children}
  </>}
 </article>;
}

// When the part was last edited, in the reader's own time zone once the page has hydrated (as RuleSaid in
// settings-overlay-client.tsx): today and yesterday with the time, an older day without it.
export function KnowledgeEditedAt({at}:{at:string}) {
 const {t,language}=useI18n(); const zone=useZone();
 const day=dayOf(at,zone); const today=dayOf(new Date().toISOString(),zone);
 const yesterday=new Date(new Date(`${today}T00:00:00Z`).getTime()-86400000).toISOString().slice(0,10);
 const time=dateFormatter(localeFor(language),{hour:'numeric',minute:'2-digit',timeZone:zone}).format(new Date(at));
 return <time dateTime={at} data-utc={zone}>{day===today?`${t('logToday')} · ${time}`:day===yesterday?`${t('logYesterday')} · ${time}`:madeDay(at,language,zone)}</time>;
}
