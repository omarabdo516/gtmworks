'use client';
import { useActionState, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { saveMemberNote } from './member-note-actions';
import { noteLimit, secretLike } from '@/lib/secret-text.mjs';
import en from '@/lib/messages/member-note.en.json';
import ar from '@/lib/messages/member-note.ar.json';

// A Member's own note for the Agents in this Company, laid out as the reference lays out standing instructions (a quiet
// label over a card holding the text, a hint with the count, and Save). It is checked here for length and anything
// that looks like a secret before it is sent; the server action and the database check both again. It loads only when
// the account section is open (settings-overlay.tsx), so no other page carries it, nor its strings: they live in
// member-note.en.json and member-note.ar.json, in this component's own chunk, not in the catalogue every route loads.
export default function MemberNote({company,note}:{company:string,note:string}) {
 const {language,locale}=useI18n(); const text:Record<string,string>=language==='ar'?ar:en;
 const t=(key:string,...values:unknown[])=>text[key].replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)] ?? ''));
 const [value,setValue]=useState(note); const [message,save,pending]=useActionState(saveMemberNote,'');
 const [edited,setEdited]=useState(false);
 const local=value.trim().length>noteLimit?'memberNoteTooLong':secretLike(value)?'memberNoteSecret':'';
 const shown=edited?local:local||message;
 const count=(number:number)=>new Intl.NumberFormat(locale).format(number);
 const failed=shown&&shown!=='memberNoteSaved';
 return <section className="dp-sec" aria-labelledby="ac-h-note"><h4 className="dp-label" id="ac-h-note"><span>{t('memberNote')}</span></h4>
  <form className="panel-card set-card" action={form=>{ setEdited(false); save(form); }}>
   <p className="set-hint">{t('memberNoteD')}</p>
   <div className="set-field">
    <label className="sr-only" htmlFor="ac-note">{t('memberNote')}</label>
    <input type="hidden" name="company" value={company}/>
    <textarea className="set-input set-textarea" id="ac-note" name="note" rows={6} dir="auto" placeholder={t('memberNotePlaceholder')} aria-describedby="ac-note-hint ac-note-count ac-note-status" aria-invalid={!!failed||undefined} value={value} onChange={event=>{ setValue(event.target.value); setEdited(true); }}/>
    <div className="set-hint-row"><span className="set-hint od-fill" id="ac-note-hint">{t('memberNoteHint',count(noteLimit))}</span><span className="set-count num" id="ac-note-count">{count(value.length)} / {count(noteLimit)}</span></div>
   </div>
   <p id="ac-note-status" className={failed?'set-err':'set-hint'} role={failed?'alert':'status'}>{shown?t(shown,count(noteLimit)):null}</p>
   <div className="set-actions"><button type="submit" className="btn btn--primary btn--sm" disabled={pending||!!local}>{t('memberNoteSave')}</button></div>
  </form>
 </section>;
}
