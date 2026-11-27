'use client';
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';

// The board's filters (spec #831, #837; design-reference-card: renderBoard's #bf-who and #bf-proj, popHTML 'bf-who' and
// 'bf-proj', bfMatch): by Assignee (everyone, the reader, no one, an Agent or a Member) and by Project, the Engine's
// tenant, a name. Each is an icon button that shows its value once one is chosen and opens a menu of radio items; Escape
// closes the menu back to its button, arrow keys move and wrap. The choices are made from the Cards the reader sees, so
// no Agent hidden from them and no Project only hidden Cards hold is offered. A filter lives in this page only.
export type FilterCard={agent:{id:string,name:string}|null,person?:{id:string,name:string}|null,project?:string|null};
export type BoardFilter={who:string,project:string};
export const everything:BoardFilter={who:'all',project:'all'};

/** Whether a Card is shown under the filter (design-reference-card: bfMatch). */
export function shown(card:FilterCard,{who,project}:BoardFilter,me:string):boolean {
 const assignee=card.agent?`agent:${card.agent.id}`:card.person?`member:${card.person.id}`:'';
 if(who==='me'&&assignee!==`member:${me}`) return false;
 if(who==='none'&&assignee) return false;
 if(who!=='all'&&who!=='me'&&who!=='none'&&assignee!==who) return false;
 if(project==='none'&&card.project) return false;
 if(project!=='all'&&project!=='none'&&card.project!==project) return false;
 return true;
}

const Initial=({name,size}:{name:string,size:number})=><span className="me__av lg-av" style={{'--av':`${size}px`} as CSSProperties} aria-hidden="true">{Array.from(name.trim())[0]||'?'}</span>;
const NoOne=({size}:{size:number})=><span className="cw-noone" style={{'--av':`${size}px`} as CSSProperties} aria-hidden="true"/>;
type Item={value:string,label:ReactNode,lead?:ReactNode}|{heading:string}|'sep';
const moves:Record<string,(index:number,count:number)=>number>={ArrowDown:(i,n)=>(i+1)%n,ArrowUp:(i,n)=>(i-1+n)%n,Home:()=>0,End:(_,n)=>n-1};

function FilterMenu({id,label,value,shownValue,icon,items,onChoose}:{id:string,label:string,value:string,shownValue:ReactNode|null,icon:ReactNode,items:Item[],onChoose:(value:string)=>void}) {
 const menuId=useId(); const [open,setOpen]=useState(false);
 const button=useRef<HTMLButtonElement>(null); const menu=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!open) return;
  (menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')??menu.current?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus();
  const outside=(event:PointerEvent)=>{ if(!menu.current?.contains(event.target as Node)&&!button.current?.contains(event.target as Node)) setOpen(false); };
  document.addEventListener('pointerdown',outside);
  return ()=>document.removeEventListener('pointerdown',outside);
 },[open]);
 const choose=(next:string)=>{ setOpen(false); button.current?.focus(); onChoose(next); };
 const keys=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); return; }
  if(event.key==='Tab') { setOpen(false); return; }
  const move=moves[event.key]; if(!move) return;
  event.preventDefault();
  const list=[...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  list[move(list.indexOf(event.target as HTMLElement),list.length)]?.focus();
 };
 const chosen=value!=='all';
 return <span className="bf-pick">
  <button ref={button} type="button" id={id} className={`ib${chosen?' is-val':''}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open?menuId:undefined}
   aria-label={chosen&&shownValue?undefined:label} title={label} onClick={()=>setOpen(!open)}>
   {icon}{chosen&&shownValue&&<><span className="sr-only">{label}: </span><bdi className="ib__v od-truncate">{shownValue}</bdi></>}</button>
  {open&&<div ref={menu} className="menu bf-menu" id={menuId} role="menu" aria-label={label} onKeyDown={keys}>
   {items.map((item,index)=>item==='sep'?<div key={`sep-${index}`} className="menu__sep" role="separator"/>
    :'heading' in item?<div key={`h-${index}`} className="menu__label" role="presentation">{item.heading}</div>
    :<button key={item.value} type="button" className="menu__item" role="menuitemradio" aria-checked={item.value===value} onClick={()=>choose(item.value)}>
      {item.lead}<span className="menu__t">{item.label}</span>{item.value===value&&<ShellIcon name="check"/>}</button>)}
  </div>}
 </span>;
}

export function BoardFilters({cards,filter,onFilter}:{cards:FilterCard[],filter:BoardFilter,onFilter:(next:BoardFilter)=>void}) {
 const {t}=useI18n();
 const byName=(a:{name:string},b:{name:string})=>a.name.localeCompare(b.name);
 const agents=[...new Map(cards.flatMap(card=>card.agent?[[card.agent.id,card.agent] as const]:[])).values()].sort(byName);
 const people=[...new Map(cards.flatMap(card=>card.person?[[card.person.id,card.person] as const]:[])).values()].sort(byName);
 const projects=[...new Set(cards.flatMap(card=>card.project?[card.project]:[]))].sort((a,b)=>a.localeCompare(b));
 const who=filter.who;
 const whoName=who==='me'?t('boardFilterMe'):who==='none'?t('boardFilterNoOne'):who.startsWith('agent:')?agents.find(agent=>`agent:${agent.id}`===who)?.name??'':people.find(person=>`member:${person.id}`===who)?.name??'';
 const whoFace=who.startsWith('agent:')?<AgentFace agent={who.slice(6)} size={20}/>:who==='none'?<NoOne size={20}/>:who!=='all'?<Initial name={who==='me'?'':whoName} size={20}/>:<ShellIcon name="user"/>;
 const whoItems:Item[]=[{value:'all',label:t('boardFilterEveryone')},{value:'me',label:t('boardFilterMe')},{value:'none',label:t('boardFilterNoOne'),lead:<NoOne size={22}/>},
  ...agents.length?['sep' as const,{heading:t('ncAgents')},...agents.map(agent=>({value:`agent:${agent.id}`,label:<bdi>{agent.name}</bdi>,lead:<AgentFace agent={agent.id} size={22}/>}))]:[],
  ...people.length?[{heading:t('ncPeople')},...people.map(person=>({value:`member:${person.id}`,label:<bdi>{person.name}</bdi>,lead:<Initial name={person.name} size={22}/>}))]:[]];
 const projectItems:Item[]=[{value:'all',label:t('allProjects')},...projects.map(name=>({value:`name:${name}`,label:<bdi dir="auto">{name}</bdi>,lead:<ShellIcon name="folder"/>})),{value:'none',label:t('noProject')}];
 const projectValue=filter.project==='all'||filter.project==='none'?filter.project:`name:${filter.project}`;
 const filtered=filter.who!=='all'||filter.project!=='all';
 return <Fragment>
  <FilterMenu id="bf-who" label={t('ncAssignee')} value={who} shownValue={whoName||null} icon={whoFace} items={whoItems} onChoose={value=>onFilter({...filter,who:value})}/>
  <FilterMenu id="bf-proj" label={t('project')} value={projectValue} shownValue={filter.project==='none'?t('noProject'):filter.project==='all'?null:filter.project} icon={<ShellIcon name="folder"/>}
   items={projectItems} onChoose={value=>onFilter({...filter,project:value.startsWith('name:')?value.slice(5):value})}/>
  {filtered&&<button type="button" className="ib" aria-label={t('boardClearFilters')} title={t('boardClearFilters')} onClick={()=>onFilter(everything)}><ShellIcon name="x"/></button>}
 </Fragment>;
}
