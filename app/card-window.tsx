'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon, type ShellIconName } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import { leave } from '@/lib/motion';
import { columnLabel, type CardColumn, type CardSymbol } from '@/lib/board-columns.mjs';
import type { CompanyCard } from '@/lib/company-card.mjs';
import { CardDescription } from './card-description';
import { useCardChanges } from './board-live';
import { DateRow, DescriptionEdit, StatusMenu, TitleEdit, WaitsFor } from './card-window-edit';
import en from '@/lib/messages/card-window.en.json';
import ar from '@/lib/messages/card-window.ar.json';
import './log.css';
import './card-window.css';

// The Card window (spec #831, #835; design-reference-card: openCard, renderCardWin, cwHeadHTML, cwSideHTML,
// cwTabsHTML, cwRunsHTML, cwListHTML): one modal window over the board, two columns, full screen in one column on a
// phone. It draws at once from what the board already holds of the Card (its title, column, symbol and Agent), and the
// rest arrives in a read of its own from the Engine (ADR 0030): the description with its to-do items, the summary of a
// done Card above the tabs, the details (Assignee, Project, the Cards it waits for and those waiting for it, who made
// it), and the Comments, Activity and Runs tabs. The last good read stays while the window reads again, and when the
// Engine does not answer, which the window says in one line; it lives in this browser's memory only.
//
// A Viewer reads the Read only line where a Member who may write will find the comment field (#838). For a Member who
// may write, the status, the title, the description with its to-do items, the publishing date and the Cards it waits for
// are controls (#837, app/card-window-edit.tsx); a Card's Project is named when it is made, as the Engine takes no other,
// so here it is read only. Closing lets it leave first; then the board's own address comes back and the keyboard is on
// the Card.

type Read={card:CompanyCard|null,state:'reading'|'read'|'failed'|'missing'};
export type BoardCardSeen={id:string,title:string,column:CardColumn,symbol:CardSymbol|null,agent:{id:string,name:string}|null,person?:{id:string,name:string}|null};
// A write's answer that carries the board as it now reads (app/api/board/cards/route.ts, #836).
export type BoardAnswer={cards?:BoardCardSeen[],main?:{id:string,name:string}|null};
type Choices={me:string,agents:{id:string,name:string}[],people:{id:string,name:string}[]};
type Tab='comments'|'activity'|'runs';

const kept=new Map<string,CompanyCard>();
// A read that failed is asked again after a pause, longer each time; a good one again when the board's live stream says
// this Card changed on the Engine or the stream opened again (#840), when the window comes back to the page, and on the
// board's slow timer. A change reported while a read is on its way reads again once that read has answered.
const againAfter=[3000,10000,30000];
const slowRead=30000;

function useCard(company:string,id:string):Read&{reread:()=>void} {
 const key=`${company}:${id}`;
 // Each read is kept with the Card it is of: another Card opened in the same window starts from its own last read.
 const [read,setRead]=useState<Read&{key:string}>(()=>({key,card:kept.get(key)??null,state:'reading'}));
 const again=useRef(()=>{});
 useCardChanges(company,id,()=>again.current());
 useEffect(()=>{
  let stopped=false; let timer:ReturnType<typeof setTimeout>|undefined; let tries=0; let asking=false; let stale=false;
  const controller=new AbortController();
  const next=(after:number)=>{ clearTimeout(timer); timer=setTimeout(ask,after); };
  function ask() {
   if(stopped) return;
   if(asking) { stale=true; return; }
   asking=true; stale=false;
   void fetch(`/api/board/card?company=${encodeURIComponent(company)}&card=${encodeURIComponent(id)}`,{cache:'no-store',signal:controller.signal})
    .then(async response=>({status:response.status,body:await response.json().catch(()=>null) as {card?:CompanyCard}|null}),()=>({status:0,body:null}))
    .then(({status,body})=>{
     asking=false;
     if(stopped) return;
     if(status===200&&body?.card) { kept.set(key,body.card); tries=0; setRead({key,card:body.card,state:'read'}); if(stale) ask(); else next(slowRead); return; }
     if(status===404) { kept.delete(key); setRead({key,card:null,state:'missing'}); return; }
     setRead({key,card:kept.get(key)??null,state:'failed'});
     next(againAfter[Math.min(tries++,againAfter.length-1)]);
    });
  }
  const back=()=>{ if(document.visibilityState==='visible') ask(); };
  again.current=ask;
  ask();
  window.addEventListener('focus',ask); document.addEventListener('visibilitychange',back);
  return ()=>{ again.current=()=>{}; stopped=true; clearTimeout(timer); controller.abort(); window.removeEventListener('focus',ask); document.removeEventListener('visibilitychange',back); };
 },[company,id,key]);
 const reread=()=>again.current();
 return read.key===key?{...read,reread}:{card:kept.get(key)??null,state:'reading',reread};
}

const symbols:{[kind in CardSymbol['kind']]:{icon?:ShellIconName,tone:'ok'|'wait'|'bad'|'mute'}}={
 working:{tone:'ok'},question:{icon:'ask',tone:'wait'},review:{icon:'needsReview',tone:'wait'},failed:{icon:'alert',tone:'bad'},waits:{icon:'hourglass',tone:'mute'},
};
const symbolKey={working:'symWorking',question:'symQuestion',review:'symReview',failed:'symFailed',waits:'symWaits'} as const;
const runKey={running:'runRunning',done:'runDone',question:'runQuestion',review:'runReview',sentBack:'runSentBack',failed:'runFailed',stopped:'runStopped',moved:'runMoved'} as const;
const eventKey:Record<string,string>={created:'evCreated',claimed:'evClaimed',completed:'evCompleted',blocked:'evBlocked',unblocked:'evUnblocked',commented:'evCommented',
 review_requested:'evReviewRequested',changes_requested:'evChangesRequested',review_reopened:'evReviewReopened',archived:'evArchived',reclaimed:'evReclaimed',crashed:'evCrashed',
 timed_out:'evTimedOut',gave_up:'evGaveUp',promoted:'evPromoted',promoted_manual:'evPromoted',edited:'evEdited',reprioritized:'evReprioritized',linked:'evLinked',unlinked:'evUnlinked',
 attached:'evAttached',attachment_removed:'evAttachmentRemoved',scheduled:'evScheduled',decomposed:'evDecomposed',status:'evStatus'};
// The window's leave (card-window.css, gw-modal-out).
const leaveMs=190;

// A person's face where the reference draws one: their first letter.
const Letter=({name,size}:{name:string,size:number})=><span className="me__av" style={{'--av':`${size}px`} as CSSProperties} aria-hidden="true">{Array.from(name.trim())[0]||'?'}</span>;
const NoOne=({size}:{size:number})=><span className="cw-noone" style={{'--av':`${size}px`} as CSSProperties} aria-hidden="true"/>;

const moves:Record<string,(index:number,count:number)=>number>={ArrowDown:(i,n)=>(i+1)%n,ArrowUp:(i,n)=>(i-1+n)%n,Home:()=>0,End:(_,n)=>n-1};
// The Assignee of a Card, for a Member who may write (#836's route; design-reference-card: cwSideHTML's assignee row,
// openCwPop 'asg', cwAssign): the row is a button that opens the menu, "Assign to me" first, then the Agents the reader
// sees and the Members, then nobody. Arrow keys move and wrap, Escape closes it back to the button without closing the
// Card. The choice shows at once and is given on the Engine and in the row (PATCH /api/board/cards); a refusal puts the
// Card's Assignee back and says why. A Card has at most one Assignee: an Agent given it clears the Member, and the reverse.
function AssigneeMenu({company,card,agent,person,c,onAssigned}:{company:string,card:string,agent:{id:string,name:string}|null,person:{id:string,name:string}|null,
 c:(key:string,...values:unknown[])=>string,onAssigned:(answer:BoardAnswer)=>void}) {
 const {t}=useI18n(); const menuId=useId();
 const [open,setOpen]=useState(false); const [choices,setChoices]=useState<Choices|null>(null);
 const [chosen,setChosen]=useState<{card:string,value:string}|null>(null); const [said,setSaid]=useState('');
 const button=useRef<HTMLButtonElement>(null); const menu=useRef<HTMLDivElement>(null);
 const current=agent?`agent:${agent.id}`:person?`member:${person.id}`:'';
 // A choice shows at once, until the Card's own read says the same.
 if(chosen&&(chosen.card!==card||chosen.value===current)) setChosen(null);
 const value=chosen?.card===card?chosen.value:current;
 useEffect(()=>{
  if(!open||choices) return;
  let live=true;
  void fetch(`/api/board/cards?company=${encodeURIComponent(company)}`,{cache:'no-store'})
   .then(async response=>response.ok?await response.json() as Choices:null,()=>null).then(found=>{ if(live&&found) setChoices(found); });
  return ()=>{ live=false; };
 },[open,choices,company]);
 useEffect(()=>{
  if(!open) return;
  (menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')??menu.current?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus();
  const outside=(event:PointerEvent)=>{ if(!menu.current?.contains(event.target as Node)&&!button.current?.contains(event.target as Node)) setOpen(false); };
  document.addEventListener('pointerdown',outside);
  return ()=>document.removeEventListener('pointerdown',outside);
 },[open,choices]);
 const agentOf=(id:string)=>choices?.agents.find(one=>one.id===id)??(agent?.id===id?agent:undefined);
 const personOf=(id:string)=>choices?.people.find(one=>one.id===id)??(person?.id===id?person:undefined);
 const nameOf=(v:string)=>v.startsWith('agent:')?agentOf(v.slice(6))?.name??'':v.startsWith('member:')?personOf(v.slice(7))?.name??'':'';
 const faceOf=(v:string,size:number)=>v.startsWith('agent:')?<AgentFace agent={v.slice(6)} size={size}/>:v.startsWith('member:')?<Letter name={nameOf(v)} size={size}/>:<NoOne size={size}/>;
 const shown=nameOf(value)||c('cwNoOne');
 async function choose(next:string) {
  setOpen(false); button.current?.focus();
  if(next===value) return;
  setChosen({card,value:next}); setSaid('');
  let answer:Response|null=null;
  try { answer=await fetch('/api/board/cards',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,card,assignee:next})}); } catch { answer=null; }
  const body=await answer?.json().catch(()=>null) as (BoardAnswer&{error?:string})|null;
  if(answer?.ok) { if(body) onAssigned(body); return; }
  setChosen(null);
  setSaid(body?.error==='cardBusy'?c('cwAssignBusy'):body?.error==='cardAssigneeInvalid'?t('ncAssigneeGone'):c('cwAssignFailed'));
 }
 const keys=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); return; }
  if(event.key==='Tab') { setOpen(false); return; }
  const move=moves[event.key]; if(!move) return;
  event.preventDefault();
  const list=[...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  list[move(list.indexOf(event.target as HTMLElement),list.length)]?.focus();
 };
 const item=(v:string,label:ReactNode,lead:ReactNode,checkable=true)=><button key={checkable?v||'none':'me'} type="button" className="menu__item" role="menuitemradio"
  aria-checked={checkable&&value===v} onClick={()=>void choose(v)}>{lead}<span className="menu__t">{label}</span>{checkable&&value===v&&<ShellIcon name="check"/>}</button>;
 return <>
  <div className="cwp cw-menu">
   <button ref={button} type="button" className={`cwp__b${value?'':' is-empty'}`} id="cw-asg" aria-haspopup="menu" aria-expanded={open} aria-controls={open?menuId:undefined}
    aria-label={t('boardCardAssignee',shown)} title={c('cwAssignee')} onClick={()=>setOpen(!open)}>
    <span className="cwp__ic">{faceOf(value,20)}</span><bdi className="od-truncate">{shown}</bdi></button>
   {open&&<div ref={menu} className="menu cw-pop" id={menuId} role="menu" aria-label={c('cwAssignee')} onKeyDown={keys}>
    {choices&&item(`member:${choices.me}`,t('assignToMe'),<ShellIcon name="hand"/>,false)}
    {!!choices?.agents.length&&<div className="menu__label" role="presentation">{t('ncAgents')}</div>}
    {choices?.agents.map(one=>item(`agent:${one.id}`,<bdi>{one.name}</bdi>,<AgentFace agent={one.id} size={20}/>))}
    {!!choices?.people.length&&<div className="menu__label" role="presentation">{t('ncPeople')}</div>}
    {choices?.people.map(one=>item(`member:${one.id}`,<><bdi>{one.name}</bdi>{one.id===choices.me&&<> <span className="menu__d">{t('ncYou')}</span></>}</>,<Letter name={one.name} size={20}/>))}
    {choices&&<div className="menu__sep" role="separator"/>}
    {item('',c('cwNoOne'),<NoOne size={20}/>)}
   </div>}
  </div>
  {said&&<p className="cw-said is-bad" role="alert">{said}</p>}
 </>;
}

export function CardWindow({company,id,seen,writer,board=[],cardHref,showCard,onBoard,onClose}:{company:string,id:string,seen:BoardCardSeen|null,writer:boolean,board?:{id:string,title:string,column:string}[],cardHref:(id:string)=>string,showCard:(id:string)=>void,onBoard:(answer:BoardAnswer)=>void,onClose:()=>void}) {
 const {t,language,locale}=useI18n();
 const text:Record<string,string>=language==='ar'?ar:en;
 const c=(key:string,...values:unknown[])=>(text[key]??key).replace(/\{(\d+)\}/g,(_,index)=>String(values[Number(index)]??''));
 const ui=language==='ar'?'rtl':'ltr';
 const read=useCard(company,id); const card=read.card;
 const box=useRef<HTMLDialogElement>(null); const stopLeaving=useRef(()=>{});
 const [leaving,setLeaving]=useState(false);
 // Another Card opened from this one (a Card it waits for) starts on its own Comments, with the keyboard on its title.
 const [shown,setShown]=useState<{id:string,tab:Tab}>({id,tab:'comments'}); const tab=shown.id===id?shown.tab:'comments';
 const setTab=(next:Tab)=>setShown({id,tab:next});
 useLayoutEffect(()=>{
  if(!box.current?.open) box.current?.showModal();
  const frame=requestAnimationFrame(()=>document.getElementById('cw-title')?.focus({preventScroll:true}));
  return ()=>{ cancelAnimationFrame(frame); stopLeaving.current(); };
 },[]);
 useEffect(()=>{ document.getElementById('cw-title')?.focus({preventScroll:true}); },[id]);
 const close=()=>{ const dialog=box.current; if(!dialog?.open||leaving) return; stopLeaving.current=leave(leaveMs,()=>setLeaving(true),()=>dialog.close()); };
 const closed=()=>{ stopLeaving.current(); setLeaving(false); onClose(); };
 // What the window draws before its own read: the board's Card; after it, the Engine's.
 const title=card?.title??seen?.title??'';
 const column=card?card.column:seen?.column??null;
 const symbol=card?card.symbol:seen?.symbol??null;
 const agent=card?card.agent:seen?.agent??null;
 const person=card?card.person:seen?.person??null;
 const waiting=column==='waiting';
 // A change saved from here (#837): the board takes its answer and the Card is read again.
 const editable=writer&&!!card&&!card.archived;
 const saved=(answer:{cards?:unknown[],main?:{id:string,name:string}|null})=>{ onBoard(answer as BoardAnswer); read.reread(); };
 const columnName=column?t(columnLabel(column,writer)):'';
 const symbolName=(kind:CardSymbol)=>kind.kind==='waits'&&kind.count>1?t('symWaitsN',kind.count):t(symbolKey[kind.kind]);
 const sym=(kind:CardSymbol)=>{ const look=symbols[kind.kind]; const name=symbolName(kind);
  return <span className={`sym sym--${look.tone}`} data-sym={kind.kind} role="img" aria-label={name} title={name}>{look.icon?<ShellIcon name={look.icon}/>:<span className="sym__dot"/>}</span>; };
 const at=(epoch:number|null,more:Intl.DateTimeFormatOptions={hour:'numeric',minute:'2-digit'})=>epoch==null?'':new Date(epoch*1000).toLocaleString(locale,{day:'numeric',month:'short',...more});
 const day=(epoch:number|null)=>epoch==null?'':new Date(epoch*1000).toLocaleDateString(locale,{weekday:'long',day:'numeric',month:'long'});
 const time=(epoch:number|null)=>epoch==null?'':new Date(epoch*1000).toLocaleTimeString(locale,{hour:'numeric',minute:'2-digit'});
 // ---- the details ----
 const icon=(name:ShellIconName,label:string)=><span className="cwp__ic" title={label} aria-hidden="true"><ShellIcon name={name}/></span>;
 const row=(lead:ReactNode,label:string,value:ReactNode)=><div className="cwp"><span className="cwp__s"><span className="cwp__ic" title={label} aria-hidden="true">{lead}</span><span className="sr-only">{label}:</span>{value}</span></div>;
 const chipOpen=(other:CompanyCard['waitsFor'][number])=>other.id==null||other.title==null
  ?<span className="cw-chip__open is-hidden"><ShellIcon name="lock"/><span>{c('cwHiddenCard')}</span></span>
  :<a className="cw-chip__open" href={cardHref(other.id)} onClick={event=>{ if(event.metaKey||event.ctrlKey||event.shiftKey||event.button!==0) return; event.preventDefault(); showCard(other.id!); }}
    aria-label={`${other.title} · ${other.column?t(columnLabel(other.column,writer)):''}`} title={other.column?t(columnLabel(other.column,writer)):undefined}>
   {other.done?<ShellIcon name="check"/>:<span className="dot" aria-hidden="true"/>}<bdi className="od-truncate" dir="auto">{other.title}</bdi></a>;
 const chip=(other:CompanyCard['waitsFor'][number],index:number)=><li key={other.id??`hidden-${index}`} className="cw-chip">{chipOpen(other)}</li>;
 // The Cards this one may wait for (design-reference-card: popHTML 'waits'): the board's other Cards not done, not already
 // waited for and not waiting for it; the Engine refuses any longer loop itself.
 const waitChoices=card?board.filter(other=>other.id!==card.id&&other.column!=='done'&&!card.waitsFor.some(link=>link.id===other.id)&&!card.waitedBy.some(link=>link.id===other.id)):[];
 const side=<aside className="cw-side" aria-label={c('cwDetails')}><div className="cwp-list">
  {writer&&card&&!card.archived?<AssigneeMenu company={company} card={card.id} agent={agent} person={person} c={c} onAssigned={answer=>{ onBoard(answer); read.reread(); }}/>
   :row(agent?<AgentFace agent={agent.id} size={20}/>:person?<Letter name={person.name} size={20}/>:<NoOne size={20}/>,c('cwAssignee'),<bdi className="od-truncate">{agent?.name||person?.name||c('cwNoOne')}</bdi>)}
  {editable&&card&&<DateRow company={company} card={card.id} publishOn={card.publishOn} c={c} label={t('publishingDate')} onSaved={saved}/>}
  {!editable&&card?.publishOn&&row(<ShellIcon name="calendar"/>,t('publishingDate'),<span className="num">{new Date(`${card.publishOn}T12:00:00Z`).toLocaleDateString(locale,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'})}</span>)}
  {card?.project&&row(<ShellIcon name="folder"/>,c('cwProject'),<bdi className="od-truncate" dir="auto">{card.project}</bdi>)}
  {editable&&card&&<WaitsFor company={company} card={card.id} chips={card.waitsFor.map(other=>({id:other.id,title:other.title,node:chipOpen(other)}))} choices={waitChoices} c={c} onSaved={saved}/>}
  {!editable&&card&&card.waitsFor.length>0&&<div className="cwp cwp--chips">{icon('hourglass',c('cwWaitsFor'))}<span className="sr-only">{c('cwWaitsFor')}:</span><ul className="cw-chips">{card.waitsFor.map(chip)}</ul></div>}
  {card&&card.waitedBy.length>0&&<div className="cwp cwp--chips">{icon('link',c('cwWaitedBy'))}<span className="sr-only">{c('cwWaitedBy')}:</span><ul className="cw-chips">{card.waitedBy.map(chip)}</ul></div>}
  {card&&<div className="cwp cwp--made"><span className="cwp__s"><span className="cwp__ic" title={c('cwMadeBy')} aria-hidden="true">{card.madeBy?'agent' in card.madeBy?<AgentFace agent={card.madeBy.agent.id} size={20}/>:<Letter name={card.madeBy.person.name} size={20}/>:null}</span>
   <span className="od-truncate"><span className="sr-only">{c('cwMadeBy')}: </span>{card.madeBy?<bdi>{'agent' in card.madeBy?card.madeBy.agent.name:card.madeBy.person.name}</bdi>:'—'}{card.createdAt!=null&&<> · <span className="num">{at(card.createdAt,{})}</span></>}</span></span>
   <span className="cwp__ic cwp__src" role="img" aria-label={c('cwFromBoard')} title={c('cwFromBoard')}><ShellIcon name="board"/></span></div>}
 </div></aside>;
 // ---- Comments, Activity, Runs ----
 const tabs:[Tab,ShellIconName,string,number|null][]=[['comments','chat',c('cwComments'),card?card.comments.length:null],['activity','history',c('cwActivity'),card?card.activity.length:null],['runs','play',c('cwRuns'),card?card.runs.length:null]];
 const order=tabs.map(([key])=>key);
 const pick=(next:Tab)=>{ setTab(next); requestAnimationFrame(()=>document.getElementById(`cw-tab-${next}`)?.focus()); };
 const tabKeys=(event:KeyboardEvent)=>{ const now=order.indexOf(tab); const step:Record<string,number>={ArrowRight:ui==='rtl'?-1:1,ArrowLeft:ui==='rtl'?1:-1};
  if(event.key==='Home') { event.preventDefault(); pick(order[0]); } else if(event.key==='End') { event.preventDefault(); pick(order[order.length-1]); }
  else if(step[event.key]) { event.preventDefault(); pick(order[(now+step[event.key]+order.length)%order.length]); } };
 const empty=(key:string)=><div className="panel-card"><p className="panel-empty">{c(key)}</p></div>;
 // Grouped by day, oldest first: under a Card the log reads like a conversation (design-reference-card: logGroupsHTML).
 const byDay=<T extends {id:number,at:number|null}>(list:T[],draw:(item:T)=>ReactNode)=>{
  const days=new Map<string,T[]>();
  for(const item of list) { const name=day(item.at); days.set(name,[...days.get(name)??[],item]); }
  return <div className="lg-wrap">{[...days].map(([name,items])=><section key={name} className="lg-day" aria-label={name}><h3 className="lg-day__h">{name}</h3><ol className="lg-list">{items.map(draw)}</ol></section>)}</div>;
 };
 const comments=(list:CompanyCard['comments'])=>list.length?byDay(list,comment=>{
  const who='person' in comment.author?comment.author.person:comment.author.agent?.name??c('cwAnAgent');
  const face='person' in comment.author?<Letter name={comment.author.person} size={28}/>:comment.author.agent?<AgentFace agent={comment.author.agent.id} size={28}/>:<NoOne size={28}/>;
  return <li key={comment.id} className="lg-row lg-row--note">{face}<div className="lg-body"><p className="lg-line"><b className="lg-name"><bdi>{who}</bdi></b> <span className="lg-act">{c('cwCommented')}</span></p>
   <p className="lg-note" dir="auto">{comment.body}</p><p className="lg-meta"><span className="lg-time num">{time(comment.at)}</span></p></div></li>;
 }):empty('cwNoComments');
 const activity=(list:CompanyCard['activity'])=>list.length?byDay(list,event=>{
  const actor=event.agent?.name??event.by??null;
  const phrase=event.kind==='assigned'?event.to?c('evAssigned',event.to.agent?.name??c('cwAnAgent')):c('evUnassigned'):c(eventKey[event.kind]??'evStatus');
  return <li key={event.id} className="lg-row lg-row--quiet" data-event={event.kind}>{event.agent?<AgentFace agent={event.agent.id} size={20}/>:event.by?<Letter name={event.by} size={20}/>:<NoOne size={20}/>}
   <div className="lg-body"><p className="lg-line">{phrase}</p><p className="lg-meta">{actor&&<><bdi>{actor}</bdi><span aria-hidden="true">·</span></>}<span className="lg-time num">{time(event.at)}</span></p></div></li>;
 }):empty('cwNoActivity');
 const runs=(list:CompanyCard['runs'])=>list.length?<ol className="cw-runs">{[...list].reverse().map(run=><li key={run.id} className="cw-run">{run.agent?<AgentFace agent={run.agent.id} size={28}/>:<NoOne size={28}/>}<div className="od-field">
   <span className="cw-run__t"><span className="num">#{run.n}</span> · <bdi>{run.agent?.name??c('cwAnAgent')}</bdi> · <span className={`cw-run__o${run.state==='failed'?' is-fail':run.state==='running'?' is-run':''}`}>{run.state==='running'&&<span className="dot dot--working" aria-hidden="true"/>}{c(runKey[run.state])}</span></span>
   <span className="cw-run__d num">{at(run.startedAt)}{run.endedAt!=null&&<> {ui==='rtl'?'←':'→'} {at(run.endedAt)}</>}</span>{run.summary&&<span className="cw-run__n" dir="auto">{run.summary}</span>}</div></li>)}</ol>:empty('cwNoRuns');
 // A tab the Engine has not answered for yet says so; one it answered before keeps that read and says it is not fresh.
 const panel=!card?<p className="cw-said" role={read.state==='failed'?'alert':'status'}>{read.state==='failed'?c('cwReadFailed'):read.state==='missing'?'':c('cwReading')}</p>
  :tab==='comments'?comments(card.comments):tab==='activity'?activity(card.activity):runs(card.runs);
 return <dialog ref={box} className={`cw${leaving?' is-closing':''}`} aria-labelledby="cw-title" data-card={id} onCancel={event=>{ if(event.cancelable) { event.preventDefault(); close(); } }} onClose={closed} onClick={event=>{ if(event.target===event.currentTarget) close(); }}>
  <div className="cw__inner">
   <header className="cw-head"><div className="cw-head__row">
    {column&&editable&&card?<StatusMenu company={company} card={card.id} column={column} lead={symbol&&sym(symbol)} writer={writer} onBoard={saved}/>
     :column&&<span className={`cw-status is-static${waiting?' is-wait':''}`}>{symbol&&sym(symbol)}<span>{columnName}</span></span>}
    {!writer&&<span className="sym sym--mute" role="img" aria-label={c('cwReadOnly')} title={c('cwReadOnly')}><ShellIcon name="eye"/></span>}
    <span className="od-fill"/>
    <button type="button" className="circle-btn" aria-label={c('cwClose')} title={c('cwCloseTip')} onClick={close}><ShellIcon name="x"/></button>
   </div></header>
   <div className="cw-body">
    <div className="cw-top">
     {editable&&card?<TitleEdit key={card.id} company={company} card={card.id} title={card.title} c={c} onSaved={saved}/>:<h2 className="cw-title" id="cw-title" tabIndex={-1} dir="auto">{title}</h2>}
     {read.state==='missing'&&<p className="cw-said is-bad" role="alert">{c('cwMissing')}</p>}
     {card&&read.state==='failed'&&<p className="cw-said" role="status">{c('cwRefreshFailed')}</p>}
     {editable&&card&&<DescriptionEdit key={card.id} company={company} card={card.id} body={card.description} ui={ui} c={c} onSaved={saved}/>}
     {!editable&&card&&card.description.trim()&&<section className="cw-sec cw-desc-sec" aria-labelledby="cw-h-desc"><h3 className="sr-only" id="cw-h-desc">{c('cwDescription')}</h3><CardDescription body={card.description} ui={ui} c={c}/></section>}
     {card?.summary&&<section className="cw-sec" aria-labelledby="cw-h-res"><h3 className="sr-only" id="cw-h-res">{c('cwResult')}</h3><div className="cw-result"><p className="cw-sum" dir="auto">{card.summary}</p></div></section>}
    </div>
    {read.state!=='missing'&&side}
    {read.state!=='missing'&&<section className="cw-feed" aria-label={c('cwFeed')}>
     <div className="segmented cw-tabs" role="tablist" aria-label={c('cwTabs')} onKeyDown={tabKeys}>
      {tabs.map(([key,name,label,count])=><button key={key} type="button" role="tab" id={`cw-tab-${key}`} className="cw-tab" aria-selected={tab===key} aria-controls="cw-list" tabIndex={tab===key?0:-1}
        aria-label={count==null?label:`${label} ${count}`} title={tab===key?undefined:label} onClick={()=>pick(key)}>
       <ShellIcon name={name}/>{tab===key&&<span>{label}</span>}{count!=null&&<span className="num cw-tabs__n">{count}</span>}</button>)}
     </div>
     <div className="cw-list" id="cw-list" role="tabpanel" aria-labelledby={`cw-tab-${tab}`} tabIndex={-1}>{panel}</div>
     <div className="cw-comp">{!writer&&<p className="ro-line"><ShellIcon name="eye"/><span>{c('cwReadOnly')}</span></p>}</div>
    </section>}
   </div>
  </div>
 </dialog>;
}
