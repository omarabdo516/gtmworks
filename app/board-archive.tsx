'use client';
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import { ArchiveConfirm } from '@/app/archive-confirm';
import { toast } from '@/app/toast';
import type { ArchiveStop } from '@/lib/archive-stops';
import type { BoardAnswer, BoardCardSeen } from '@/app/card-window';
import './board-archive.css';

// Archiving and restoring Cards on the Engine's board (spec #831, #842; design-reference-card: cwArchive, cwUndo,
// cwRestore, cwConfirm, the board's archive icon, .arch-list). One Card from its window's More menu, several from select
// mode, or everything shown in Done. A Card an Agent works on, or one waiting on a person's answer, asks once in the one
// confirmation, from what the board last read; the server checks again and answers what would stop when the board had
// it wrong. The board is drawn from the answer, a toast says how many were archived with Undo, which puts them back as
// they were, and a Card left as it was is named. The archived list, in place of the columns, reads the Engine fifty
// Cards at a time, newest made first, and its search asks the server.

type Answer=BoardAnswer&{archived?:string[],restored?:string[],left?:string[],stops?:ArchiveStop[],error?:string};
async function send(method:'POST'|'PATCH',body:object):Promise<{status:number,answer:Answer|null}> {
 try {
  const response=await fetch('/api/board/archive',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {status:response.status,answer:await response.json().catch(()=>null) as Answer|null};
 } catch { return {status:0,answer:null}; }
}

/** What archiving the Cards would stop, as the board last read them: an Agent at work, or a question waiting on a person. */
function stopsOf(cards:BoardCardSeen[]):ArchiveStop[] {
 return cards.flatMap(card=>{ const kind=card.column==='progress'?'run':card.symbol?.kind==='question'?'question':null;
  return kind?[{about:card.id,kind,title:card.title,agent:card.agent?.name??null,agent_id:card.agent?.id??null}]:[]; });
}

/**
 * The board's archive and restore: `archive` and `restore` send them, `confirm` is the one confirmation while it is
 * open, `left` the line naming the Cards left as they were. `onBoard` takes the board an answer carries, `onChange` is
 * told after any change, so the archived list reads again.
 */
export function useArchive({company,cards,onBoard,onChange}:{company:string,cards:BoardCardSeen[],onBoard:(answer:BoardAnswer)=>void,onChange:()=>void}) {
 const {t,language}=useI18n();
 const [confirming,setConfirming]=useState<{ids:string[],stops:ArchiveStop[],done?:()=>void}|null>(null);
 const [left,setLeft]=useState<{restore:boolean,titles:string[]}|null>(null);
 // Every title the board has shown, so a Card that left it meanwhile is still named.
 const titles=useRef(new Map<string,string>());
 useEffect(()=>{ for(const card of cards) titles.current.set(card.id,card.title); },[cards]);
 const named=(ids:string[],restore:boolean)=>setLeft(ids.length?{restore,titles:ids.map(id=>titles.current.get(id)??'')}:null);
 async function restore(ids:string[],{undo=false}:{undo?:boolean}={}) {
  setLeft(null);
  const {status,answer}=await send('PATCH',{company,cards:ids,undo});
  if(status!==200||!answer) { toast(t('cardRestoreRefused'),{icon:'x'}); return []; }
  onBoard(answer); onChange();
  const done=answer.restored??[];
  named(answer.left??[],true);
  if(done.length) toast(done.length>1?t('cardsRestoredToast',done.length):t('cardRestoredToast'),{icon:'restore'});
  return done;
 }
 /** Archives the Cards, asking once first when something stops; `done` runs once they are archived. */
 async function archive(ids:string[],{stop=false,done}:{stop?:boolean,done?:()=>void}={}) {
  setLeft(null);
  if(!stop) {
   const stops=stopsOf(ids.flatMap(id=>cards.filter(card=>card.id===id)));
   if(stops.length) { setConfirming({ids,stops,done}); return; }
  }
  const {status,answer}=await send('POST',{company,cards:ids,stop});
  if(status===409&&answer?.stops?.length) { setConfirming({ids,stops:answer.stops,done}); return; }
  if(status!==200||!answer) { toast(t('cardArchiveFailedRetry'),{icon:'x'}); return; }
  onBoard(answer); onChange();
  const archived=answer.archived??[];
  named(answer.left??[],false);
  if(archived.length) {
   done?.();
   toast(archived.length>1?t('cardsArchivedToast',archived.length):t('cardArchivedToast'),{icon:'archive',action:{label:t('cardUndo'),run:()=>void restore(archived,{undo:true})}});
  }
 }
 const quoted=(title:string)=>language==='ar'?<>«<bdi>{title}</bdi>»</>:<>“<bdi>{title}</bdi>”</>;
 const leftLine=left&&(()=>{ const [before,after]=t(`board${left.restore?'Restore':'Archive'}Left${left.titles.length>1?'Many':'One'}`,'\u0000').split('\u0000');
  return <p role="alert" className="work-error bsel-left">{before}{left.titles.map((title,n)=><Fragment key={n}>{n>0&&t('boardNamesJoin')}{quoted(title)}</Fragment>)}{after}</p>; })();
 const confirm=confirming&&<ArchiveConfirm stops={confirming.stops} heading={confirming.ids.length>1?t('archiveConfirmMany',confirming.ids.length):t('archiveConfirmOne')}
  confirm={()=>{ const {ids,done}=confirming; setConfirming(null); void archive(ids,{stop:true,done}); }} cancel={()=>setConfirming(null)}/>;
 return {archive,restore,confirm,left:leftLine,clearLeft:()=>setLeft(null)};
}

/**
 * The Card window's More menu (design-reference-card: #cw-more, popHTML 'more'), for a Member who may write: "Archive
 * the card", or "Restore the card" once it is archived. Enter or a press opens it with the keyboard on its item, Escape
 * closes it back to its button without closing the Card, and the keyboard is back on the button after a choice.
 */
export function CardMore({archived,archive,restore}:{archived:boolean,archive:()=>void,restore:()=>void}) {
 const {t}=useI18n(); const menuId=useId();
 const [open,setOpen]=useState(false);
 const button=useRef<HTMLButtonElement>(null); const menu=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!open) return;
  menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  const outside=(event:PointerEvent)=>{ if(!menu.current?.contains(event.target as Node)&&!button.current?.contains(event.target as Node)) setOpen(false); };
  document.addEventListener('pointerdown',outside);
  return ()=>document.removeEventListener('pointerdown',outside);
 },[open]);
 const choose=(run:()=>void)=>{ setOpen(false); button.current?.focus(); run(); };
 const keys=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); }
  else if(event.key==='Tab') setOpen(false);
 };
 return <div className="cw-menu cw-more">
  <button ref={button} type="button" className="circle-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open?menuId:undefined} aria-label={t('cardMore')} title={t('cardMore')}
   onClick={()=>setOpen(!open)}><ShellIcon name="dots"/></button>
  {open&&<div ref={menu} className="menu cw-pop" id={menuId} role="menu" aria-label={t('cardMore')} onKeyDown={keys}>
   {archived?<button type="button" className="menu__item" role="menuitem" onClick={()=>choose(restore)}><ShellIcon name="restore"/><span className="menu__t">{t('cardRestore')}</span></button>
    :<button type="button" className="menu__item" role="menuitem" onClick={()=>choose(archive)}><ShellIcon name="archive"/><span className="menu__t">{t('cardArchive')}</span></button>}
  </div>}
 </div>;
}

/** An archived Card's callout above its details (design-reference-card: cwCalloutHTML's archived branch): it is read
 * only until it is restored, with Restore for a Member who may write. */
export function ArchivedCallout({restore}:{restore?:()=>void}) {
 const {t}=useI18n();
 return <section className="cw-call cw-call--arch" aria-label={t('cardArchived')}><div className="cw-call__head cw-call__head--c">
  <span className="cw-call__ic" aria-hidden="true"><ShellIcon name="archive"/></span><p className="cw-call__q">{t('cardArchivedReadOnly')}</p>
  {restore&&<button type="button" className="btn btn--primary btn--sm cw-call__end" onClick={restore}><ShellIcon name="restore"/><span>{t('cardRestoreShort')}</span></button>}
 </div></section>;
}

type Archived={id:string,title:string,agent:{id:string,name:string}|null,person:{id:string,name:string}|null,project:string|null,createdAt:number|null};
type Page={cards:Archived[],total:number,next:number|null};

/**
 * The archived Cards in place of the columns: fifty at a time, "Show more" for the next fifty, the search asking the
 * server for every archived title. Each row opens the Card over the board; a Member who may write restores it. `version`
 * reads the list again from its start; `total` tells the board how many there are.
 */
export function ArchivedList({company,writer,query,version,cardHref,openCard,restore,total}:{company:string,writer:boolean,query:string,version:number,
 cardHref:(id:string)=>string,openCard:(event:MouseEvent<HTMLAnchorElement>,id:string)=>void,restore:(ids:string[])=>void,total:(count:number)=>void}) {
 const {t,locale}=useI18n();
 const [page,setPage]=useState<(Page&{query:string})|null>(null); const [state,setState]=useState<'reading'|'read'|'failed'>('reading');
 const said=useRef(total); useEffect(()=>{ said.current=total; });
 async function read(from:number,keep:Archived[]) {
  setState('reading');
  const answer=await fetch(`/api/board/archive?company=${encodeURIComponent(company)}&from=${from}&q=${encodeURIComponent(query)}`,{cache:'no-store'})
   .then(async response=>response.ok?await response.json() as Page:null,()=>null);
  return answer?{...answer,cards:[...keep,...answer.cards]}:null;
 }
 useEffect(()=>{
  let live=true;
  const timer=setTimeout(()=>void read(0,[]).then(found=>{ if(!live) return; if(found) { setPage({...found,query}); said.current(found.total); setState('read'); } else setState('failed'); }),query?250:0);
  return ()=>{ live=false; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `read` is this render's; the list reads again on these
 },[company,query,version]);
 const more=async()=>{ if(!page?.next) return; const found=await read(page.next,page.cards); if(found) { setPage({...found,query}); setState('read'); } else setState('failed'); };
 const made=(epoch:number|null)=>epoch==null?'':new Date(epoch*1000).toLocaleDateString(locale,{day:'numeric',month:'short'});
 const face=(card:Archived):ReactNode=>card.agent?<span aria-hidden="true"><AgentFace agent={card.agent.id} size={24}/></span>
  :card.person?<span className="me__av" style={{'--av':'24px'} as CSSProperties} aria-hidden="true">{Array.from(card.person.name.trim())[0]||'?'}</span>:<span className="arch-none" aria-hidden="true"/>;
 const cards=page?.cards??[];
 return <div className="arch">
  {cards.length?<ul className="panel-card arch-list" aria-label={t('boardArchivedCards')}>{cards.map(card=><li key={card.id} className="arch-row">
   <a className="arch-open" href={cardHref(card.id)} onClick={event=>openCard(event,card.id)}>{face(card)}
    <span className="od-field"><span className="arch-t authored-title" dir="auto">{card.title}</span>
     <span className="arch-d">{[card.agent?.name||card.person?.name||t('boardCardNoOne'),card.project].filter(Boolean).map((part,n)=><Fragment key={n}><bdi>{part}</bdi> · </Fragment>)}<span className="num">{t('boardArchivedMade',made(card.createdAt))}</span></span></span></a>
   {writer&&<button type="button" className="ib" aria-label={t('boardRestoreCard',card.title)} title={t('cardRestoreShort')} onClick={()=>restore([card.id])}><ShellIcon name="restore"/></button>}
  </li>)}</ul>
  :state==='failed'?<p className="col-empty arch-empty" role="alert"><b>{t('boardArchivedFailed')}</b></p>
  :page?<div className="col-empty arch-empty"><b>{t(page.query?'boardArchivedNoMatch':'boardArchivedEmpty')}</b></div>:<p role="status" className="board-status">{t('boardReading')}</p>}
  {cards.length>0&&state==='failed'&&<p className="board-status" role="alert">{t('boardArchivedFailed')}</p>}
  {page?.next!=null&&<button type="button" className="btn btn--secondary btn--sm arch-more" aria-busy={state==='reading'||undefined} disabled={state==='reading'} onClick={()=>void more()}>{t('boardArchivedMore')}</button>}
 </div>;
}
