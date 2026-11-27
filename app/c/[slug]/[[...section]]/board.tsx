'use client';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { BoardIcon } from '@/components/board-icon';
import { ShellIcon, type ShellIconName } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import { BoardPager } from '@/components/paperclip/KanbanBoard';
import { cardColumns, columnLabel, type CardColumn, type CardSymbol } from '@/lib/board-columns.mjs';
import { CardWindow } from '@/app/card-window';
import { followBoard } from '@/app/board-live';
import '@/app/board.css';
import type { MadeBoard } from './new-card';

// New card (#836), loaded only when it is opened, so the board's first load stays small.
const NewCard=lazy(()=>import('./new-card'));

// The board (spec #831, #834): the Company's Engine's own Kanban board in gtmworks's look (design-reference-card:
// renderBoard, kcardHTML), five columns and no Live (ADR 0033). The frame and the column heads are drawn at once, from
// nothing the Engine keeps; the Cards are read by the browser after, in a request of their own (ADR 0030).
//
// The last good read stays: it is shown while the board reads again and kept when the Engine does not answer, which the
// board says in one line. It lives in this browser's memory only, never in storage, and never in a table.
//
// The board follows the Engine live (#840): a change the Engine reports, through gtmworks's own web server
// (app/board-live.ts), reads the board again at once. While the stream is down the board reads again on a slow timer.

export type BoardCard={id:string,title:string,column:CardColumn,symbol:CardSymbol|null,agent:{id:string,name:string}|null,person?:{id:string,name:string}|null,comments:number};
type Agent={id:string,name:string};
type Board={cards:BoardCard[],main:Agent|null};
type Read={board:Board|null,state:'reading'|'read'|'failed'};

const kept=new Map<string,Board>();
// A read that failed is asked again after a pause, longer each time; a good one is read again when the board's live
// stream reports a change, when the window comes back to the board, and on a slow timer while the stream is down. A
// change reported while a read is on its way reads again once that read has answered.
const againAfter=[3000,10000,30000];
const slowRead=30000;

// `accept` takes the board a write answered with (#836): it is a read like any other.
function useBoard(company:string):Read&{accept:(board:Board)=>void} {
 const [read,setRead]=useState<Read>(()=>({board:kept.get(company)??null,state:'reading'}));
 const accept=useCallback((board:Board)=>{ kept.set(company,board); setRead({board,state:'read'}); },[company]);
 useEffect(()=>{
  let stopped=false; let timer:ReturnType<typeof setTimeout>|undefined; let tries=0; let asking=false; let stale=false; let live=false;
  const controller=new AbortController();
  const next=(after:number)=>{ clearTimeout(timer); timer=setTimeout(ask,after); };
  function ask() {
   if(stopped) return;
   if(asking) { stale=true; return; }
   asking=true; stale=false;
   void fetch(`/api/board?company=${encodeURIComponent(company)}`,{cache:'no-store',signal:controller.signal})
    // The answer is read whole either way, so a refused read leaves no response open behind it.
    .then(async response=>{ const body=await response.json().catch(()=>null) as {cards?:unknown,main?:Agent|null}|null; return response.ok?body:null; },()=>null)
    .then(body=>{
     asking=false;
     if(stopped) return;
     if(body&&Array.isArray(body.cards)) {
      const board={cards:body.cards as BoardCard[],main:body.main??null}; kept.set(company,board); tries=0; setRead({board,state:'read'});
      if(stale) ask(); else if(live) clearTimeout(timer); else next(slowRead);
      return;
     }
     setRead({board:kept.get(company)??null,state:'failed'});
     next(againAfter[Math.min(tries++,againAfter.length-1)]);
    });
  }
  const back=()=>{ if(document.visibilityState==='visible') ask(); };
  ask();
  const unfollow=followBoard(company,{changed:()=>ask(),live:on=>{ live=on; if(!on&&!asking&&!tries) next(slowRead); }});
  window.addEventListener('focus',ask); document.addEventListener('visibilitychange',back);
  return ()=>{ stopped=true; clearTimeout(timer); controller.abort(); unfollow(); window.removeEventListener('focus',ask); document.removeEventListener('visibilitychange',back); };
 },[company]);
 return {...read,accept};
}

// One shape, one colour and one name for each state (design-reference-card: SYMS); the name is the tooltip and what
// assistive technology reads.
const symbols:{[kind in CardSymbol['kind']]:{icon?:ShellIconName,tone:'ok'|'wait'|'bad'|'mute'}}={
 working:{tone:'ok'},question:{icon:'ask',tone:'wait'},review:{icon:'needsReview',tone:'wait'},failed:{icon:'alert',tone:'bad'},stopped:{icon:'stop',tone:'mute'},waits:{icon:'hourglass',tone:'mute'},
};
const symbolKey={working:'symWorking',question:'symQuestion',review:'symReview',failed:'symFailed',stopped:'symStopped',waits:'symWaits'} as const;
const emptyKey:Record<CardColumn,[string,string]>={waiting:['boardEmptyWaiting','boardEmptyWaitingHint'],ideas:['boardEmptyIdeas','boardEmptyIdeasHint'],planned:['boardEmptyPlanned','boardEmptyPlannedHint'],progress:['boardEmptyProgress','boardEmptyProgressHint'],done:['boardEmptyDone','']};

export default function Board({company,slug,writer,creating=false}:{company:string,slug:string,writer:boolean,creating?:boolean}) {
 const {t}=useI18n();
 const read=useBoard(company);
 // New card is open (#836): at /work/new it opens with the page, and closing it leaves the board at its own address.
 const [making,setMaking]=useState(creating&&writer); const opener=useRef<HTMLButtonElement>(null); const [made,setMade]=useState<string|null>(null);
 const cards=read.board?.cards??null; const main=read.board?.main??null;
 const base=`/c/${slug}/work`;
 // A Card opens over the board at its own address (#835), which reloads, survives sign-in and is a link to share; opening
 // and closing it only change the address, so the board stays as it was read. A history entry it adds carries no state of
 // its own: Next.js's router takes one with its own state for its own navigation and would not follow the address.
 const opened=useSearchParams().get('card'); const open=opened&&/^[A-Za-z0-9_-]{1,64}$/.test(opened)?opened:null;
 const cardHref=(id:string)=>`${base}/board?card=${encodeURIComponent(id)}`;
 // Each Card opened from here is one step of the browser's history, so Back closes it; closing goes back over every step
 // the window took (a Card it waits for, opened from it), to the board as it was. A Card a link opened on load has no
 // step to go back over: closing it puts the board's own address in its place.
 const steps=useRef(0);
 useEffect(()=>{ const moved=()=>{ steps.current=new URLSearchParams(location.search).has('card')?Math.max(0,steps.current-1):0; };
  window.addEventListener('popstate',moved); return ()=>window.removeEventListener('popstate',moved); },[]);
 const showCard=(id:string)=>{ history.pushState(null,'',cardHref(id)); steps.current+=1; };
 const openCard=(event:MouseEvent<HTMLAnchorElement>,id:string)=>{ if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0) return; event.preventDefault(); showCard(id); };
 const closeCard=()=>{ const id=open;
  if(steps.current>0) { history.go(-steps.current); steps.current=0; } else history.replaceState(null,'',`${base}/board`);
  if(id) requestAnimationFrame(()=>document.querySelector<HTMLElement>(`#board-cols .kcard[data-card="${CSS.escape(id)}"] a`)?.focus()); };
 const columnName=(column:string)=>t(columnLabel(column,writer));
 const symbolName=(symbol:CardSymbol)=>symbol.kind==='waits'&&symbol.count>1?t('symWaitsN',symbol.count):t(symbolKey[symbol.kind]);
 const cardView=(card:BoardCard)=>{
  const who=card.agent?.name||card.person?.name||t('boardCardNoOne');
  const comments=card.comments===1?t('boardCardComment'):t('boardCardComments',card.comments);
  const label=[card.title,columnName(card.column),card.symbol?symbolName(card.symbol):'',t('boardCardAssignee',who),card.comments?comments:''].filter(Boolean).join(' · ');
  const symbol=card.symbol&&symbols[card.symbol.kind];
  return <article key={card.id} className={`kcard card${made===card.id?' is-flash':''}`} data-card={card.id} aria-label={label}>
   <span className="kt-head"><a className="kcard__title authored-title" dir="auto" href={cardHref(card.id)} onClick={event=>openCard(event,card.id)}><strong>{card.title}</strong></a>
    {card.symbol&&symbol&&<span className="kt-syms"><span className={`sym sym--${symbol.tone}`} data-sym={card.symbol.kind} role="img" aria-label={symbolName(card.symbol)} title={symbolName(card.symbol)}>
     {symbol.icon?<ShellIcon name={symbol.icon}/>:<span className="sym__dot"/>}{card.symbol.kind==='waits'&&card.symbol.count>1&&<span className="sym__n num" aria-hidden="true">{card.symbol.count}</span>}</span></span>}</span>
   <span className="kcard__foot">
    <span className="kt-face" title={who}>{card.agent?<AgentFace agent={card.agent.id} size={20}/>:card.person?<span className="me__av lg-av" style={{'--av':'20px'} as CSSProperties} aria-hidden="true">{Array.from(card.person.name.trim())[0]||'?'}</span>:<span className="cw-noone" style={{'--av':'20px'} as CSSProperties} aria-hidden="true"/>}</span>
    {card.comments>0&&<span className="kt-metas"><span className="kt-m" title={comments}><ShellIcon name="chat"/><span className="num">{card.comments}</span></span></span>}
   </span>
  </article>;
 };
 const views=<nav className="tabs segmented" aria-label={t('boardViews')}>{[['board',t('board')],['calendar',t('calendar')],['list',t('list')]].map(([path,name])=>
  <Link key={path} data-slot="button" data-active={path==='board'} aria-current={path==='board'?'page':undefined} className={`button ${path==='board'?'active':''}`} href={`${base}/${path}`}>{name}</Link>)}</nav>;
 return <div className="work-root"><div className="board-view">
  <header className="page-head"><div className="od-field"><h1 className="page-title">{t('marketingBoard')}</h1><p className="page-sub">{t('boardSubtitle')}</p></div><div className="work-toolbar" data-canonical-toolbar="work">{views}</div></header>
  <div className="board-tools">
   {!writer&&<span className="board-tools__summary" role="note"><BoardIcon name="eye"/>{t('boardReadOnly')}</span>}
   <BoardPager/>
   {writer&&<button ref={opener} type="button" className="btn btn--primary btn--sm bt-new" aria-haspopup="dialog" onClick={()=>setMaking(true)}><ShellIcon name="plus"/><span className="bt-new__t">{t('newCard')}</span></button>}
  </div>
  {read.state==='reading'&&!cards&&<p role="status" className="board-status">{t('boardReading')}</p>}
  {read.state==='failed'&&(cards?<p role="status" className="board-status">{t('boardRefreshFailed')}</p>:<p role="alert" className="work-error">{t('boardReadFailed')}</p>)}
  {cards&&!cards.length&&main&&<div className="board-bare" role="note"><span aria-hidden="true"><AgentFace agent={main.id} size={32}/></span><p>{t('boardEmpty',main.name)}</p>{writer&&<Link className="btn btn--secondary btn--sm" href={`/c/${slug}/chat`}><BoardIcon name="chat"/><span>{t('boardTalkTo',main.name)}</span></Link>}</div>}
  <div className="board board-cols" id="board-cols" aria-label={t('workBoard')} aria-busy={read.state==='reading'}>
   {cardColumns.map(column=>{
    const list=cards?.filter(card=>card.column===column)??[];
    const waiting=column==='waiting';
    return <section key={column} className={`col${waiting?' col--waiting':''}`} data-column={column} aria-labelledby={`col-${column}`}>
     <div className="col__head">{waiting&&<span className="dot dot--waiting" aria-hidden="true"/>}<h2 className="col__name" id={`col-${column}`}>{columnName(column)}</h2><span className="col__count num">{cards?list.length:''}</span></div>
     <div className="col__body">{list.map(cardView)}{cards&&!list.length&&<div className="col-empty"><b>{t(emptyKey[column][0])}</b>{emptyKey[column][1]&&<span>{t(emptyKey[column][1])}</span>}</div>}</div>
    </section>;
   })}
  </div>
  {open&&<CardWindow key={company} company={company} id={open} seen={cards?.find(card=>card.id===open)??null} writer={writer} cardHref={cardHref} showCard={showCard} onBoard={answer=>{ if(answer.cards) read.accept({cards:answer.cards as BoardCard[],main:answer.main??null}); }} onClose={closeCard}/>}
 {making&&<Suspense fallback={null}><NewCard company={company} onMade={(answer:MadeBoard)=>{ if(answer.cards) read.accept({cards:answer.cards,main:answer.main??null}); setMade(answer.made); }}
  onClose={()=>{ setMaking(false); if(creating&&window.location.pathname.endsWith('/work/new')) window.history.replaceState(window.history.state,'',`${base}/board`); opener.current?.focus(); }}/></Suspense>}
 </div></div>;
}
