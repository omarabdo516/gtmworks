'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { BoardIcon } from '@/components/board-icon';
import { ShellIcon, type ShellIconName } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import { BoardPager } from '@/components/paperclip/KanbanBoard';
import { cardColumns, columnLabel, type CardColumn, type CardSymbol } from '@/lib/board-columns.mjs';
import '@/app/board.css';

// The board (spec #831, #834): the Company's Engine's own Kanban board in gtmworks's look (design-reference-card:
// renderBoard, kcardHTML), five columns and no Live (ADR 0033). The frame and the column heads are drawn at once, from
// nothing the Engine keeps; the Cards are read by the browser after, in a request of their own (ADR 0030).
//
// The last good read stays: it is shown while the board reads again and kept when the Engine does not answer, which the
// board says in one line. It lives in this browser's memory only, never in storage, and never in a table.

export type BoardCard={id:string,title:string,column:CardColumn,symbol:CardSymbol|null,agent:{id:string,name:string}|null,comments:number};
type Read={cards:BoardCard[]|null,state:'reading'|'read'|'failed'};

const kept=new Map<string,BoardCard[]>();
// A read that failed is asked again after a pause, longer each time; a good one is read again on a slow timer and when
// the window comes back to the board, until the live stream of #840 carries every change.
const againAfter=[3000,10000,30000];
const slowRead=30000;

function useBoard(company:string):Read {
 const [read,setRead]=useState<Read>(()=>({cards:kept.get(company)??null,state:'reading'}));
 useEffect(()=>{
  let stopped=false; let timer:ReturnType<typeof setTimeout>|undefined; let tries=0; let asking=false;
  const controller=new AbortController();
  const next=(after:number)=>{ clearTimeout(timer); timer=setTimeout(ask,after); };
  function ask() {
   if(asking||stopped) return;
   asking=true;
   void fetch(`/api/board?company=${encodeURIComponent(company)}`,{cache:'no-store',signal:controller.signal})
    .then(async response=>response.ok?await response.json() as {cards?:unknown}:null,()=>null)
    .then(body=>{
     asking=false;
     if(stopped) return;
     if(body&&Array.isArray(body.cards)) { const cards=body.cards as BoardCard[]; kept.set(company,cards); tries=0; setRead({cards,state:'read'}); next(slowRead); return; }
     setRead({cards:kept.get(company)??null,state:'failed'});
     next(againAfter[Math.min(tries++,againAfter.length-1)]);
    });
  }
  const back=()=>{ if(document.visibilityState==='visible') ask(); };
  ask();
  window.addEventListener('focus',ask); document.addEventListener('visibilitychange',back);
  return ()=>{ stopped=true; clearTimeout(timer); controller.abort(); window.removeEventListener('focus',ask); document.removeEventListener('visibilitychange',back); };
 },[company]);
 return read;
}

// One shape, one colour and one name for each state (design-reference-card: SYMS); the name is the tooltip and what
// assistive technology reads.
const symbols:{[kind in CardSymbol['kind']]:{icon?:ShellIconName,tone:'ok'|'wait'|'bad'|'mute'}}={
 working:{tone:'ok'},question:{icon:'ask',tone:'wait'},review:{icon:'needsReview',tone:'wait'},failed:{icon:'alert',tone:'bad'},waits:{icon:'hourglass',tone:'mute'},
};
const symbolKey={working:'symWorking',question:'symQuestion',review:'symReview',failed:'symFailed',waits:'symWaits'} as const;
const emptyKey:Record<CardColumn,[string,string]>={waiting:['boardEmptyWaiting','boardEmptyWaitingHint'],ideas:['boardEmptyIdeas','boardEmptyIdeasHint'],planned:['boardEmptyPlanned','boardEmptyPlannedHint'],progress:['boardEmptyProgress','boardEmptyProgressHint'],done:['boardEmptyDone','']};

export default function Board({company,slug,writer}:{company:string,slug:string,writer:boolean}) {
 const {t}=useI18n();
 const read=useBoard(company);
 const base=`/c/${slug}/work`;
 const columnName=(column:string)=>t(columnLabel(column,writer));
 const symbolName=(symbol:CardSymbol)=>symbol.kind==='waits'&&symbol.count>1?t('symWaitsN',symbol.count):t(symbolKey[symbol.kind]);
 const cardView=(card:BoardCard)=>{
  const who=card.agent?.name||t('boardCardNoOne');
  const comments=card.comments===1?t('boardCardComment'):t('boardCardComments',card.comments);
  const label=[card.title,columnName(card.column),card.symbol?symbolName(card.symbol):'',t('boardCardAssignee',who),card.comments?comments:''].filter(Boolean).join(' · ');
  const symbol=card.symbol&&symbols[card.symbol.kind];
  return <article key={card.id} className="kcard card" data-card={card.id} aria-label={label}>
   <span className="kt-head"><strong className="kcard__title authored-title" dir="auto">{card.title}</strong>
    {card.symbol&&symbol&&<span className="kt-syms"><span className={`sym sym--${symbol.tone}`} data-sym={card.symbol.kind} role="img" aria-label={symbolName(card.symbol)} title={symbolName(card.symbol)}>
     {symbol.icon?<ShellIcon name={symbol.icon}/>:<span className="sym__dot"/>}{card.symbol.kind==='waits'&&card.symbol.count>1&&<span className="sym__n num" aria-hidden="true">{card.symbol.count}</span>}</span></span>}</span>
   <span className="kcard__foot">
    <span className="kt-face" title={who}>{card.agent?<AgentFace agent={card.agent.id} size={20}/>:<span className="cw-noone" style={{'--av':'20px'} as CSSProperties} aria-hidden="true"/>}</span>
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
  </div>
  {read.state==='reading'&&!read.cards&&<p role="status" className="board-status">{t('boardReading')}</p>}
  {read.state==='failed'&&(read.cards?<p role="status" className="board-status">{t('boardRefreshFailed')}</p>:<p role="alert" className="work-error">{t('boardReadFailed')}</p>)}
  <div className="board board-cols" id="board-cols" aria-label={t('workBoard')} aria-busy={read.state==='reading'}>
   {cardColumns.map(column=>{
    const list=read.cards?.filter(card=>card.column===column)??[];
    const waiting=column==='waiting';
    return <section key={column} className={`col${waiting?' col--waiting':''}`} data-column={column} aria-labelledby={`col-${column}`}>
     <div className="col__head">{waiting&&<span className="dot dot--waiting" aria-hidden="true"/>}<h2 className="col__name" id={`col-${column}`}>{columnName(column)}</h2><span className="col__count num">{read.cards?list.length:''}</span></div>
     <div className="col__body">{list.map(cardView)}{read.cards&&!list.length&&<div className="col-empty"><b>{t(emptyKey[column][0])}</b>{emptyKey[column][1]&&<span>{t(emptyKey[column][1])}</span>}</div>}</div>
    </section>;
   })}
  </div>
 </div></div>;
}
