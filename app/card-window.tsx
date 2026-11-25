'use client';
import { useActionState, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/lib/link';
import { openingPage } from '@/lib/page-opening';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon, type ShellIconName } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import { OpenedHere } from './sidebar-live';
import { leave } from '@/lib/motion';
import { toast } from '@/app/toast';
import { workDate } from '@/lib/work-date.mjs';
import { boardColumns } from '@/lib/board-columns.mjs';
import { insertToken, tokenAtCaret } from '@/lib/composer-mentions.mjs';
import { MentionPop, mentionSuggestions, newId, type CallableAgent, type CallablePerson, type Suggestion } from '@/app/conversation-composer';
import { MoreMenu, type MoreMenuItem } from '@/app/more-menu';
import { CardTips } from '@/app/card-tips';
import type { SaveResult } from '@/app/c/[slug]/[[...section]]/work';
import './log.css';
import './card-window.css';

// Who made a Card and where (design-reference-card: cwSideHTML's "Made by" row): the board; a chat, a link only for its
// own person; another person's private chat, a lock with their first name and nothing that was said; a channel, a link
// for its members; a channel the reader is not in, a lock with its name.
export type CardMade={by:string,at:string}&({from:'board'}|{from:'chat',href:string}|{from:'chat-private',person:string}|{from:'channel',href:string,name:string}|{from:'channel-locked',name:string});
export type CardRun={n:number,note:number,agent:string,name:string,outcome:string|null,start:string,end:string|null};
// What the server reads for an open Card (app/card-window-server.tsx).
// One side of a wait (#682): a Card this one waits for, or one waiting for it; a Card the reader may not see has no title.
export type CardWaitLink={side:'waits_for'|'waited_by',other:number,title:string|null,status:string|null,open:boolean};
export type CardWindowData={id:number,working:boolean,comments:ReactNode,commentCount:number,activity:ReactNode,activityCount:number,runs:CardRun[],
 files:{id:number,name:string,by:string,at:string}[],creative:number|null,versions:{id:number,n:number,name:string,url:string|null,at:string}[],made:CardMade,waits:CardWaitLink[]};
// The Card as the board holds it, with its assignee as the window saves it ('a:<Agent>', 'p:<Member>' or '').
export type CardWindowCard={id:number,title:string,status:string,go_live:string|null,project_id:number|null,assignee:string,archived?:{by:string,at:string}};
export type CardSymbol='question'|'review'|'approved'|'working'|'waits'|'onyou'|'archived'|'readonly';
type Field='title'|'go_live'|'project'|'assignee';
type Tab='comments'|'activity'|'runs';
type SuggestionList={token:{type:string,q:string,start:number,end:number},items:Suggestion[],index:number};

const symbols:Record<CardSymbol,{icon:ShellIconName|null,tone:string,key:string}>={
 question:{icon:'ask',tone:'wait',key:'symQuestion'},review:{icon:'needsReview',tone:'wait',key:'symReview'},approved:{icon:'approved',tone:'ok',key:'symApproved'},waits:{icon:'hourglass',tone:'mute',key:'symWaits'},working:{icon:null,tone:'ok',key:'symWorking'},
 onyou:{icon:'hand',tone:'wait',key:'symOnyou'},archived:{icon:'archive',tone:'mute',key:'symArchived'},readonly:{icon:'eye',tone:'mute',key:'cwReadOnly'},
};
// One state as one symbol (design-reference-card: symHTML): an image named by its tooltip, or, inside a control that
// already names it, hidden from a screen reader.
export function Sym({kind,inert=false}:{kind:CardSymbol,inert?:boolean}) {
 const {t}=useI18n(); const look=symbols[kind]; const name=t(look.key);
 return <span className={`sym sym--${look.tone}`} data-sym={kind} data-tip={name} {...inert?{'aria-hidden':true}:{role:'img','aria-label':name}}>{look.icon?<ShellIcon name={look.icon}/>:<span className="sym__dot"/>}</span>;
}

const moves:Record<string,(index:number,count:number)=>number>={ArrowDown:(i,n)=>(i+1)%n,ArrowUp:(i,n)=>(i-1+n)%n,Home:()=>0,End:(_,n)=>n-1};
type MenuItem={key:string,label:ReactNode,lead?:ReactNode,checked?:boolean,disabled?:boolean,run:()=>void}|{key:string,group:string};
// A property's menu (design-reference-card: openCwPop): the button opens it with the keyboard on the first item; Arrow
// Down and Up move and wrap, Home and End go to the ends, Escape closes it back to the button without closing the Card,
// Tab closes it, a press outside closes it, and a choice closes it and gives the button the keyboard back.
function CwMenu({label,button,className,items,radio=false}:{label:string,button:ReactNode,className:string,items:MenuItem[],radio?:boolean}) {
 const [open,setOpen]=useState(false); const id=useId(); const box=useRef<HTMLDivElement>(null); const trigger=useRef<HTMLButtonElement>(null);
 const role=radio?'menuitemradio':'menuitem';
 useEffect(()=>{
  if(!open) return;
  (box.current?.querySelector<HTMLElement>(`[role="${role}"][aria-checked="true"]`)??box.current?.querySelector<HTMLElement>(`[role="${role}"]`))?.focus();
  const outside=(event:PointerEvent)=>{ if(!box.current?.contains(event.target as Node)) setOpen(false); };
  document.addEventListener('pointerdown',outside);
  return ()=>document.removeEventListener('pointerdown',outside);
 },[open,role]);
 // A menu opens below its button, or above it when the scrolling part it sits in has no room below (a property near
 // the end of the details), so no item is ever clipped out of reach.
 useLayoutEffect(()=>{ if(!open) return; const pop=box.current?.querySelector<HTMLElement>('.cw-pop'); const button=trigger.current; if(!pop||!button) return;
  let frame:HTMLElement|null=box.current!.parentElement; while(frame&&!/(auto|scroll|hidden)/.test(getComputedStyle(frame).overflowY)) frame=frame.parentElement;
  const limit=Math.min(window.innerHeight,frame?frame.getBoundingClientRect().bottom:window.innerHeight); const from=button.getBoundingClientRect();
  pop.classList.toggle('cw-pop--up',from.bottom+4+pop.offsetHeight>limit&&from.top-4-pop.offsetHeight>=Math.max(0,frame?frame.getBoundingClientRect().top:0)); },[open]);
 const close=()=>{ setOpen(false); trigger.current?.focus(); };
 const keys=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
  if(event.key==='Tab') { setOpen(false); return; }
  const move=moves[event.key]; if(!move) return;
  event.preventDefault();
  const list=[...event.currentTarget.querySelectorAll<HTMLElement>(`[role="${role}"]`)];
  list[move(list.indexOf(event.target as HTMLElement),list.length)]?.focus();
 };
 return <div ref={box} className="cw-menu">
  <button ref={trigger} type="button" className={className} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(!open)}>{button}</button>
  {open&&<div className="menu cw-pop" id={id} role="menu" aria-label={label} onKeyDown={keys}>
   {items.map(item=>'group' in item?<div key={item.key} className="menu__label" aria-hidden="true">{item.group}</div>
    :<button key={item.key} type="button" className="menu__item" role={role} aria-checked={radio?!!item.checked:undefined} aria-disabled={item.disabled||undefined}
      onClick={()=>{ if(item.disabled) return; close(); item.run(); }}>{item.lead}<span className="menu__t">{item.label}</span>{!radio&&item.checked&&<ShellIcon name="check"/>}</button>)}
  </div>}
 </div>;
}

// A person's face where the reference draws one: their first letter.
const Letter=({name,size}:{name:string,size:number})=><span className="me__av cw-av" style={{'--av':`${size}px`} as CSSProperties} aria-hidden="true">{Array.from(name.trim())[0]||'?'}</span>;

// leave in card-window.css (gw-modal-out).
const leaveMs=190;

// The Card window (#678; design-reference-card: openCard, renderCardWin, cwHeadHTML, cwSideHTML, cwTabsHTML,
// cwComposerHTML): one modal window over the board, full screen on a phone. Its head is the status (a menu of the six
// columns for a Member who may edit), More and Close; then, in the order they are seen and reached by Tab, the title,
// the callout, the description, the Result with its Versions, the properties (assignee, publishing date, Project, files,
// who made it) and the Comments, Activity and Runs with the comment field. Each property saves by itself as it changes,
// over the value the window read: a save someone else's change overtook is refused, and the newer value shows with a
// line saying so. A Viewer, and anyone on an archived Card, reads it all with no control drawn and nothing drawn for an
// empty property. Closing lets it leave first; then the board's own address comes back and the keyboard is on the tile.
// Its actions are the board's server actions, handed in so this client file never imports the server module.
export function CardWindow({slug,company,me,card,data,symbol,canWrite:mayWrite,alone,message,columnName,assignees,people=[],agents=[],projects,send,save,move,archive,callout,description,intoReview,waitChoices=[]}:{
 slug:string,company:string,me:string,card:CardWindowCard,data:CardWindowData,symbol:CardSymbol|'',canWrite:boolean,alone:boolean,message?:string,
 columnName:(column:string)=>string,assignees:{agents:{id:string,name:string}[],people:{id:string,name:string}[]},people?:CallablePerson[],agents?:CallableAgent[],
 projects:{id:number,name:string}[],waitChoices?:{id:number,title:string,status:string}[],send:(form:FormData)=>Promise<void>,save:(form:FormData)=>Promise<SaveResult>,move:(column:string)=>Promise<boolean>,
 archive?:{archive:()=>void,restore:()=>void},callout?:ReactNode,description?:ReactNode,intoReview?:()=>void}) {
 const {t,language}=useI18n(); const router=useRouter();
 const W=mayWrite&&!card.archived;
 const box=useRef<HTMLDialogElement>(null); const stopLeaving=useRef(()=>{});
 const [leaving,setLeaving]=useState(false); const [tab,setTab]=useState<Tab>('comments');
 const board=`/c/${slug}/work/board`;
 // ---- each property, as the window last saved it until the board's own read catches up ----
 const server:Record<Field,string>={title:card.title,go_live:card.go_live?card.go_live.slice(0,10):'',project:card.project_id==null?'':String(card.project_id),assignee:card.assignee};
 const [kept,setKept]=useState<Partial<Record<Field,{base:string,value:string}>>>({});
 const valueOf=(field:Field)=>{ const own=kept[field]; return own&&(server[field]===own.base||server[field]===own.value)?own.value:server[field]; };
 const [said,setSaid]=useState<{field:Field,text:string,stale:boolean}|null>(null);
 const agentName=(id:string)=>assignees.agents.find(a=>a.id===id)?.name||agents.find(a=>a.id===id)?.name||'';
 const personName=(id:string)=>assignees.people.find(p=>p.id===id)?.name||people.find(p=>p.id===id)?.name||'';
 const assigneeName=(value:string)=>value.startsWith('a:')?agentName(value.slice(2)):value.startsWith('p:')?personName(value.slice(2)):'';
 const dayLabel=(day:string)=>day?workDate(`${day}T12:00:00Z`,language,{month:'short'}):'';
 const projectName=(value:string)=>projects.find(p=>String(p.id)===value)?.name||'';
 const shown=(field:Field,value:string)=>field==='title'?value:field==='go_live'?dayLabel(value)||t('cwNone'):field==='project'?projectName(value)||t('noProject'):assigneeName(value)||t('assigneeNoOne');
 const saveField=async(field:Field,value:string)=>{
  const seen=valueOf(field); if(value===seen) return true;
  const form=new FormData(); form.set('company',company); form.set('slug',slug); form.set('card',String(card.id)); form.set('field',field); form.set('value',value); form.set('seen',seen);
  setSaid(null); setKept(now=>({...now,[field]:{base:server[field],value}}));
  let answer:SaveResult; try { answer=await save(form); } catch { answer={error:t('couldNotSaveTheChangeCheckPermissionsAnd')}; }
  if('saved' in answer) { setKept(now=>({...now,[field]:{base:server[field],value:answer.saved}})); router.refresh(); return true; }
  if('stale' in answer) { const newer=answer.stale; setKept(now=>({...now,[field]:{base:server[field],value:newer}})); setSaid({field,text:t('cwStale',shown(field,newer)),stale:true}); router.refresh(); return false; }
  setKept(now=>{ const next={...now}; delete next[field]; return next; }); setSaid({field,text:answer.error,stale:false}); return false;
 };
 const note=(field:Field)=>said?.field===field?<p className={`cw-said${said.stale?' is-stale':''}`} role="alert">{said.text}</p>:null;
 // ---- the title ----
 const [editing,setEditing]=useState<string|null>(null); const [titleError,setTitleError]=useState(false);
 const titleField=useRef<HTMLInputElement>(null);
 useEffect(()=>{ if(editing!==null) titleField.current?.focus(); },[editing!==null]); // eslint-disable-line react-hooks/exhaustive-deps
 const saveTitle=async()=>{ if(editing===null) return; if(!editing.trim()) { setTitleError(true); return; } const value=editing.trim(); setEditing(null); setTitleError(false);
  await saveField('title',value); requestAnimationFrame(()=>document.getElementById('cw-title-btn')?.focus()); };
 const cancelTitle=()=>{ setEditing(null); setTitleError(false); requestAnimationFrame(()=>document.getElementById('cw-title-btn')?.focus()); };
 // ---- the comment field, with "@" for the team and the Agents (#154, #22) ----
 const [comment,setComment]=useState(''); const [chosen,setChosen]=useState<string[]>([]); const [list,setList]=useState<SuggestionList|null>(null); const [listId]=useState(()=>`mention-note-${newId()}`);
 const noteField=useRef<HTMLTextAreaElement>(null); const caret=useRef<number|null>(null); const commentFiles=useRef<HTMLInputElement>(null);
 const [,post,posting]=useActionState(async(_:null,form:FormData)=>{ await send(form); setComment(''); setChosen([]); if(commentFiles.current) commentFiles.current.value=''; setList(null); return null; },null);
 useEffect(()=>{ const field=noteField.current; if(caret.current===null||!field) return; field.focus(); field.setSelectionRange(caret.current,caret.current); caret.current=null; },[comment]);
 const updateList=(value:string,at:number)=>{ const token=tokenAtCaret(value,at); if(!token) { setList(null); return; }
  const items=mentionSuggestions({people,agents},token,false); setList(items.length?{token,items,index:0}:null); };
 const pickEntry=(at:number)=>{ if(!list) return; const picked=list.items[at]; if(!picked) return; const next=insertToken(comment,list.token,picked.insert); caret.current=next.caret; setComment(next.value); setList(null); };
 const noteKeys=(event:KeyboardEvent<HTMLTextAreaElement>)=>{
  if(list) {
   if(event.key==='ArrowDown') { event.preventDefault(); setList(now=>now&&{...now,index:(now.index+1)%now.items.length}); return; }
   if(event.key==='ArrowUp') { event.preventDefault(); setList(now=>now&&{...now,index:(now.index-1+now.items.length)%now.items.length}); return; }
   if(event.key==='Enter'||event.key==='Tab') { event.preventDefault(); pickEntry(list.index); return; }
   if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); setList(null); return; }
  }
  if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing) { event.preventDefault(); if(comment.trim()&&!posting) event.currentTarget.form?.requestSubmit(); }
 };
 // ---- opening, refreshing and closing ----
 useLayoutEffect(()=>{
  if(!box.current?.open) box.current?.showModal();
  const frame=requestAnimationFrame(()=>document.getElementById('cw-title')?.focus({preventScroll:true}));
  return ()=>{ cancelAnimationFrame(frame); stopLeaving.current(); };
 },[]);
 // While an Agent called in a comment works, the window reads itself again so its reply shows when it lands (#22).
 useEffect(()=>{ if(!data.working) return; const refresh=setInterval(()=>router.refresh(),3000); return ()=>clearInterval(refresh); },[data.working,router]);
 const close=()=>{ const dialog=box.current; if(!dialog?.open||leaving) return; stopLeaving.current=leave(leaveMs,()=>setLeaving(true),()=>dialog.close()); };
 const closed=()=>{
  stopLeaving.current(); setLeaving(false);
  document.querySelector<HTMLElement>(`#board-cols .kcard[data-card-id="${card.id}"] a`)?.focus();
  // The board's address comes back as a page the person opened, as a link would, so a menu opened meanwhile stays.
 openingPage(board); router.push(board,{scroll:false});
 };
 // ---- More ----
 const copyLink=()=>{ const refused=()=>toast(t('cardLinkCopyFailed'),{icon:'x'});
  try { const writing=navigator.clipboard?.writeText(`${location.origin}${board}?card=${card.id}`); if(!writing) { refused(); return; } void writing.then(()=>toast(t('cardLinkCopied'),{icon:'link'}),refused); } catch { refused(); } };
 const more:MoreMenuItem[]=archive?[{key:'copy',icon:'link',label:t('cardCopyLink'),run:copyLink},
  card.archived?{key:'restore',icon:'restore',label:t('cardRestore'),run:archive.restore}:{key:'archive',icon:'archive',label:t('cardArchive'),run:archive.archive}]:[];
 // ---- the status ----
 const status=card.status; const waiting=status==='waiting';
 const statusLabel=t('cwStatus',columnName(status));
 const statusItems:MenuItem[]=[...boardColumns.map(column=>({key:column,label:columnName(column),checked:column===status,disabled:waiting?column!==status:column==='waiting',
  lead:<span className={`dot dot--${column}`} aria-hidden="true"/>,run:()=>{ if(column!==status) void move(column); }})),
  ...(intoReview&&!waiting?[{key:'review',label:t('cwSendForReview'),lead:<ShellIcon name="needsReview"/>,run:intoReview}]:[])];
 // ---- the side's rows ----
 const assignee=valueOf('assignee');
 const assigneeFace=(value:string,size:number)=>value.startsWith('a:')?<span aria-hidden="true"><AgentFace agent={value.slice(2)} size={size}/></span>:value.startsWith('p:')?<Letter name={personName(value.slice(2))} size={size}/>:<span className="cw-noone" style={{'--av':`${size}px`} as CSSProperties} aria-hidden="true"/>;
 const mineToAssign=assignees.people.some(p=>p.id===me)&&assignee!==`p:${me}`;
 const assigneeItems:MenuItem[]=[
  ...(mineToAssign?[{key:'me',label:t('assignToMe'),lead:<ShellIcon name="hand"/>,run:()=>void saveField('assignee',`p:${me}`)}]:[]),
  ...(assignees.agents.length?[{key:'ga',group:t('assigneeAgents')},...assignees.agents.map(a=>({key:`a:${a.id}`,label:<bdi>{a.name}</bdi>,lead:assigneeFace(`a:${a.id}`,20),checked:assignee===`a:${a.id}`,run:()=>void saveField('assignee',`a:${a.id}`)}))]:[]),
  ...(assignees.people.length?[{key:'gp',group:t('assigneePeople')},...assignees.people.map(p=>({key:`p:${p.id}`,label:<bdi>{p.name}</bdi>,lead:assigneeFace(`p:${p.id}`,20),checked:assignee===`p:${p.id}`,run:()=>void saveField('assignee',`p:${p.id}`)}))]:[]),
  {key:'none',label:t('assigneeNoOne'),lead:assigneeFace('',20),checked:!assignee,run:()=>void saveField('assignee','')},
 ];
 const project=valueOf('project');
 const projectItems:MenuItem[]=[{key:'none',label:t('noProject'),checked:!project,run:()=>void saveField('project','')},...projects.map(p=>({key:String(p.id),label:<bdi>{p.name}</bdi>,checked:project===String(p.id),run:()=>void saveField('project',String(p.id))}))];
 const day=valueOf('go_live');
 const addLabel=<span className="cwp__add">{t('cwAdd')}</span>;
 const icon=(name:ShellIconName)=><span className="cwp__ic"><ShellIcon name={name}/></span>;
 // A Viewer's row: the icon, named for a screen reader, and the value.
 const stat=(lead:ReactNode,label:string,value:ReactNode)=><div className="cwp"><span className="cwp__s"><span className="cwp__ic" data-tip={label} aria-hidden="true">{lead}</span><span className="sr-only">{label}:</span>{value}</span></div>;
 const cardFiles=useRef<HTMLFormElement>(null); const versionForm=useRef<HTMLFormElement>(null);
 const hidden=(op:string)=><><input type="hidden" name="op" value={op}/><input type="hidden" name="slug" value={slug}/><input type="hidden" name="company" value={company}/><input type="hidden" name="card" value={card.id}/><input type="hidden" name="view" value="sheet"/></>;
 const made=data.made; const madeAt=made.at?workDate(made.at,language,{month:'short'}):'';
 const source=made.from==='chat'?<Link className="ib ib--sm" href={made.href} aria-label={t('cwOpenChat')} data-tip={t('cwOpenChat')}><ShellIcon name="chat"/></Link>
  :made.from==='chat-private'?<span className="cwp__ic cwp__src" role="img" aria-label={t('cwPrivateChat',made.person)} data-tip={t('cwPrivateChat',made.person)}><ShellIcon name="lock"/></span>
  :made.from==='channel'?<Link className="ib ib--sm" href={made.href} aria-label={t('cwOpenChannel',made.name)} data-tip={t('cwOpenChannel',made.name)}><ShellIcon name="hash"/></Link>
  :made.from==='channel-locked'?<span className="cwp__ic cwp__src" role="img" aria-label={t('cwChannelLocked',made.name)} data-tip={t('cwChannelLocked',made.name)}><ShellIcon name="lock"/></span>
  :<span className="cwp__ic cwp__src" role="img" aria-label={t('cwFromBoard')} data-tip={t('cwFromBoard')}><ShellIcon name="board"/></span>;
 const fileList=data.files.length>0&&<ul className="cw-fls">{data.files.map(file=><li key={file.id} className="cw-fl"><a className="file-chip cw-file" href={`/c/${slug}/files/${file.id}`} target="_blank" rel="noreferrer" aria-label={t('attachOpen',file.name)} data-tip={t('cwFileBy',file.by,workDate(file.at,language,{month:'short'}))}><ShellIcon name="file"/><bdi dir="auto">{file.name}</bdi></a></li>)}</ul>;
 // Waits for, and waited for by (#682; design-reference-card: cwSideHTML): each Card a chip that opens it, ticked once
 // released (Live, Done or archived); a Card the reader may not see is a hidden Card. A writer adds a wait from the
 // Cards on the board and takes one off; the database refuses a loop.
 const waitForm=(op:string,other:number)=>{ const form=new FormData(); for(const [key,value] of Object.entries({op,slug,company,card:String(card.id),view:'sheet',waits_for:String(other)})) form.set(key,value); return form; };
 const waitsFor=data.waits.filter(w=>w.side==='waits_for'); const waitedBy=data.waits.filter(w=>w.side==='waited_by');
 const waitChip=(w:CardWaitLink,removable:boolean)=><li key={`${w.side}-${w.other}`} className="cw-chip">{w.title==null
  ?<span className="cw-chip__open is-hidden"><ShellIcon name="lock"/><span>{t('cwHiddenCard')}</span></span>
  :<Link className="cw-chip__open" href={`/c/${slug}/work/board?card=${w.other}`} scroll={false} aria-label={`${w.title} · ${w.status==='archived'?t('symArchived'):columnName(w.status||'')}`} data-tip={w.status==='archived'?t('symArchived'):columnName(w.status||'')}>
   {w.open?<span className="dot" aria-hidden="true"/>:<ShellIcon name="check"/>}<bdi className="od-truncate" dir="auto">{w.title}</bdi></Link>}
  {removable&&<button type="button" className="cw-chip__x" aria-label={t('cwWaitRemove',w.title??t('cwHiddenCard'))} data-tip={t('cwWaitRemove',w.title??t('cwHiddenCard'))} onClick={()=>void send(waitForm('wait-remove',w.other))}><ShellIcon name="x"/></button>}</li>;
 const taken=new Set([card.id,...waitsFor.map(w=>w.other)]);
 const waitItems:MenuItem[]=waitChoices.filter(x=>!taken.has(x.id)&&x.status!=='done').map(x=>({key:String(x.id),label:<bdi dir="auto">{x.title}</bdi>,run:()=>void send(waitForm('wait-add',x.id))}));
 const waitAdd=(className:string,inner:ReactNode)=>waitItems.length?<CwMenu label={t('cwWaitAdd')} className={className} items={waitItems} button={inner}/>:null;
 const waitRows=<>{waitsFor.length?<div className="cwp cwp--chips"><span className="cwp__ic" data-tip={t('cwWaitsFor')} aria-hidden="true"><ShellIcon name="hourglass"/></span><span className="sr-only">{t('cwWaitsFor')}:</span>
   <ul className="cw-chips">{waitsFor.map(w=>waitChip(w,W))}</ul>{W&&waitAdd('ib ib--sm',<ShellIcon name="plus"/>)}</div>
  :W&&waitItems.length>0&&<div className="cwp">{waitAdd('cwp__b is-empty',<>{icon('hourglass')}{addLabel}</>)}</div>}
  {waitedBy.length>0&&<div className="cwp cwp--chips"><span className="cwp__ic" data-tip={t('cwWaitedBy')} aria-hidden="true"><ShellIcon name="link"/></span><span className="sr-only">{t('cwWaitedBy')}:</span>
   <ul className="cw-chips">{waitedBy.map(w=>waitChip(w,false))}</ul></div>}</>;
 const side=<aside className="cw-side" aria-label={t('cwDetails')}><div className="cwp-list">
  {W?<div className="cwp"><CwMenu label={t('cwPropertyValue',t('assignee'),assigneeName(assignee)||t('assigneeNoOne'))} className={`cwp__b${assignee?'':' is-empty'}`} items={assigneeItems} button={<><span className="cwp__ic" data-tip={t('assignee')}>{assigneeFace(assignee,20)}</span>{assignee?<bdi className="od-truncate">{assigneeName(assignee)}</bdi>:addLabel}</>}/></div>
   :stat(assigneeFace(assignee,20),t('assignee'),<bdi className="od-truncate">{assigneeName(assignee)||t('assigneeNoOne')}</bdi>)}
  {note('assignee')}
  {W?<div className="cwp"><span className="cwp__ic" data-tip={t('publishingDate')} aria-hidden="true"><ShellIcon name="calendar"/></span><label className="sr-only" htmlFor="cw-date">{t('publishingDate')}</label>
    <input type="date" className="set-input cw-input" id="cw-date" key={day} defaultValue={day} onChange={event=>void saveField('go_live',event.target.value)}/></div>
   :day&&stat(<ShellIcon name="calendar"/>,t('publishingDate'),<span className="num">{dayLabel(day)}</span>)}
  {note('go_live')}
  {W?<div className="cwp"><CwMenu label={t('cwPropertyValue',t('project'),projectName(project)||t('cwNone'))} className={`cwp__b${project?'':' is-empty'}`} radio items={projectItems} button={<>{icon('folder')}{project?<bdi className="od-truncate">{projectName(project)}</bdi>:addLabel}</>}/></div>
   :project&&stat(<ShellIcon name="folder"/>,t('project'),<bdi className="od-truncate">{projectName(project)}</bdi>)}
  {note('project')}
  {waitRows}
  {W?<form ref={cardFiles} action={send} className={`cwp${data.files.length?' cwp--chips':''}`}>{hidden('files')}
    {data.files.length?<><span className="cwp__ic" data-tip={t('cwFiles')} aria-hidden="true"><ShellIcon name="clip"/></span><span className="sr-only">{t('cwFiles')}:</span>{fileList}
     <label className="ib ib--sm cw-pick-files" data-tip={t('cwAddFiles')}><ShellIcon name="plus"/><input type="file" name="files" multiple className="sr-only" aria-label={t('cwAddFiles')} onChange={()=>cardFiles.current?.requestSubmit()}/></label></>
    :<label className="cwp__b is-empty cw-pick-files" data-tip={t('cwFiles')}>{icon('clip')}{addLabel}<input type="file" name="files" multiple className="sr-only" aria-label={t('cwAddFiles')} onChange={()=>cardFiles.current?.requestSubmit()}/></label>}</form>
   :data.files.length>0&&<div className="cwp cwp--chips"><span className="cwp__ic" data-tip={t('cwFiles')} aria-hidden="true"><ShellIcon name="clip"/></span><span className="sr-only">{t('cwFiles')}:</span>{fileList}</div>}
  <div className="cwp cwp--made"><span className="cwp__s"><span className="cwp__ic" data-tip={t('cwMadeBy')} aria-hidden="true">{made.by?<Letter name={made.by} size={20}/>:null}</span><span className="od-truncate"><span className="sr-only">{t('cwMadeBy')}: </span><bdi>{made.by||'—'}</bdi>{madeAt&&<> · <span className="num">{madeAt}</span></>}</span></span>{source}</div>
 </div></aside>;
 // ---- the Result: its Versions, uploaded and opened here ----
 const result=(data.versions.length>0||W)&&<section className="cw-sec" aria-labelledby="cw-h-res"><div className="cw-sec__h"><h3 id="cw-h-res">{t('cwResult')}</h3>
   {W&&<form ref={versionForm} action={send}>{hidden('upload')}{data.creative!=null&&<input type="hidden" name="creative" value={data.creative}/>}
    <label className="btn btn--secondary btn--sm cw-pick-files"><ShellIcon name="plus"/><span>{t('cwUploadVersion')}</span><input type="file" name="file" className="sr-only" onChange={()=>versionForm.current?.requestSubmit()}/></label></form>}</div>
  {data.versions.length>0&&<div className="cw-result"><ol className="cw-vers" aria-label={t('cwVersions')}>{data.versions.map(v=><li key={v.id} className="cw-ver"><span className="od-field">
   <span className="cw-ver__n"><span className="num">{t('cwVersionN',v.n)}</span> · {v.url?<a href={v.url} target="_blank" rel="noreferrer" aria-label={t('cwOpenVersion',v.n,v.name)}><bdi dir="auto">{v.name}</bdi></a>:<bdi dir="auto">{v.name}</bdi>}</span>
   <span className="cw-ver__d num">{workDate(v.at,language,{month:'short'})}</span></span></li>)}</ol></div>}
 </section>;
 // ---- Comments, Activity, Runs ----
 const tabs:[Tab,ShellIconName,string,number][]=[['comments','chat',t('cwComments'),data.commentCount],['activity','history',t('cwActivity'),data.activityCount],['runs','play',t('cwRuns'),data.runs.length]];
 const pick=(next:Tab)=>{ setTab(next); requestAnimationFrame(()=>document.getElementById(`cw-tab-${next}`)?.focus()); };
 const order=tabs.map(([key])=>key);
 const tabKeys=(event:KeyboardEvent)=>{ const at=order.indexOf(tab); const rtl=language==='ar';
  const step:Record<string,number>={ArrowRight:rtl?-1:1,ArrowLeft:rtl?1:-1};
  if(event.key==='Home') { event.preventDefault(); pick(order[0]); } else if(event.key==='End') { event.preventDefault(); pick(order[order.length-1]); }
  else if(step[event.key]) { event.preventDefault(); pick(order[(at+step[event.key]+order.length)%order.length]); } };
 const outcome=(run:CardRun)=>run.outcome==null?t('cwRunRunning'):run.outcome==='completed'?t('cwRunCompleted'):run.outcome==='failed'?t('cwRunFailed'):run.outcome==='lost'?t('cwRunLost'):t('cwRunStopped');
 const when=(at:string)=>workDate(at,language,{month:'short',hour:'numeric',minute:'2-digit'});
 const runs=data.runs.length?<ol className="cw-runs">{[...data.runs].reverse().map(run=><li key={run.note} className="cw-run"><span aria-hidden="true"><AgentFace agent={run.agent} size={28}/></span><div className="od-field">
   <span className="cw-run__t"><span className="num">#{run.n}</span> · <bdi>{run.name}</bdi> · <span className={`cw-run__o${run.outcome==='failed'?' is-fail':run.outcome==null?' is-run':''}`}>{run.outcome==null&&<span className="dot dot--working" aria-hidden="true"/>}{outcome(run)}</span></span>
   <span className="cw-run__d num">{when(run.start)}{run.end&&<> {language==='ar'?'←':'→'} {when(run.end)}</>}</span></div></li>)}</ol>
  :<div className="panel-card"><p className="panel-empty">{t('cwNoRuns')}</p></div>;
 const panel=tab==='comments'?data.comments:tab==='activity'?data.activity:runs;
 const composer=tab!=='comments'?null:W?<form className="composer note-composer" action={post}>{hidden('comment')}
   {list&&<MentionPop listId={listId} label={t('mentionCallSomeone')} items={list.items} index={list.index} pick={pickEntry}/>}
   {chosen.length>0&&<div className="composer__files">{chosen.map((name,n)=><span key={n} className="file-chip"><ShellIcon name="clip"/><bdi dir="auto">{name}</bdi></span>)}</div>}
   <div className="composer__row">
    <label className="composer__btn" data-tip={t('cwAttach')}><ShellIcon name="clip"/><input aria-label={t('cwAttach')} ref={commentFiles} type="file" name="files" multiple className="sr-only" onChange={event=>setChosen([...(event.target.files||[])].map(file=>file.name))}/></label>
    <label className="sr-only" htmlFor="ta-note">{t('cwCommentLabel')}</label>
    <textarea ref={noteField} className="composer__input" id="ta-note" name="body" rows={1} dir="auto" required readOnly={posting} placeholder={t(alone?'cwCommentAlone':'cwCommentTeam')} aria-describedby="note-hint"
     value={comment} aria-autocomplete="list" aria-expanded={!!list} aria-controls={list?listId:undefined} aria-activedescendant={list?`${listId}-${list.index}`:undefined}
     onChange={event=>{ const value=event.target.value; setComment(value); updateList(value,event.target.selectionStart??value.length); }} onKeyDown={noteKeys}/>
    <button type="submit" className="composer__send" aria-label={t('cwPost')} data-tip={t('cwPost')} disabled={!comment.trim()||posting}><ShellIcon name="send"/></button>
   </div>
   <p className="note-hint" id="note-hint"><ShellIcon name="clock"/><span>{t('noteHint')}</span></p>
  </form>:<p className="ro-line"><ShellIcon name={card.archived?'archive':'eye'}/><span>{card.archived?t('cardArchivedReadOnly'):t('cwReadOnly')}</span></p>;
 const symbolName=symbol?t(symbols[symbol].key):'';
 return <dialog ref={box} className={`cw${leaving?' is-closing':''}`} aria-labelledby={editing!==null?'cw-title-in':'cw-title'} onCancel={event=>{ if(event.cancelable) { event.preventDefault(); if(editing!==null) cancelTitle(); else close(); } }} onClose={closed} onClick={event=>{ if(event.target===event.currentTarget) close(); }}>
  <div className="cw__inner">
   {/* Opening the Card is where an Agent that failed on it is seen to have failed (#699). */}
   <OpenedHere company={company} place={{card:card.id}}/>
   <header className="cw-head"><div className="cw-head__row">
    {W?<CwMenu label={symbolName?`${statusLabel} · ${symbolName}`:statusLabel} className={`cw-status${waiting?' is-wait':''}`} radio items={statusItems} button={<>{symbol&&<Sym kind={symbol} inert/>}<span>{columnName(status)}</span><ShellIcon name="chevronDown"/></>}/>
     :<span className={`cw-status is-static${waiting?' is-wait':''}`}>{symbol&&<Sym kind={symbol}/>}<span>{columnName(status)}</span></span>}
    {card.archived&&<Sym kind="archived"/>}
    {!mayWrite&&<Sym kind="readonly"/>}
    <span className="od-fill"/>
    {mayWrite&&more.length>0&&<MoreMenu label={t('cardMore')} items={more}/>}
    <button type="button" className="circle-btn" aria-label={t('cwClose')} data-tip={t('sheetClose')} onClick={close}><ShellIcon name="x"/></button>
   </div></header>
   <div className="cw-body">
    <div className="cw-top">
     {editing!==null?<div className="cw-title-edit"><label className="sr-only" htmlFor="cw-title-in">{t('cwTitleLabel')}</label>
      <input ref={titleField} type="text" className="set-input cw-title-in" id="cw-title-in" dir="auto" value={editing} maxLength={500} aria-invalid={titleError||undefined} aria-describedby={titleError?'cw-title-err':undefined}
       onChange={event=>{ setEditing(event.target.value); setTitleError(false); }} onKeyDown={event=>{ if(event.key==='Enter') { event.preventDefault(); void saveTitle(); } else if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); cancelTitle(); } }}/>
      {titleError&&<span className="set-err" id="cw-title-err" role="alert">{t('cardTitleRequired')}</span>}
      <div className="cw-edit-row"><button type="button" className="btn btn--secondary btn--sm" onClick={cancelTitle}>{t('cancel')}</button><button type="button" className="btn btn--primary btn--sm" onClick={()=>void saveTitle()}>{t('save')}</button></div></div>
     :<h2 className="cw-title" id="cw-title" tabIndex={-1} dir="auto">{W?<button type="button" id="cw-title-btn" className="cw-title-btn" data-tip={t('cwRename')} onClick={()=>setEditing(valueOf('title'))}>{valueOf('title')}</button>:valueOf('title')}</h2>}
     {note('title')}
     {message&&<p role="alert" className="cw-said">{message}</p>}
     {card.archived&&<section className="cw-call" aria-label={t('cardArchived')}><div className="cw-call__head"><span className="cw-call__ic" aria-hidden="true"><ShellIcon name="archive"/></span><p className="cw-call__s od-fill"><bdi>{card.archived.by}</bdi> · <span className="num">{card.archived.at}</span></p>
      {mayWrite&&archive&&<button type="button" className="btn btn--primary btn--sm" onClick={archive.restore}><ShellIcon name="restore"/><span>{t('cardRestoreShort')}</span></button>}</div></section>}
     {!card.archived&&callout}
     {description&&<section className="cw-sec cw-desc-sec" aria-labelledby="cw-h-desc" data-slot="description"><div className="cw-sec__h"><h3 id="cw-h-desc">{t('cwDescription')}</h3></div>{description}</section>}
     {result}
    </div>
    {side}
    <section className="cw-feed" aria-label={t('cwFeed')}>
     <div className="segmented cw-tabs" role="tablist" aria-label={t('cwTabs')} onKeyDown={tabKeys}>
      {tabs.map(([key,name,label,count])=><button key={key} type="button" role="tab" id={`cw-tab-${key}`} className="cw-tab" aria-selected={tab===key} aria-controls="cw-list" tabIndex={tab===key?0:-1} aria-label={t('cwTabCount',label,count)} data-tip={tab===key?undefined:label} onClick={()=>pick(key)}>
       <ShellIcon name={name}/>{tab===key&&<span>{label}</span>}<span className="num cw-tabs__n">{count}</span></button>)}
     </div>
     <div className="cw-list" id="cw-list" role="tabpanel" aria-labelledby={`cw-tab-${tab}`} tabIndex={-1}>{panel}</div>
     <div className="cw-comp">{composer}</div>
    </section>
   </div>
  </div>
  <CardTips box={box}/>
 </dialog>;
}
