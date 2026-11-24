'use client';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import './archive-confirm.css';

// One thing archiving would stop (card_archive_stops, #671): the Agent working on a Card, or what the Card waits on.
export type ArchiveStop={card:number,title:string,kind:'run'|'question'|'permission'|'hand'|'approval',agent:string|null,agent_id:string|null};
const sentences:Record<ArchiveStop['kind'],string>={run:'archiveStopRun',question:'archiveStopQuestion',permission:'archiveStopPermission',hand:'archiveStopHand',approval:'archiveStopApproval'};

// "Archive the card?" (#671; design-reference-card: cwConfirm, #cw-confirm, .cf-list, .cf-row): shown only when
// something stops, it names each thing, one line each, with the face of the Agent it is about, and asks once for all the
// Cards being archived (#672 archives a selection through it). Cancel, Escape or a press outside archives nothing;
// "Archive and stop" archives them all. The dialog is the reference's native one, over the Card's sheet when that is
// open, and the keyboard goes back where it was when it closes.
export function ArchiveConfirm({stops,cards,face,confirm,cancel}:{stops:ArchiveStop[],cards:number,face:(agent:string|null)=>ReactNode,confirm:()=>void,cancel:()=>void}) {
 const {t,language}=useI18n();
 const box=useRef<HTMLDialogElement>(null); const chosen=useRef(false); const pressed=useRef(false);
 useLayoutEffect(()=>{ const dialog=box.current; if(dialog&&!dialog.open) dialog.showModal(); },[]);
 const close=(go:boolean)=>{ chosen.current=go; box.current?.close(); };
 const quoted=(title:string)=>language==='ar'?<>«<bdi>{title}</bdi>»</>:<>“<bdi>{title}</bdi>”</>;
 const line=(stop:ArchiveStop)=>{ const [before,after]=t(sentences[stop.kind],stop.agent||t('archiveStopAnAgent'),'{1}').split('{1}');
  return <>{before}{quoted(stop.title)}{after}</>; };
 return <dialog ref={box} className="gw modal modal--sm cf-dlg" aria-labelledby="cf-title"
  onMouseDown={event=>{ pressed.current=event.target===event.currentTarget; }}
  onMouseUp={event=>{ const onSurface=pressed.current&&event.target===event.currentTarget; pressed.current=false; if(onSurface) close(false); }}
  onClose={()=>chosen.current?confirm():cancel()}>
  <div className="modal__inner">
   <header className="modal__head"><div className="modal__titles"><h2 className="modal__title" id="cf-title">{cards>1?t('archiveConfirmMany',cards):t('archiveConfirmOne')}</h2></div></header>
   <div className="modal__body"><ul className="cf-list">{stops.map((stop,index)=><li key={`${stop.card}:${stop.kind}:${stop.agent_id??index}`} className="cf-row">
    <span className="cf-face" aria-hidden="true">{stop.kind==='approval'?<span className="cf-mark"><ShellIcon name="review"/></span>:face(stop.agent_id)??<span className="cf-mark"><ShellIcon name="spark"/></span>}</span>
    <span className="cf-t">{line(stop)}</span></li>)}</ul></div>
   <footer className="modal__foot modal__foot--end">
    <button type="button" className="btn btn--secondary" onClick={()=>close(false)}>{t('cancel')}</button>
    <button type="button" className="btn btn--primary" autoFocus onClick={()=>close(true)}>{t('archiveAndStop')}</button></footer>
  </div>
 </dialog>;
}
