'use client';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import type { ArchiveStop, ArchiveStopKind } from '@/lib/archive-stops';
import './archive-confirm.css';

// The sentence of each line for a Card or a Conversation: {0} the Agent, {1} the Card's or the Conversation's title.
const itemSentences:Record<ArchiveStopKind,string>={run:'archiveStopRun',question:'archiveStopQuestion',permission:'archiveStopPermission',hand:'archiveStopHand',approval:'archiveStopApproval'};

// The one confirmation of archiving Cards (#671, #672), Conversations (#674) and a team channel (#675)
// (design-reference-card: cwConfirm, #cw-confirm, .cf-list, .cf-row): shown only when something stops, under its
// `heading`, it names each thing, one line each, with the face of the Agent it is about, and asks once for everything
// being archived. Each line's words are `sentence`'s, {0} the Agent ("An Agent" when hidden) and {1} what it is about,
// quoted; a Card's or a Conversation's lines read "… on “title”", a channel passes its own. Cancel has the keyboard
// first, as in the reference; Cancel, Escape or a press outside archives nothing, and "Archive and stop" archives. The
// dialog is the reference's native one, over the Card's sheet when that is open, and the keyboard goes back where it was
// when it closes.
export function ArchiveConfirm({stops,heading,sentence,face,confirm,cancel}:{stops:ArchiveStop[],heading:string,sentence?:(stop:ArchiveStop,agent:string)=>string,face:(agent:string|null)=>ReactNode,confirm:()=>void,cancel:()=>void}) {
 const {t,language}=useI18n();
 const box=useRef<HTMLDialogElement>(null); const chosen=useRef(false); const pressed=useRef(false);
 useLayoutEffect(()=>{ const dialog=box.current; if(dialog&&!dialog.open) dialog.showModal(); },[]);
 const close=(go:boolean)=>{ chosen.current=go; box.current?.close(); };
 const quoted=(title:string)=>language==='ar'?<>«<bdi>{title}</bdi>»</>:<>“<bdi>{title}</bdi>”</>;
 const words=sentence??((stop:ArchiveStop,agent:string)=>t(itemSentences[stop.kind],agent,'{1}'));
 const line=(stop:ArchiveStop)=>{ const [before,after]=words(stop,stop.agent||t('archiveStopAnAgent')).split('{1}');
  return after===undefined?<>{before}</>:<>{before}{quoted(stop.title)}{after}</>; };
 return <dialog ref={box} className="gw modal modal--sm cf-dlg" aria-labelledby="cf-title"
  onMouseDown={event=>{ pressed.current=event.target===event.currentTarget; }}
  onMouseUp={event=>{ const onSurface=pressed.current&&event.target===event.currentTarget; pressed.current=false; if(onSurface) close(false); }}
  onClose={()=>chosen.current?confirm():cancel()}>
  <div className="modal__inner">
   <header className="modal__head"><div className="modal__titles"><h2 className="modal__title" id="cf-title">{heading}</h2></div></header>
   <div className="modal__body"><ul className="cf-list">{stops.map((stop,index)=><li key={`${stop.about}:${stop.kind}:${stop.agent_id??''}:${index}`} className="cf-row">
    <span className="cf-face" aria-hidden="true">{stop.kind==='approval'?<span className="cf-mark"><ShellIcon name="review"/></span>:face(stop.agent_id)??<span className="cf-mark"><ShellIcon name="spark"/></span>}</span>
    <span className="cf-t">{line(stop)}</span></li>)}</ul></div>
   <footer className="modal__foot modal__foot--end">
    <button type="button" className="btn btn--secondary" autoFocus onClick={()=>close(false)}>{t('cancel')}</button>
    <button type="button" className="btn btn--primary" onClick={()=>close(true)}>{t('archiveAndStop')}</button></footer>
  </div>
 </dialog>;
}
