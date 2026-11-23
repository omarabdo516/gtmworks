'use client';
import { useActionState, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { BoardIcon } from '@/components/board-icon';
import { leave } from '@/lib/motion';
import { toast } from '@/app/toast';
import { insertToken, tokenAtCaret } from '@/lib/composer-mentions.mjs';
import { MentionPop, mentionSuggestions, newId, type CallableAgent, type CallablePerson, type Suggestion } from '@/app/conversation-composer';
import { CardSheetChat, opensOn, type SheetChat } from '@/app/card-sheet-chat';
import { CardMenu, type CardMenuItem } from '@/app/card-menu';
import './log.css';
import './sheet.css';

type SheetTab='chat'|'log';
type SuggestionList={token:{type:string,q:string,start:number,end:number},items:Suggestion[],index:number};
// What the server reads for an open Card: its Log tab, drawn there, the number of its rows, whether an Agent called in
// one of its notes is still working, and its Chat tab (#145).
export type CardSheetData={id:number,log:ReactNode,count:number,working:boolean,chat:SheetChat};

// sheetOut in sheet.css.
const leaveMs=190;

// A Card opened over the board (#116; design-reference: openSheet, renderSheetHead, renderSheetBody, closeSheet): a modal
// dialog at the inline end, so the board behind it is inert, with the Card's head, its Chat and Log tabs and, on Log,
// the note field. It opens on the tab the Card's chat calls for, with the keyboard in that tab's field. Closing slides it out first; then the board's own address comes back and the keyboard is on the Card.
// send is the board's note action (work-actions.ts), handed in so this client file never imports the server module.
// An archived Card (#670; design-reference-card: cwCalloutHTML's archived branch) opens read-only: its head says who
// archived it and when, with Restore for a Member who may edit, and neither its log nor its chat takes a word. The head's
// "More" menu, for a Member who may edit, copies the Card's link and archives or restores it.
// The note field's "@" offers the Company's other Members and the Agents this Member sees (#154, #22), as a note is
// written for the team; it offers no Commands, as the reference's note field does not.
export function CardSheet({slug,company,title,face,who,badge,sheet,canWrite:mayWrite,alone,message,people=[],agents=[],send:sendNote,archived,archive}:{slug:string,company:string,title:string,face:ReactNode,who:ReactNode,badge:ReactNode,sheet:CardSheetData,canWrite:boolean,alone:boolean,message?:string,people?:CallablePerson[],agents?:CallableAgent[],send:(form:FormData)=>Promise<unknown>,archived?:{by:string,at:string},archive?:{archive:()=>void,restore:()=>void}}) {
 const {t}=useI18n(); const router=useRouter();
 const canWrite=mayWrite&&!archived;
 const box=useRef<HTMLDialogElement>(null); const logBox=useRef<HTMLDivElement>(null); const stopLeaving=useRef(()=>{}); const stick=useRef(true);
 const [tab,setTab]=useState<SheetTab>(opensOn(sheet.chat)); const [leaving,setLeaving]=useState(false);
 // The note and its suggestion list. The caret follows a pick, as the reference's pickPop leaves it.
 const [note,setNote]=useState(''); const [list,setList]=useState<SuggestionList|null>(null); const [listId]=useState(()=>`mention-note-${newId()}`);
 const noteField=useRef<HTMLTextAreaElement>(null); const caret=useRef<number|null>(null);
 const [,send,sending]=useActionState(async(_:null,form:FormData)=>{ await sendNote(form); setNote(''); setList(null); return null; },null);
 useEffect(()=>{ const field=noteField.current; if(caret.current===null||!field) return; field.focus(); field.setSelectionRange(caret.current,caret.current); caret.current=null; },[note]);
 function updateList(value:string,at:number) {
  const token=tokenAtCaret(value,at);
  if(!token) { setList(null); return; }
  const items=mentionSuggestions({people,agents},token,false);
  if(!items.length) { setList(null); return; }
  setList({token,items,index:0});
 }
 function pickEntry(at:number) {
  if(!list) return;
  const chosen=list.items[at]; if(!chosen) return;
  const next=insertToken(note,list.token,chosen.insert);
  caret.current=next.caret; setNote(next.value); setList(null);
 }
 const noteKeys=(event:KeyboardEvent<HTMLTextAreaElement>)=>{
  if(list) {
   if(event.key==='ArrowDown') { event.preventDefault(); setList(current=>current&&{...current,index:(current.index+1)%current.items.length}); return; }
   if(event.key==='ArrowUp') { event.preventDefault(); setList(current=>current&&{...current,index:(current.index-1+current.items.length)%current.items.length}); return; }
   if(event.key==='Enter'||event.key==='Tab') { event.preventDefault(); pickEntry(list.index); return; }
   if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); setList(null); return; }
  }
  if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing) { event.preventDefault(); if(note.trim()&&!sending) event.currentTarget.form?.requestSubmit(); }
 };
 const board=`/c/${slug}/work/board`;
 useLayoutEffect(()=>{
  if(!box.current?.open) box.current?.showModal();
  const frame=requestAnimationFrame(()=>box.current?.querySelector<HTMLElement>('.sheet-body > .composer-area textarea, .sheet-pane:not([hidden]) > .composer-area textarea')?.focus());
  return ()=>{ cancelAnimationFrame(frame); stopLeaving.current(); };
 },[]);
 // The log stays on its newest row while the reader is there: when it opens, after a note, when a reply lands.
 useLayoutEffect(()=>{ if(stick.current&&logBox.current) logBox.current.scrollTop=logBox.current.scrollHeight; },[sheet.log,tab]);
 // While an Agent called in a note works, the sheet reads itself again so its reply shows when it lands (#22).
 useEffect(()=>{ if(!sheet.working) return; const refresh=setInterval(()=>router.refresh(),3000); return ()=>clearInterval(refresh); },[sheet.working,router]);
 const close=()=>{
  const dialog=box.current; if(!dialog?.open||leaving) return;
  stopLeaving.current=leave(leaveMs,()=>setLeaving(true),()=>dialog.close());
 };
 // However it closed (after its leave animation, or at once when the browser would not wait), the Card gets the keyboard back.
 const closed=()=>{
  stopLeaving.current(); setLeaving(false);
  document.querySelector<HTMLElement>(`#board-cols .kcard[data-card-id="${sheet.id}"] a`)?.focus();
  router.push(board,{scroll:false});
 };
 const none=sheet.chat.kind==='none';
 const pick=(next:SheetTab)=>{ if(next==='chat'&&none) return; setTab(next); document.getElementById(`sh-tab-${next}`)?.focus(); };
 const chatLink=sheet.chat.kind==='own'&&`/c/${slug}/conversations/${sheet.chat.record.conversation.id}`;
 const copyLink=()=>{ try { void navigator.clipboard?.writeText(`${location.origin}${board}?card=${sheet.id}`).catch(()=>{}); } catch { /* the browser refused the clipboard */ } toast(t('cardLinkCopied'),{icon:'link'}); };
 const menu:CardMenuItem[]=archive?[{key:'copy',icon:'link',label:t('cardCopyLink'),run:copyLink},
  archived?{key:'restore',icon:'restore',label:t('cardRestore'),run:archive.restore}:{key:'archive',icon:'archive',label:t('cardArchive'),run:archive.archive}]:[];
 return <dialog ref={box} className={`sheet${leaving?' is-closing':''}`} aria-labelledby="sheet-title" onCancel={event=>{ if(event.cancelable) { event.preventDefault(); close(); } }} onClose={closed} onClick={event=>{ if(event.target===event.currentTarget) close(); }}>
  <div className="sheet__inner">
   <header className="sheet__head" id="sheet-head">
    <div className="sheet__top">{face}<h2 className="sheet__title" id="sheet-title"><bdi>{title}</bdi></h2>
     {mayWrite&&menu.length>0&&<CardMenu items={menu}/>}
     <button type="button" className="circle-btn" aria-label={t('sheetClose')} onClick={close}><ShellIcon name="x"/></button></div>
    <div className="sheet__meta">{who&&<>{who}<span aria-hidden="true">·</span></>}{badge}
     {chatLink&&<Link className="link-btn" href={chatLink}><ShellIcon name="open"/><span>{t('sheetOpenInChats')}</span></Link>}
     {!archived&&<Link className="link-btn" href={`${board}/${sheet.id}`}>{t('sheetCardDetails')}</Link>}</div>
    {archived&&<section className="sheet-archived" aria-label={t('cardArchived')}><ShellIcon name="archive"/><p className="sheet-archived__q"><bdi>{archived.by}</bdi> · <span className="num">{archived.at}</span></p>
     {mayWrite&&archive&&<button type="button" className="btn btn--primary btn--sm" onClick={archive.restore}><ShellIcon name="restore"/><span>{t('cardRestoreShort')}</span></button>}</section>}
    <div className="segmented sheet-tabs" role="tablist" aria-label={t('sheetTabs')} onKeyDown={event=>{ if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); pick(event.key==='Home'?'chat':event.key==='End'?'log':tab==='log'?'chat':'log'); } }}>
     <button type="button" role="tab" id="sh-tab-chat" aria-selected={tab==='chat'} aria-controls={tab==='chat'?'sheet-transcript':undefined} aria-disabled={none||undefined} tabIndex={tab==='chat'?0:-1} onClick={()=>pick('chat')}>{t('sheetTabChat')}</button>
     <button type="button" role="tab" id="sh-tab-log" aria-selected={tab==='log'} aria-controls={tab==='log'?'sheet-log':undefined} tabIndex={tab==='log'?0:-1} onClick={()=>pick('log')}>{t('sheetTabLog')} <span className="num sheet-tabs__n">{sheet.count}</span></button>
    </div>
   </header>
   <div className="sheet-body">{tab==='log'&&<>
    <div ref={logBox} className="transcript sheet-log" id="sheet-log" role="tabpanel" aria-labelledby="sh-tab-log" tabIndex={-1} onScroll={event=>{ const view=event.currentTarget; stick.current=view.scrollHeight-view.scrollTop-view.clientHeight<80; }}>{sheet.log}</div>
    <div className="composer-area">{message&&<p role="alert" className="composer-error">{message}</p>}{canWrite?<>
     <form className="composer note-composer" action={send}>
      <input type="hidden" name="op" value="comment"/><input type="hidden" name="slug" value={slug}/><input type="hidden" name="company" value={company}/><input type="hidden" name="card" value={sheet.id}/><input type="hidden" name="view" value="sheet"/>
      {list&&<MentionPop listId={listId} label={t('mentionCallSomeone')} items={list.items} index={list.index} pick={pickEntry}/>}
      <div className="composer__row">
       <label className="sr-only" htmlFor="ta-note">{t('sheetNoteLabel')}</label>
       <textarea ref={noteField} className="composer__input" id="ta-note" name="body" rows={1} dir="auto" required readOnly={sending} placeholder={t(alone?'notePlaceholderAlone':'notePlaceholderTeam')} aria-describedby="note-hint"
        value={note} aria-autocomplete="list" aria-expanded={!!list} aria-activedescendant={list?`${listId}-${list.index}`:undefined}
        onChange={event=>{ const value=event.target.value; setNote(value); updateList(value,event.target.selectionStart??value.length); }} onKeyDown={noteKeys}/>
       <button type="submit" className="composer__send" aria-label={t('sheetNoteSend')} disabled={!note.trim()||sending}><ShellIcon name="send"/></button>
      </div>
     </form>
     <p className="note-hint" id="note-hint"><BoardIcon name="clock"/><span>{t('noteHint')}</span></p>
    </>:archived?<p className="ro-line"><ShellIcon name="archive"/><span>{t('cardArchivedReadOnly')}</span></p>:<p className="ro-line"><BoardIcon name="eye"/><span>{t('noteViewOnly')}</span></p>}</div>
   </>}
    {/* Kept while Log shows, so a message on its way, and the reply it waits for, still land in the chat. */}
    <div className="sheet-pane" hidden={tab!=='chat'}><CardSheetChat slug={slug} company={company} card={sheet.id} chat={sheet.chat} writer={canWrite} shown={tab==='chat'} openLog={()=>pick('log')}/></div></div>
  </div>
 </dialog>;
}
