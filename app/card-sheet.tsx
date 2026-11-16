'use client';
import { useActionState, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { BoardIcon } from '@/components/board-icon';
import './log.css';
import './sheet.css';

type SheetTab='chat'|'log';
// The Conversation a Card came from, when the reader may open it. Nothing ties a Card to a Conversation yet (#116).
type ChatTie={conversationId:string};
// What the server reads for an open Card: its Log tab, drawn there, the number of its rows, whether an Agent called in
// one of its notes is still working, and its Conversation.
export type CardSheetData={id:number,log:ReactNode,count:number,working:boolean,chat:ChatTie|null};

// sheetOut in sheet.css.
const leaveMs=190;

// A Card opened over the board (#116; design-reference: openSheet, renderSheetHead, renderSheetBody, closeSheet): a modal
// dialog at the inline end, so the board behind it is inert, with the Card's head, its Chat and Log tabs and, on Log,
// the note field. Closing slides it out first; then the board's own address comes back and the keyboard is on the Card.
// send is the board's note action (work-actions.ts), handed in so this client file never imports the server module.
export function CardSheet({slug,company,title,face,who,badge,sheet,canWrite,alone,message,send:sendNote}:{slug:string,company:string,title:string,face:ReactNode,who:ReactNode,badge:ReactNode,sheet:CardSheetData,canWrite:boolean,alone:boolean,message?:string,send:(form:FormData)=>Promise<unknown>}) {
 const {t}=useI18n(); const router=useRouter();
 const box=useRef<HTMLDialogElement>(null); const logBox=useRef<HTMLDivElement>(null); const timer=useRef<ReturnType<typeof setTimeout>>(undefined); const stick=useRef(true);
 const [tab,setTab]=useState<SheetTab>(sheet.chat?'chat':'log'); const [leaving,setLeaving]=useState(false); const [filled,setFilled]=useState(false);
 const [,send,sending]=useActionState(async(_:null,form:FormData)=>{ await sendNote(form); setFilled(false); return null; },null);
 const board=`/c/${slug}/work/board`;
 useLayoutEffect(()=>{
  if(!box.current?.open) box.current?.showModal();
  const frame=requestAnimationFrame(()=>document.getElementById('ta-note')?.focus());
  return ()=>{ cancelAnimationFrame(frame); clearTimeout(timer.current); };
 },[]);
 // The log stays on its newest row while the reader is there: when it opens, after a note, when a reply lands.
 useLayoutEffect(()=>{ if(stick.current&&logBox.current) logBox.current.scrollTop=logBox.current.scrollHeight; },[sheet.log,tab]);
 // While an Agent called in a note works, the sheet reads itself again so its reply shows when it lands (#22).
 useEffect(()=>{ if(!sheet.working) return; const refresh=setInterval(()=>router.refresh(),3000); return ()=>clearInterval(refresh); },[sheet.working,router]);
 const close=()=>{
  const dialog=box.current; if(!dialog?.open||leaving) return;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) { dialog.close(); return; }
  setLeaving(true); timer.current=setTimeout(()=>dialog.close(),leaveMs);
 };
 // However it closed (after its leave animation, or at once when the browser would not wait), the Card gets the keyboard back.
 const closed=()=>{
  clearTimeout(timer.current); setLeaving(false);
  document.querySelector<HTMLElement>(`#board-cols .kcard[data-card-id="${sheet.id}"] a`)?.focus();
  router.push(board,{scroll:false});
 };
 const pick=(next:SheetTab)=>{ if(next==='chat'&&!sheet.chat) return; setTab(next); document.getElementById(`sh-tab-${next}`)?.focus(); };
 const chatLink=sheet.chat&&`/c/${slug}/conversations/${sheet.chat.conversationId}`;
 return <dialog ref={box} className={`sheet${leaving?' is-closing':''}`} aria-labelledby="sheet-title" onCancel={event=>{ if(event.cancelable) { event.preventDefault(); close(); } }} onClose={closed} onClick={event=>{ if(event.target===event.currentTarget) close(); }}>
  <div className="sheet__inner">
   <header className="sheet__head" id="sheet-head">
    <div className="sheet__top">{face}<h2 className="sheet__title authored-title" id="sheet-title" dir="auto">{title}</h2>
     <button type="button" className="circle-btn" aria-label={t('sheetClose')} onClick={close}><ShellIcon name="x"/></button></div>
    <div className="sheet__meta">{who&&<>{who}<span aria-hidden="true">·</span></>}{badge}
     {chatLink&&<Link className="link-btn" href={chatLink}><ShellIcon name="open"/><span>{t('sheetOpenInChats')}</span></Link>}
     <Link className="link-btn" href={`${board}/${sheet.id}`}>{t('sheetCardDetails')}</Link></div>
    <div className="segmented sheet-tabs" role="tablist" aria-label={t('sheetTabs')} onKeyDown={event=>{ if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); pick(event.key==='Home'?'chat':event.key==='End'?'log':tab==='log'?'chat':'log'); } }}>
     <button type="button" role="tab" id="sh-tab-chat" aria-selected={tab==='chat'} aria-controls={tab==='chat'?'sheet-transcript':undefined} aria-disabled={!sheet.chat||undefined} tabIndex={tab==='chat'?0:-1} onClick={()=>pick('chat')}>{t('sheetTabChat')}</button>
     <button type="button" role="tab" id="sh-tab-log" aria-selected={tab==='log'} aria-controls={tab==='log'?'sheet-log':undefined} tabIndex={tab==='log'?0:-1} onClick={()=>pick('log')}>{t('sheetTabLog')} <span className="num sheet-tabs__n">{sheet.count}</span></button>
    </div>
   </header>
   <div className="sheet-body">{tab==='log'?<>
    <div ref={logBox} className="transcript sheet-log" id="sheet-log" role="tabpanel" aria-labelledby="sh-tab-log" tabIndex={-1} onScroll={event=>{ const view=event.currentTarget; stick.current=view.scrollHeight-view.scrollTop-view.clientHeight<80; }}>{sheet.log}</div>
    <div className="composer-area">{message&&<p role="alert" className="composer-error">{message}</p>}{canWrite?<>
     <form className="composer note-composer" action={send}>
      <input type="hidden" name="op" value="comment"/><input type="hidden" name="slug" value={slug}/><input type="hidden" name="company" value={company}/><input type="hidden" name="card" value={sheet.id}/><input type="hidden" name="view" value="sheet"/>
      <div className="composer__row">
       <label className="sr-only" htmlFor="ta-note">{t('sheetNoteLabel')}</label>
       <textarea className="composer__input" id="ta-note" name="body" rows={1} dir="auto" required readOnly={sending} placeholder={t(alone?'notePlaceholderAlone':'notePlaceholderTeam')} aria-describedby="note-hint"
        onInput={event=>setFilled(!!event.currentTarget.value.trim())}
        onKeyDown={event=>{ if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing) { event.preventDefault(); if(filled&&!sending) event.currentTarget.form?.requestSubmit(); } }}/>
       <button type="submit" className="composer__send" aria-label={t('sheetNoteSend')} disabled={!filled||sending}><ShellIcon name="send"/></button>
      </div>
     </form>
     <p className="note-hint" id="note-hint"><BoardIcon name="clock"/><span>{t('noteHint')}</span></p>
    </>:<p className="ro-line"><BoardIcon name="eye"/><span>{t('noteViewOnly')}</span></p>}</div>
   </>:<>
    {/* The Conversation itself is not drawn here yet; its tab opens it in Chats. */}
    <div className="transcript" id="sheet-transcript" role="tabpanel" aria-labelledby="sh-tab-chat" tabIndex={-1}>{chatLink&&<Link className="btn btn--secondary" href={chatLink}><ShellIcon name="open"/><span>{t('sheetOpenInChats')}</span></Link>}</div>
    <div className="composer-area"/>
   </>}</div>
  </div>
 </dialog>;
}
