'use client';
import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { AuthoredTitle } from '@/lib/authored-title';
import { AgentFace } from '@/components/agent-face';
import { TaskList, TaskListRow } from '@/components/paperclip/TaskList';
import { cardColumns, columnLabel } from '@/lib/board-columns.mjs';
import { calendarMonth, filterCards, sortCards, viewChoices } from '@/lib/board-views.mjs';
import { workDate } from '@/lib/work-date.mjs';
import { useBoard, type Board, type BoardCard } from '@/app/board-read';
import '@/app/board.css';

// The list and the calendar (spec #831, #845): the same Cards as the board, read from the same answer (/api/board,
// useBoard) and never from a table of gtmworks's own. The list sorts and filters what the board read returned, by
// Assignee, status (the board's column) and Project (the Engine's `tenant`); the calendar places a Card on its
// publishing date, and lists every Card with none beside it. An archived Card is on no board, so in neither view.
//
// Both draw their frame (the head, the filters, the empty table or the month's grid) before the board answers, and keep
// its last good read, shared with the board in this browser's memory, while it reads again and when it does not answer.
// A Contributor and above change a Card's publishing date in place through the board's own route; the answer is the
// board as it now reads, so the Card moves with no reload of the frame.

type View='list'|'calendar';
type SortKey=''|'title'|'column'|'assignee'|'project'|'publishOn';
const thisMonth=()=>new Date().toISOString().slice(0,7);
const monthName=(month:string,locale:string)=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-1,1)).toLocaleDateString(locale,{month:'long',year:'numeric',timeZone:'UTC'});
const daysIn=(month:string)=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
const firstWeekday=(month:string)=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-1,1)).getUTCDay();
const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

/** A Card's publishing date, changed in place: sent when the field is left or Enter is pressed, put back with Escape. */
function DateField({card,label,save}:{card:BoardCard,label:string,save:(card:BoardCard,day:string)=>Promise<void>}) {
 const [draft,setDraft]=useState<string|null>(null); const sending=useRef<string|null>(null);
 const commit=()=>{
  if(draft===null||sending.current===draft) return;
  if(draft===(card.publishOn??'')) { setDraft(null); return; }
  sending.current=draft;
  void save(card,draft).finally(()=>{ sending.current=null; setDraft(null); });
 };
 return <input type="date" className="view-date" aria-label={label} value={draft??card.publishOn??''} onChange={e=>setDraft(e.target.value)} onBlur={commit}
  onKeyDown={e=>{ if(e.key==='Enter') { e.preventDefault(); commit(); } else if(e.key==='Escape'&&draft!==null) { e.preventDefault(); setDraft(null); } }}/>;
}

export default function BoardViews({company,slug,view,writer}:{company:string,slug:string,view:View,writer:boolean}) {
 const {t,language,locale}=useI18n();
 const read=useBoard(company);
 const hydrated=useSyncExternalStore(()=>()=>{},()=>true,()=>false);
 const [assignee,setAssignee]=useState(''); const [column,setColumn]=useState(''); const [project,setProject]=useState(''); const [listMonth,setListMonth]=useState('');
 const [month,setMonth]=useState(thisMonth);
 const [sort,setSort]=useState<{key:SortKey,direction:'ascending'|'descending'}>({key:'',direction:'ascending'});
 const [dateFailed,setDateFailed]=useState(false);
 const cards=read.board?.cards??null;
 const base=`/c/${slug}/work`;
 const cardHref=(card:BoardCard)=>`${base}/board?card=${encodeURIComponent(card.id)}`;
 const columnName=(name:string)=>t(columnLabel(name,writer));
 const save=async(card:BoardCard,day:string)=>{
  setDateFailed(false);
  const response=await fetch('/api/board/cards',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({company,card:card.id,publishOn:day})}).catch(()=>null);
  const body=await response?.json().catch(()=>null) as {cards?:unknown,main?:Board['main']}|null;
  if(response?.ok&&body&&Array.isArray(body.cards)) read.accept({cards:body.cards as BoardCard[],main:body.main??null});
  else setDateFailed(true);
 };
 const dateOf=(card:BoardCard)=>writer?<DateField card={card} label={t('viewDateOf',card.title)} save={save}/>:card.publishOn?<span className="num">{workDate(card.publishOn,language,{month:'short',year:'numeric'})}</span>:null;
 const who=(card:BoardCard)=>card.agent?<><span aria-hidden="true"><AgentFace agent={card.agent.id} size={20}/></span> <bdi>{card.agent.name}</bdi></>
  :card.person?<><span className="avatar" aria-hidden="true">{Array.from(card.person.name.trim())[0]||'?'}</span> <bdi>{card.person.name}</bdi></>:<span className="muted">{t('boardCardNoOne')}</span>;
 const choices=viewChoices(cards??[]);
 const select=(label:string,value:string,change:(value:string)=>void,options:ReactNode)=><label>{label}{' '}
  <select data-toolbar-control aria-label={label} disabled={!hydrated} value={value} onChange={e=>change(e.target.value)}>{options}</select></label>;
 const months=[...new Set((cards??[]).flatMap(card=>card.publishOn?[card.publishOn.slice(0,7)]:[]))].concat(listMonth?[listMonth]:[]);

 const views=<div className="work-toolbar" data-canonical-toolbar="work"><nav className="tabs segmented" aria-label={t('boardViews')}>{(['board','calendar','list'] as const).map(path=>
  <Link key={path} data-slot="button" data-active={path===view} aria-current={path===view?'page':undefined} className={`button ${path===view?'active':''}`} href={`${base}/${path}`}>{t(path)}</Link>)}</nav>
  {writer&&<Link className="btn btn--primary btn--sm" data-slot="button" data-toolbar-primary href={`${base}/new`}>{t('newCardAction')}</Link>}</div>;
 const status=<>
  {read.state==='reading'&&!cards&&<p role="status" className="board-status">{t('boardReading')}</p>}
  {read.state==='failed'&&(cards?<p role="status" className="board-status">{t('boardRefreshFailed')}</p>:<p role="alert" className="work-error">{t('boardReadFailed')}</p>)}
  {dateFailed&&<p role="alert" className="work-error">{t('viewDateFailed')}</p>}
 </>;

 const sortable:[SortKey,string][]=[['title',t('title')],['column',t('viewStatus')],['assignee',t('ncAssignee')],['project',t('project')],['publishOn',t('publishingDate')]];
 const shown=sortCards(filterCards(cards??[],{assignee,column,project,month:listMonth}),sort);
 const list=<>
  <div className="work-filters" data-canonical-toolbar="work-filters">
   {select(t('month'),listMonth,setListMonth,<><option value="">{t('allMonths')}</option>{[...new Set(months)].sort().reverse().map(value=><option key={value} value={value}>{monthName(value,locale)}</option>)}</>)}
   {select(t('ncAssignee'),assignee,setAssignee,<><option value="">{t('boardAll')}</option>{choices.assignees.map(choice=><option dir="auto" key={choice.key} value={choice.key}>{choice.name}</option>)}<option value="none">{t('boardCardNoOne')}</option></>)}
   {select(t('viewStatus'),column,setColumn,<><option value="">{t('boardAll')}</option>{cardColumns.map(name=><option key={name} value={name}>{columnName(name)}</option>)}</>)}
   {select(t('project'),project,setProject,<><option value="">{t('allProjects')}</option>{choices.projects.map(name=><option dir="auto" key={name} value={name}>{name}</option>)}</>)}
  </div>
  {status}
  <TaskList emptyMessage={cards&&!shown.length?t('noCardsToDisplay'):undefined}>
   <thead><tr>{sortable.map(([key,label])=><th key={key} aria-sort={sort.key===key?sort.direction:undefined}>
    <button type="button" onClick={()=>setSort(now=>now.key===key?{key,direction:now.direction==='ascending'?'descending':'ascending'}:{key,direction:'ascending'})}>{label} ↕</button></th>)}</tr></thead>
   <tbody aria-busy={read.state==='reading'}>{shown.map(card=><TaskListRow key={card.id}>
    <td><AuthoredTitle href={cardHref(card)}>{card.title}</AuthoredTitle></td>
    <td>{columnName(card.column)}</td>
    <td>{who(card)}</td>
    <td dir="auto">{card.project}</td>
    <td>{dateOf(card)}</td>
   </TaskListRow>)}</tbody>
  </TaskList>
 </>;

 const {days,undated}=calendarMonth(cards??[],month);
 const dated=[...days].sort(([a],[b])=>a-b).flatMap(([,found])=>found);
 // Beside the grid, where the grid already links a dated Card, its row names it and holds its date.
 const sideRow=(card:BoardCard)=><li key={card.id} className="view-side__row">{card.publishOn?<AuthoredTitle as="span">{card.title}</AuthoredTitle>:<AuthoredTitle href={cardHref(card)}>{card.title}</AuthoredTitle>}{dateOf(card)}</li>;
 const calendar=<>
  <div className="work-filters" data-canonical-toolbar="work-filters"><label>{t('month')}{' '}<input data-toolbar-control type="month" disabled={!hydrated} value={month} onChange={e=>setMonth(e.target.value||thisMonth())}/></label></div>
  {status}
  <div className="view-calendar">
   <div className="panel calendar-wrap" aria-busy={read.state==='reading'}>
    <h2 className="calendar-title">{monthName(month,locale)}</h2>
    {cards&&!days.size&&<p className="empty-column">{t('noCardsThisMonth')}</p>}
    <div className="calendar">
     {weekdays.map(day=><div className="day calendar-heading" key={day}>{t(day)}</div>)}
     {Array.from({length:firstWeekday(month)},(_,at)=><div className="day" key={`empty-${at}`}/>)}
     {Array.from({length:daysIn(month)},(_,at)=><div className="day" key={at}><span className="day__n num">{at+1}</span>
      {(days.get(at+1)??[]).map(card=><AuthoredTitle key={card.id} href={cardHref(card)}>{card.title}</AuthoredTitle>)}</div>)}
    </div>
   </div>
   <aside className="view-side">
    {writer&&dated.length>0&&<section className="panel view-side__part" aria-labelledby="view-month"><h2 id="view-month" className="view-side__h">{t('viewThisMonth')}</h2><ul>{dated.map(sideRow)}</ul></section>}
    <section className="panel view-side__part" aria-labelledby="view-undated"><h2 id="view-undated" className="view-side__h">{t('viewUndated')}</h2>
     {undated.length?<ul>{undated.map(sideRow)}</ul>:cards&&<p className="muted">{t('viewUndatedNone')}</p>}</section>
   </aside>
  </div>
 </>;

 return <div className="work-root"><div className="board-view board-view--page">
  <header className="page-head"><div className="od-field"><h1 className="page-title">{t('marketingBoard')}</h1><p className="page-sub">{t('boardSubtitle')}</p></div>{views}</header>
  <div className="board-body">{view==='list'?list:calendar}</div>
 </div></div>;
}
