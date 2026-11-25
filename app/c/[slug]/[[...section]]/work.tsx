'use client';
import { messages } from '@/lib/i18n.mjs';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { AuthoredTitle } from '@/lib/authored-title';
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { BoardPager, KanbanBoard, KanbanCard, KanbanColumn, land } from '@/components/paperclip/KanbanBoard';
import { prefersReducedMotion } from '@/lib/motion';
import { TaskList, TaskListRow } from '@/components/paperclip/TaskList';
import { BoardIcon } from '@/components/board-icon';
import { ShellIcon } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import { useRemovedAgents } from '@/lib/agent-looks-client';
import { CardWindow, Sym, type CardWindowData } from '@/app/card-window';
import { toast } from '@/app/toast';
import { useFlagToast } from '@/app/use-flag-toast';
import { useAgentIdentities } from '@/lib/agent-identities-client';
const NewCard=lazy(()=>import('./new-card'));
import AddIdea from './add-idea';
import { ChatCardFoot, useShowCard, type CardAgent } from './board-show';
import { answerAgentAccess, decideAgentRule } from './skill-actions';
import { OwnerRequestCard } from './agent-request-card';
import { ChangeBoardCard } from './agent-change-card';
import { AgentKeyWaitCard } from './agent-key-wait-card';
import { Decision } from './decision';
import { Avatar, type WorkActivity, type WorkAttachment, type WorkMember } from '@/lib/work-activity';
import { workDate as date } from '@/lib/work-date.mjs';
import { sortWorkCards } from '@/lib/work-sort.mjs';
import { bellRows, boardColumns, blockReason, cardSymbol, chatPlace, chatWait, columnLabel, columnOf, keyboardTarget, onCard, orderColumn, placeByOne, progressOf, type CardWait } from '@/lib/board-columns.mjs';
import { useNewlyWaiting } from '@/lib/newly-waiting';
import { withMention } from '@/lib/channels';
import type { AssignedCard, WaitingItem } from '@/lib/approval-queue';
import { WaitingBell } from './waiting-bell';
import { ArchiveConfirm } from '@/app/archive-confirm';
import type { ArchiveAnswer, ArchiveIntent, ArchiveStop } from '@/lib/archive-stops';
import { useArchivedList, type ReadArchived } from './archived-list';
import type { ArchivedPage } from '@/lib/archived-cards';
import '@/app/board.css';
type Stage={id:number,name:string,position:number,board_column?:string|null}; type Label={id:number,name:string,color:string};
export type Card={id:number,title:string,stage_id:number,status:string,channel:string,format:string,go_live:string|null,offering:string,segment:string,hook:string,goal:string,caption:string,next_actor:string|null,mode:string|null,approval_step_id:number|null,rejection_reason:string|null,project_id:number|null,agent_id?:string|null,assignee_agent?:string|null,assignee_person?:string|null,kept_agent_id?:string|null,channel_id?:string|null,crew?:string[],wait?:CardWait|null,board_order?:number|null,created_at?:string|null,archived_at?:string|null,archived_by?:string|null}; type Project={id:number,name:string}; type Item={id:number,card_id:number,title:string,done:boolean}; type Person=WorkMember & {agent_role?:string|null}; type Activity=WorkActivity; type Creative={id:number,card_id:number,name:string}; type Version={id:number,creative_id:number,path:string,url:string|null}; type CL={card_id:number,label_id:number};
// workAction is the board's server action (work-actions.ts), handed in so this client file never imports the server module.
export type WorkAction=(form:FormData)=>Promise<void>;
// "Undo" on a move (#168): the server's answer, and nothing else, decides whether the Card went back. The shape lives here
// and work-actions.ts answers with it, so the two cannot drift.
export type UndoResult={state:'undone',column:string}|{state:'gone'}|{state:'refused'};
export type UndoMove=(form:FormData)=>Promise<UndoResult>;
// A place (#174) is answered in place: the board keeps its Cards and says in words why the Card stayed where it is.
export type PlaceResult={ok:true}|{error:string};
export type PlaceCard=(form:FormData)=>Promise<PlaceResult>;
// A property saved in the Card window (#678): saved, refused because someone changed it meanwhile (with the newer
// value, as the database holds it), or refused for a reason told in words.
export type SaveResult={saved:string}|{stale:string}|{error:string};
export type SaveCard=(form:FormData)=>Promise<SaveResult>;
export type IdeaResult={card:number}|{failed:true};
// Archiving or restoring Cards (#670): the Cards the database archived or restored, or none.
// Which question of what archiving would stop is the newest still wanted: an answer to an older or dropped one is ignored.
function newestQuestion() { let newest=0; return {ask:()=>++newest,drop:()=>{ newest++; },newest:(asked:number)=>asked===newest}; }
type ArchiveCards=(company:string,intent:ArchiveIntent|'undo',cards:number[],version?:string)=>Promise<ArchiveAnswer<number>>;
export type AddIdeaAction=(form:FormData)=>Promise<IdeaResult>;
export type WorkProps={workAction:WorkAction,saveCard?:SaveCard,placeMove:PlaceCard,addIdea:AddIdeaAction,undoMove:UndoMove,me:string,slug:string,company:string,section:string,stages:Stage[],labels:Label[],cards:Card[],items:Item[],members:Person[],activity:Activity[],creatives:Creative[],versions:Version[],cardLabels:CL[],projects:Project[],message?:string,approvableIds:number[],assigned?:AssignedCard[],agents:{person_id:string,role:string,granted:boolean}[],canCreate:boolean,initialCreating:boolean,attachments:WorkAttachment[],waiting?:WaitingItem[],focus?:'waiting',alone?:boolean,opened?:CardWindowData,show?:number,ideaAdded?:boolean,ruleDecision?:{approve:boolean,agent:string},cardAgents?:CardAgent[],archived?:ArchivedCards,readArchived?:ReadArchived<Card>,archiveCards?:ArchiveCards};
// The board's archive list (#670, #705): the server's first page, how many archived Cards the reader sees (null when it
// could not be read), and an archived Card the address names that the page does not hold, which opens over the board.
type ArchivedCards={first:ArchivedPage<Card>|null,total:number|null,named:Card[]};
const emptyKey:Record<string,[string,string]>={waiting:['boardEmptyWaiting','boardEmptyWaitingHint'],ideas:['boardEmptyIdeas','boardEmptyIdeasHint'],planned:['boardEmptyPlanned','boardEmptyPlannedHint'],progress:['boardEmptyProgress','boardEmptyProgressHint'],live:['boardEmptyLive','boardEmptyLiveHint'],done:['boardEmptyDone','']};
export default function Work(p:WorkProps) { const {workAction,placeMove,undoMove}=p; const {t,locale,language}=useI18n(); const router=useRouter(); const identities=useAgentIdentities();
 // A change-only form cannot submit before React attaches its handler.
 const hydrated=useSyncExternalStore(()=>()=>{},()=>true,()=>false);
 const [moving,setMoving]=useState(false); const [placeError,setPlaceError]=useState<string|null>(null); const focusCard=useRef<{id:number,column:string,landing?:boolean|{left:number,top:number},smooth?:boolean,before?:number|null,since?:number}>({id:0,column:''}); const [agentFilter,setAgentFilter]=useState('all'); const [kind,setKind]=useState<'all'|'mkt'>('all'); const [month,setMonth]=useState(p.section==='work/calendar'?new Date().toISOString().slice(0,7):''); const [composing,setComposing]=useState(p.initialCreating && p.canCreate); const [addingIdea,setAddingIdea]=useState(false); const [showArchived,setShowArchived]=useState(false); const [confirming,setConfirming]=useState<{cards:number[],stops:ArchiveStop[]}|null>(null); const [asking]=useState(newestQuestion); const [selected,setSelected]=useState<Map<number,string>|null>(null); const [left,setLeft]=useState<{restore:boolean,titles:string[]}|null>(null); const selectToggle=useRef<HTMLButtonElement>(null); const selectAllButton=useRef<HTMLButtonElement>(null); const selectedAct=useRef<HTMLButtonElement>(null); const [focusTo,setFocusTo]=useState<{to:'toggle'|'all'|'act'}|null>(null); const addButton=useRef<HTMLButtonElement>(null); const [project,setProject]=useState(''); const [archiveQuery,setArchiveQuery]=useState(''); const [archiveSearching,setArchiveSearching]=useState(false); const archiveField=useRef<HTMLInputElement>(null); const archiveSearchButton=useRef<HTMLButtonElement>(null); const archiveEscaped=useRef(false); const [sort,setSort]=useState('title'); const [direction,setDirection]=useState<'ascending'|'descending'>('ascending');
 const base=`/c/${p.slug}/work`; const shown=p.cards.filter(c=>!project||String(c.project_id)===project); const visible=shown.filter(c=>!month||!c.go_live||c.go_live.slice(0,7)===month); const hidden=(op:string)=><><input type="hidden" name="op" value={op}/><input type="hidden" name="slug" value={p.slug}/><input type="hidden" name="company" value={p.company}/></>;
 // A card made from a message is marked with its mode, in the colour of the agent it was sent to.
 const modeChip=(c:Card)=>{ if(!c.mode) return null; return <span className="mode-chip" data-mode={c.mode}><i/>{c.mode==='plan'?t('modePlan'):c.mode==='do'?t('modeDo'):t('modeAnswer')}</span>; };
 // ---- the board (ADR 0026): six columns, each a status (#676), "Waiting on you" first ----
 const rtl=language==='ar';
 const columnName=(column:string)=>t(columnLabel(column,p.canCreate));
 const agentIds=new Set([...p.agents.map(a=>a.person_id),...identities.map(a=>a.id)]);
 const agentName=(id:string)=>identities.find(a=>a.id===id)?.name||p.members.find(m=>m.person_id===id)?.people?.name||'';
 // A legacy role agent shows its name's first letter, as a person does (#697).
 const letter=(id:string,size:number)=><span dir="auto" className="avatar avatar--agent" role="img" aria-label={agentName(id)} style={{width:size,height:size}}>{Array.from(agentName(id).trim())[0]||'؟'}</span>;
 const columnOfCard=(c:Card)=>columnOf(c);
 // A card's person on its tile: its assignee Member (#677), else, for a Card nobody has, the Agent that made it (a card an
 // Agent filed through the API). The person who added an idea is the writer of its own log row (#188), so the Card can
 // say "New idea from …".
 const makerOf=(c:Card)=>p.activity.find(a=>a.card_id===c.id&&(a.action==='card_created'||a.action==='idea_added'))?.actor_id;
 const agentOfCard=(c:Card)=>{ const creator=makerOf(c); return c.assignee_person??(!c.assignee_agent&&creator&&agentIds.has(creator)?creator:null); };
 // The chips are the Company's Agents the reader sees, in the sidebar's order (#190); a Card is under its own Agent's.
 const companyAgents=p.cardAgents||[];
 // A Card keeps the Agent it was made with when that Agent is removed (#702): it and the crews name a removed Agent by
 // the name kept beside its look, in that look; the chips do not.
 const removed=useRemovedAgents();
 const agentById=useMemo(()=>new Map([...Object.entries(removed).map(([id,name]):[string,CardAgent]=>[id,{id,connection_id:'',name,speciality:''}]),...(p.cardAgents||[]).map((a):[string,CardAgent]=>[a.id,a])]),[p.cardAgents,removed]);
 const cardAgentOf=(c:Card)=>{ const agent=c.assignee_agent??(c.assignee_person?null:c.kept_agent_id); return agent?agentById.get(agent):undefined; };
 // A filter on an Agent the reader no longer sees reads as All (design-reference: 5741).
 const filter=companyAgents.some(a=>a.id===agentFilter)?agentFilter:'all';
 const asked=p.show?p.cards.find(c=>c.id===p.show):undefined;
 useShowCard(p.show,{hides:!!asked&&filter!=='all'&&asked.assignee_agent!==filter,showAll:()=>setAgentFilter('all'),board:`${base}/board`});
 // The board keeps the month filter of the dated views: a card dated in another month is hidden, an undated one stays.
 const boardCards=visible.filter(c=>filter==='all'||c.assignee_agent===filter);
 // A question or a hand of a chat with a Card is drawn as that Card (#146), as an approval is, while the board draws the
 // Card under Waiting on you; a filter or a hidden Agent that leaves the Card out leaves the row drawn on its own.
 const waitingHere=new Set(boardCards.filter(c=>columnOfCard(c)==='waiting').map(c=>c.id));
 const asCard=(item:WaitingItem)=>onCard(item)&&(item.kind==='approval'||waitingHere.has(item.card_id!));
 const items=(p.waiting||[]).filter(item=>!asCard(item));
 // On "Waiting on you" (/approvals) the column is the reader's own list, exactly as waiting_list returns it (the same
 // source as the count): their approvals and their items, newest first. A card in review that waits on someone else is
 // not theirs, so it is not shown there; the board's own column still shows every card in review.
 const ownList=p.focus==='waiting';
 const ownEntries=(p.waiting||[]).flatMap((item,n,all):{item:WaitingItem,card?:Card}[]=>{ if(!asCard(item)) return [{item}]; if(all.findIndex(other=>asCard(other)&&other.card_id===item.card_id)<n) return []; const c=boardCards.find(x=>x.id===item.card_id); return c?[{item,card:c}]:[]; });
 const drawnCards=ownList?boardCards.filter(c=>columnOfCard(c)!=='waiting'||ownEntries.some(entry=>entry.card?.id===c.id)):boardCards;
 const waitingTotal=new Set((p.waiting||[]).filter(item=>asCard(item)&&waitingHere.has(item.card_id!)).map(item=>item.card_id)).size+items.length;
 const stagesIn=(column:string)=>p.stages.filter(s=>(s.board_column||'ideas')===column);
 const stageName=(c:Card)=>p.stages.find(s=>s.id===c.stage_id)?.name||'';
 // After a move the card is drawn again in its new column; the keyboard stays on it, and after a keyboard move the board
 // scrolls to it smoothly (#131; design-reference: the Shift and arrow keys' scrollIntoView). A Card put back by "Undo" (#168)
 // lands in its old column with the reference's short motion (design-reference: undoMove's focus and land).
 useEffect(()=>{ const {id,column,landing,smooth,before}=focusCard.current; if(!id) return; const link=document.querySelector<HTMLElement>(`#board-cols [data-column="${column}"] .kcard[data-card-id="${id}"] a`); if(!link) return;
  // A place inside one column waits until the Card is drawn above the Card it was put before.
  // Another change to the column can leave it in another order: after two seconds the keyboard goes to the Card anyway,
  // with no landing.
  let lands=landing;
  if(before!==undefined) { const order=[...document.querySelectorAll<HTMLElement>(`#board-cols [data-column="${column}"] .kcard[data-card-id]`)].map(el=>Number(el.dataset.cardId)); if((order[order.indexOf(id)+1]??null)!==before) { if(performance.now()-(focusCard.current.since??0)<2000) return; lands=false; } }
  link.focus({preventScroll:true}); link.scrollIntoView({block:'nearest',inline:'nearest',behavior:smooth&&!prefersReducedMotion()?'smooth':'auto'}); if(lands) land(link.closest('.kcard'),typeof lands==='object'?lands:null); focusCard.current={id:0,column:''}; });
 // The Inbox opens the board on "Waiting on you".
 useEffect(()=>{ if(p.focus==='waiting') document.querySelector('#board-cols > [data-column="waiting"]')?.scrollIntoView({block:'nearest',inline:'nearest'}); },[p.focus]);
 // An idea just added comes back on the board with the card it made (#188): the reference confirms it with a toast,
 // while useShowCard flashes that Card and puts the focus on it.
 // Each idea added says so, the second one on the same board included.
 useEffect(()=>{ if(p.ideaAdded) toast(t('ideaAdded')); },[p.ideaAdded,p.show,t]);
 // A decided learning suggestion comes back to the board with its outcome in the address (#169): the item has left the
 // list, and the toast names the Agent it was for, read by the page from the item the address names. Shown once; a reload
 // does not say it again.
 useFlagToast(['decided','item'],p.ruleDecision?t(p.ruleDecision.approve?'waitingRuleDecidedTeamWide':'waitingRuleDecidedDeclined',p.ruleDecision.agent):null,p.ruleDecision?.approve?'check':'x');
 // A Card is placed where its person drops it, or one place up or down its column with Shift and Up or Down (#174): the
 // column's own order is kept in the database, and a change of place inside one column is not a move to announce.
 const inColumn=(column:string)=>orderColumn(drawnCards.filter(c=>columnOfCard(c)===column),column).map(id=>drawnCards.find(c=>c.id===id)!);
 // "Undo" puts the Card back in the stage it left and the place it held (#168), as the person: the database decides every
 // refusal, and the board says in a toast why the Card stayed where it is.
 const undo=(id:number)=>{
  const form=new FormData(); form.set('company',p.company); form.set('slug',p.slug); form.set('card',String(id));
  void undoMove(form).then(result=>{
   if(result.state!=='undone') { toast(result.state==='gone'?t('boardUndoGone'):t('boardUndoRefused'),{icon:'x'}); return; }
   toast(t('boardBackIn',columnName(result.column)));
   focusCard.current={id,column:result.column,landing:true};
   router.refresh();
  });
 };
 // Archiving and restoring (#670; design-reference-card: cwArchive, cwUndo, cwRestore): the database decides, and the
 // toast says what happened. "Undo" restores the Cards just archived to their columns and starts nothing.
 // Several at once (#672; design-reference-card: cwArchive's "N archived", cwRestore's "N restored"): a Card the
 // database left as it was, because it changed meanwhile or the person may not change it, is named on the board.
 const titleOf=(id:number)=>selected?.get(id)??p.cards.find(c=>c.id===id)?.title??archivedCards.find(c=>c.id===id)?.title??'';
 const leftOf=(ids:number[],done:number[],restoring:boolean)=>{ const titles=ids.filter(id=>!done.includes(id)).map(titleOf); setLeft(ids.length>1&&titles.length?{restore:restoring,titles}:null); };
 const leftLine=(l:{restore:boolean,titles:string[]})=>{ const [before,after]=t(`board${l.restore?'Restore':'Archive'}Left${l.titles.length>1?'Many':'One'}`,'\u0000').split('\u0000');
  return <>{before}{l.titles.map((title,n)=><Fragment key={n}>{n>0&&t('boardNamesJoin')}{language==='ar'?<>«<bdi>{title}</bdi>»</>:<>“<bdi>{title}</bdi>”</>}</Fragment>)}{after}</>; };
 // A question of what archiving would stop that is still on its way is dropped when the selection it was asked for ends
 // (Cancel, or the board switching to its archive list): its answer then neither confirms nor archives anything.
 const dropAsking=()=>asking.drop();
 const endSelecting=()=>{ dropAsking(); if(selected) { setSelected(null); setFocusTo({to:'toggle'}); } };
 // A request that never answered (the network, a server that went away) may still have changed Cards: the board is
 // read again before the person is asked to try again.
 const failed=()=>{ toast(t('cardArchiveFailedRetry'),{icon:'x'}); router.refresh(); };
 // `version` is an Undo's: it restores only what the archive that offered it archived (archive_cards' version).
 const restore=(ids:number[],version?:string)=>{ if(!p.archiveCards) return;
  void p.archiveCards(p.company,version?'undo':'restore',ids,version).then(result=>{
   const done=result.state==='done'?result.done:[]; leftOf(ids,done,true); endSelecting();
   if(!done.length) { if(ids.length===1) toast(t('cardRestoreRefused'),{icon:'x'}); return; }
   archiveList.drop(done); toast(done.length>1?t('cardsRestoredToast',done.length):t('cardRestoredToast'),{icon:'restore'}); router.refresh();
  },failed);
 };
 const archiveNow=(ids:number[])=>{ if(!p.archiveCards) return;
  void p.archiveCards(p.company,'archive',ids).then(result=>{
   const done=result.state==='done'?result.done:[]; leftOf(ids,done,false); endSelecting();
   if(!done.length||result.state!=='done') { if(ids.length===1) toast(t('cardArchiveRefused'),{icon:'x'}); return; }
   const version=result.version;
   toast(done.length>1?t('cardsArchivedToast',done.length):t('cardArchivedToast'),{icon:'archive',action:{label:t('cardUndo'),run:()=>restore(done,version)}}); router.refresh();
  },failed);
 };
 // #671 (design-reference-card: cwArchive, cwConfirm): the database first says what archiving would stop; only when
 // something does, one confirmation names each thing across every Card being archived, and only "Archive and stop"
 // archives. Nothing is archived unless the database answered: a question that failed archives nothing and says so.
 const archive=(ids:number[])=>{ if(!p.archiveCards||!ids.length) return; setLeft(null);
  const token=asking.ask();
  const answered=(result:ArchiveAnswer<number>|null)=>{ if(!asking.newest(token)) return;
   if(result?.state!=='stops') { toast(t('archiveCheckFailed'),{icon:'x'}); return; }
   if(result.stops.length) setConfirming({cards:ids,stops:result.stops}); else archiveNow(ids);
  };
  void p.archiveCards(p.company,'stops',ids).then(answered,()=>answered(null));
 };
 // Select mode (#672; design-reference-card: bsel-toggle, sel-card, bsel-all): each Card shown is one press that selects
 // it, with the mouse, a tap, or Space or Enter; "Select all shown" adds every Card the board or the archive list shows.
 // The keyboard goes where the reference sends it: to "Select all shown" on entering, to the bar's Archive after it, and
 // back to the select icon when the mode ends.
 const canSelect=!!(p.canCreate&&p.archiveCards&&!p.focus);
 const startSelecting=()=>{ setLeft(null); setSelected(new Map()); setFocusTo({to:'all'}); };
 const flip=(c:{id:number,title:string})=>{ dropAsking(); setSelected(now=>{ if(!now) return now; const next=new Map(now); if(next.has(c.id)) next.delete(c.id); else next.set(c.id,c.title); return next; }); };
 useEffect(()=>{ if(focusTo) ({toggle:selectToggle,all:selectAllButton,act:selectedAct})[focusTo.to].current?.focus(); },[focusTo]);
 // The archive list (#705) is read a page at a time and searched in the database, with the board's Agent and Project
 // filters, as the reference's list follows them; the search opens from its icon while the list is shown.
 const archiveList=useArchivedList(p.company,p.archived?.first??null,{q:archiveQuery,agent:filter==='all'?null:filter,project:project?Number(project):null},p.readArchived,showArchived);
 const archivedShown=archiveList.page?.items||[];
 const archivedCards=[...archivedShown,...(p.archived?.named||[]).filter(c=>!archivedShown.some(shown=>shown.id===c.id))];
 // A count that could not be read is left out, never shown as the rows shown.
 const archivedTotal=p.archived?.total??null;
 useEffect(()=>{ if(archiveSearching) archiveField.current?.focus(); else if(archiveEscaped.current) { archiveEscaped.current=false; archiveSearchButton.current?.focus(); } },[archiveSearching]);
 const firstName=(person:string|null|undefined)=>p.members.find(m=>m.person_id===person)?.people?.name?.trim().split(/\s+/)[0]||'';
 const archivedOf=(c:Card)=>c.archived_at?{by:firstName(c.archived_by),at:date(c.archived_at,language,{month:'short'})}:undefined;
 // A move lands the Card once the server took its place and it is drawn there (#131): from where it was let go after a
 // drop, from 6px above after a key, with the board scrolling to it smoothly.
 const move=(id:number,to:string,before:number|null=null,letGo:{left:number,top:number}|true|null=null,byKeys=false):Promise<boolean>=>{
  const c=p.cards.find(x=>x.id===id); if(!c||!p.canCreate) return Promise.resolve(false);
  const from=columnOfCard(c);
  // "Waiting on you" keeps its own order, newest first, and takes no place by hand (ADR 0013).
  if(from==='waiting'&&to==='waiting') return Promise.resolve(false);
  const why=blockReason(from,to,!!c.wait&&columnOf({...c,wait:null})!=='waiting');
  if(why==='waiting') { toast(t('boardWaitingFillsItself'),{icon:'clock'}); return Promise.resolve(false); }
  if(why==='chat') { toast(t('boardWaitingOnChat'),{icon:'hand'}); router.push(`${base}/board?card=${c.id}`,{scroll:false}); return Promise.resolve(false); }
  if(why==='decide') { toast(t(to==='live'||to==='done'?'boardDecideFirst':'boardWaitingForDecision'),{icon:'hand'}); router.push(`${base}/board?card=${c.id}`,{scroll:false}); return Promise.resolve(false); }
  const form=new FormData(); form.set('company',p.company); form.set('slug',p.slug); form.set('card',String(id)); form.set('column',to); form.set('before',before==null?'':String(before));
  setPlaceError(null); setMoving(true);
  // The answer, not the request, says whether the Card moved: a place the server took is the one the board animates, and
  // a refused one never lands (it stays where it is, with its reason, #168, #174).
  return placeMove(form).then(result=>{
   if('error' in result) { setPlaceError(result.error); focusCard.current={id:0,column:''}; return false; }
   // A move to another column is told with "Undo" for six seconds; a place inside one column says nothing.
   if(to!==from) toast(t('boardMoved',columnName(to)),{action:{label:t('boardUndo'),run:()=>undo(id)}});
   focusCard.current={id,column:to,landing:letGo??byKeys,smooth:byKeys,since:performance.now(),...(to===from?{before}:{})};
   return true;
  },()=>{ setPlaceError(t('couldNotSaveTheChangeCheckPermissionsAnd')); focusCard.current={id:0,column:''}; return false; }).finally(()=>setMoving(false));
 };
 const keys=(c:Card)=>(event:KeyboardEvent)=>{
  if(!event.shiftKey||!p.canCreate) return;
  const column=columnOfCard(c);
  if(event.key==='ArrowUp'||event.key==='ArrowDown') {
   event.preventDefault();
   if(column==='waiting') return;
   const before=placeByOne(inColumn(column).map(card=>card.id),c.id,event.key);
   if(before!==undefined) void move(c.id,column,before,null,true);
   return;
  }
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight') return;
  event.preventDefault();
  const to=keyboardTarget(column,event.key,rtl); if(to) void move(c.id,to,null,null,true);
 };
 const due=(c:Card)=>c.go_live?date(c.go_live,language,{month:'short'}):'';
 const waitingOn=(person:string|null)=>{ const owner=person?p.members.find(m=>m.person_id===person)?.people?.name?.split(' ')[0]:undefined; return owner?t('boardWaitingOn',owner):t('boardWaitingTeam'); };
 // The chat's wait on a Card, as this reader reads it (design-reference: kcardHTML's waiting branch).
 const chatOf=(c:Card)=>chatWait(c,{me:p.me,writer:p.canCreate,approval:p.approvableIds.includes(c.id)});
 const chatBadge=(chat:NonNullable<ReturnType<typeof chatOf>>)=>chat.team?t('boardWaitingTeam'):chat.mine?t('boardWaitingYou'):waitingOn(chat.person);
 // A Card that waits on the reader: its badge shakes once when it starts to (design-reference: syncWaitMarks).
 const yours=(c:Card)=>chatOf(c)?.mine??p.approvableIds.includes(c.id);
 // Read from every Card, not the drawn ones, so a filter that brings a waiting Card back does not shake it again.
 const fresh=useNewlyWaiting(p.cards.filter(c=>columnOfCard(c)==='waiting'&&yours(c)).map(c=>c.id));
 const cardView=(c:Card,isOverlay=false)=>{ const column=columnOfCard(c); const agent=agentOfCard(c); const own=cardAgentOf(c); const crew=(c.crew||[]).flatMap(id=>agentById.get(id)??[]); const names=crew.map(a=>a.name); const job=c.channel_id?t('boardCardChannel'):c.channel||own?.speciality||''; const mine=p.approvableIds.includes(c.id); const chat=chatOf(c); const step=(p.waiting||[]).find(item=>item.kind==='approval'&&item.id===c.id)?.body; const progress=column==='progress'?progressOf(c,p.items):null;
  const brief=stagesIn(column).length>1?stageName(c):[c.hook,c.offering,c.goal].find(Boolean)||'';
 // The line an idea added in the column carries (#188; design-reference: saveIdea's prog): who thought of it. A Card
 // made from a message has its mode and a Card read from the board's data keeps its brief, so neither takes this line.
 const maker=makerOf(c); const from=column==='ideas'&&!brief&&c.assignee_agent&&!c.mode?p.members.find(m=>m.person_id===maker)?.people?.name?.split(' ')[0]:undefined;
 const idea=from?t('boardNewIdeaFrom',from):null;
  const picking=!!selected&&!isOverlay; const chosen=!!selected?.has(c.id);
  return <KanbanCard id={c.id} column={column} isOverlay={isOverlay} key={c.id} disabled={!p.canCreate||!!selected} className={`${mine?'approval-card':''}${picking?' is-sel':''}`} data-mine={mine||undefined} data-stage-id={c.stage_id} data-stage-name={stageName(c)}>
   {c.mode&&<span className="kcard__kind">{modeChip(c)}</span>}
   {picking?<><button type="button" className="authored-title kcard__title kcard__pick" dir="auto" aria-pressed={chosen} onClick={()=>flip(c)}><strong>{c.title}</strong></button><span className="kt-check" aria-hidden="true">{chosen&&<ShellIcon name="check"/>}</span></>
   :<Link className="authored-title kcard__title" dir="auto" href={`${base}/board?card=${c.id}`} scroll={false} draggable={false} tabIndex={isOverlay?-1:undefined} aria-label={crew.length>1?t('boardWorkedOnCard',c.title,names.join(t('boardNamesJoin'))):undefined} aria-describedby="board-drag-hint" aria-keyshortcuts={p.canCreate?'Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown':undefined} onKeyDown={isOverlay?undefined:keys(c)}><strong>{c.title}</strong></Link>}
   {column==='waiting'&&chat?<>
    {chat.kind==='hand'&&<span className="wtag wtag--hand"><ShellIcon name="hand"/>{t('handBadge')}</span>}
    <span className={`badge${chat.mine?' badge--wait':''}${chat.mine&&fresh.has(c.id)?' is-new':''}`}>{chat.mine?<span className="dot dot--waiting" aria-hidden="true"/>:<BoardIcon name="clock"/>}{chatBadge(chat)}</span>
    <span className="kcard__t" dir="auto">{chat.title}</span>
   </>:column==='waiting'?<>
    <span className={`badge${mine?' badge--wait':''}${mine&&fresh.has(c.id)?' is-new':''}`}>{mine?<span className="dot dot--waiting" aria-hidden="true"/>:<BoardIcon name="clock"/>}{mine?t('boardWaitingYou'):waitingOn(c.next_actor)}</span>
    {mine&&step?<span className="kcard__t">{t('boardWaitingYourOk','\u0000').split('\u0000')[0]}<bdi>{step}</bdi>{t('boardWaitingYourOk','\u0000').split('\u0000')[1]}</span>:<span className="kcard__t" dir="auto">{stageName(c)}</span>}
   </>:column==='live'?<>
    <span className="badge badge--live"><span className="dot" aria-hidden="true"/>{t('boardLive')}</span><span className="kcard__t" dir="auto">{stageName(c)}</span>
   </>:progress?<span className="kcard__prog"><span className="kcard__t" dir="auto">{progress.next||stageName(c)} · <span className="num">{progress.pct}%</span></span><span className="bar" role="progressbar" aria-label={t('boardProgress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.pct}><span className="bar__fill" style={{transform:`scaleX(${progress.pct/100})`}}/></span></span>
   :brief?<span className="kcard__t" dir="auto">{brief}</span>:idea?<span className="kcard__t" dir="auto">{idea}</span>:null}
   {crew.length>1&&<span className="kcard__crew"><span className="fstack" aria-hidden="true">{crew.map(a=><AgentFace key={a.id} agent={a.id} size={18}/>)}</span><span className="kcard__crew-t">{t('boardWorkedOn')} {crew.map((a,i)=><Fragment key={a.id}>{i>0&&t('boardNamesJoin')}<bdi>{a.name}</bdi></Fragment>)}</span></span>}
   {own?<ChatCardFoot agent={own} job={job} due={due(c)&&<span className="kcard__due od-nowrap">{due(c)}</span>}/>:<span className="kcard__foot">{agent&&<span className="kcard__agent card-avatars">{letter(agent,18)}<bdi className="od-truncate">{agentName(agent)}</bdi></span>}{job&&<span>{agent?'· ':''}<bdi>{job}</bdi></span>}{due(c)&&<span className="kcard__due od-nowrap">{due(c)}</span>}</span>}
  </KanbanCard>; };
 // A learning suggestion (#25; design-reference: lnRowHTML) is decided where it waits: the rule, its Agent, who told it,
 // and Decline or Make it team-wide.
 const named=(key:string,name:string)=>{ const [before,after]=t(key,'\u0000').split('\u0000'); return <>{before}<bdi>{name}</bdi>{after}</>; };
 // The same with two names, each in its own direction.
 const named2=(key:string,first:string,second:string)=>{ const [before,middle,after]=t(key,'\u0000','\u0001').split(/[\u0000\u0001]/); return <>{before}<bdi>{first}</bdi>{middle}<bdi>{second}</bdi>{after}</>; };
 const ruleView=(item:WaitingItem)=><div key={`${item.kind}:${item.id}`} className="mcard mcard--rule" data-kind={item.kind} role="group" aria-label={t('waitingRuleLabel',item.body,item.asked_by)}>
  <span className="mcard__top"><span className="od-fill mcard__who"><b>{t('waitingRuleKind')}</b></span><span className="mcard__time num">{date(item.created_at,language,{month:'short'})}</span></span>
  <span className="mcard__q" dir="auto">{item.suggestion?.rule??item.title}</span>
  <span className="ln-meta"><span className="ln-who">{item.suggestion?.agent&&<span aria-hidden="true"><AgentFace agent={item.suggestion.agent.id} size={16}/></span>}<bdi>{item.body}</bdi></span><span aria-hidden="true">·</span><span>{named('waitingRuleToldBy',item.asked_by)}</span><span className="badge badge--wait"><span className="dot dot--waiting" aria-hidden="true"/>{t('waitingRuleBadge')}</span></span>
  <form action={decideAgentRule} className="ln-acts"><input type="hidden" name="company" value={p.company}/><input type="hidden" name="slug" value={p.slug}/><input type="hidden" name="item" value={item.id}/>
   <button className="btn btn--secondary btn--sm" name="intent" value="reject">{t('waitingRuleDecline')}</button>
   <button className="btn btn--primary btn--sm" name="intent" value="approve">{t('waitingRuleApprove')}</button></form>
 </div>;
 // A Member's request for an Agent hidden from them (#167; the reference draws no such item): who asks for which Agent,
 // with its face and job, and No or Open it for them. Opening is #15's switch for that Member and that Agent.
 const accessView=(item:WaitingItem)=>{ const first=item.asked_by.trim().split(/\s+/)[0]||item.asked_by;
  return <div key={`${item.kind}:${item.id}`} className="mcard mcard--rule" data-kind={item.kind} role="group" aria-label={t('waitingAccessLabel',item.asked_by,item.title)}>
  <span className="mcard__top"><span className="od-fill mcard__who"><b>{t('waitingAccessKind')}</b></span><span className="mcard__time num">{date(item.created_at,language,{month:'short'})}</span></span>
  <span className="mcard__q" dir="auto">{named2('waitingAccessAsks',item.asked_by,item.title)}</span>
  <span className="ln-meta"><span className="ln-who">{item.agent&&<span aria-hidden="true"><AgentFace agent={item.agent.id} size={16}/></span>}<bdi>{item.title}</bdi></span>{item.body&&<><span aria-hidden="true">·</span><bdi>{item.body}</bdi></>}<span className="badge badge--wait"><span className="dot dot--waiting" aria-hidden="true"/>{t('boardWaitingYou')}</span></span>
  <form action={answerAgentAccess} className="ln-acts"><input type="hidden" name="company" value={p.company}/><input type="hidden" name="slug" value={p.slug}/><input type="hidden" name="request" value={item.id}/>
   <button className="btn btn--secondary btn--sm" name="intent" value="no">{t('waitingAccessNo')}</button>
   <button className="btn btn--primary btn--sm" name="intent" value="open">{named('waitingAccessOpen',first)}</button></form>
 </div>; };
 const lead=identities.find(a=>a.role==='account_manager')?.name||'Lead';
 const decidedHere:Record<string,(item:WaitingItem)=>ReactNode>={
  rule_suggestion:ruleView,
  agent_request:item=><OwnerRequestCard key={`${item.kind}:${item.id}`} slug={p.slug} company={p.company} lead={lead} item={item}/>,
  agent_key:item=><AgentKeyWaitCard key={`${item.kind}:${item.id}`} item={item} slug={p.slug}/>,
  agent_access:accessView,
  agent_change:item=><ChangeBoardCard key={`${item.kind}:${item.id}`} slug={p.slug} company={p.company} item={item} alone={!!p.alone}/>,
 };
 const answeredHere=(item:WaitingItem)=>Object.hasOwn(decidedHere,item.kind);
 // A Member mentioned in a channel (#200) is named by the writer and opens the channel at that message: its initial, the
 // writer and "mentioned you in #channel", with the message cut to three lines and the reader's own name marked, as the
 // channel draws every Member's name.
 const mine=p.members.find(member=>member.person_id===p.me)?.people?.name?.trim()??'';
 const myNames=mine?[mine,mine.split(/\s+/)[0]]:[];
 const marked=(body:string)=>withMention(body,myNames).map((part,index)=>part.mention?<bdi key={index} className="mention">{part.text}</bdi>:<Fragment key={index}>{part.text}</Fragment>);
 const inChannel=(item:WaitingItem)=>item.kind==='channel_mention';
 // A mention (#22) names who wrote the note and on which Card, shows the note and opens it on its Card. A step an Agent
 // handed over (#140; design-reference: waitTagHTML, kcardHTML's waiting branch) is tagged before its title and opens the
 // Conversation at its card. A permission request (#165) names its Agent with its face and opens the Conversation, or
// the channel, at its card. A channel's question or handed step (#149) does the same, in its channel.
 const itemView=(item:WaitingItem)=>answeredHere(item)?decidedHere[item.kind](item):<Link key={`${item.kind}:${item.id}`} className="mcard" data-kind={item.kind} href={chatPlace(p.slug,item)??`${base}/board/${item.card_id}${item.note_id?`#note-${item.note_id}`:''}`}>
  <span className="mcard__top">{inChannel(item)&&<span className="avatar mcard__av" aria-hidden="true">{Array.from(item.asked_by.trim())[0]||'؟'}</span>}<span className="od-fill mcard__who">{item.kind==='question'||item.kind==='channel_question'?<b>{item.asked_by?t('waitingQuestionFrom',item.asked_by):t('waitingQuestion')}</b>:item.kind==='mention'?<><b dir="auto">{item.asked_by}</b> {named('waitingMentionIn',item.title)}</>:inChannel(item)?<><b dir="auto">{item.asked_by}</b> {named('waitingMentionInChannel',`#${!item.title||item.title==='general'?t('shellGeneralChannel'):item.title}`)}</>:item.agent?<span className="ln-who"><span aria-hidden="true"><AgentFace agent={item.agent.id} size={16}/></span><b dir="auto">{item.asked_by}</b></span>:<b dir="auto">{item.asked_by}</b>}</span><span className="mcard__time num">{date(item.created_at,language,{month:'short'})}</span></span>
  {(item.kind==='hand'||item.kind==='channel_hand')&&<span className="wtag wtag--hand"><ShellIcon name="hand"/>{t('handBadge')}</span>}
  <span className="mcard__q od-clamp-3" dir="auto">{item.kind==='mention'?item.body:inChannel(item)?marked(item.body):<>{item.title}{item.body&&<> {item.body}</>}</>}</span>
 </Link>;
 // ---- the Card window (#678; design-reference-card: openCard): every place that opens a Card opens it over the board ----
 const opened=p.opened; const sheetCard=opened&&(p.cards.find(c=>c.id===opened.id)??archivedCards.find(c=>c.id===opened.id));
 const formOf=(op:string,c:Card,more:Record<string,string>={})=>{ const form=new FormData(); for(const [k,v] of Object.entries({op,slug:p.slug,company:p.company,card:String(c.id),view:'sheet',...more})) form.set(k,v); return form; };
 // The status menu moves the Card as a drop does: move_card decides, and a refusal is told in words.
 const moveTo=(c:Card)=>async(column:string)=>{ const form=formOf('move-column',c,{column,before:''});
  const result=await placeMove(form).catch(()=>({error:t('couldNotSaveTheChangeCheckPermissionsAnd')}));
  if('error' in result) { toast(result.error,{icon:'x'}); return false; }
  toast(t('boardMoved',columnName(column)),{action:{label:t('boardUndo'),run:()=>undo(c.id)}}); router.refresh(); return true; };
 // The one way into review until the review is a decision of its own (#681): the Card goes to the review stage, as
 // the Card page's stage list sent it there, and its status follows.
 const reviewStage=p.stages.find(s=>s.board_column==='waiting')?.id;
 const intoReview=(c:Card)=>reviewStage&&p.canCreate?()=>void workAction(formOf('move',c,{stage:String(reviewStage)})).then(()=>router.refresh()):undefined;
 const windowCallout=(c:Card)=>{ const chat=chatOf(c); const mine=p.approvableIds.includes(c.id);
  if(c.wait) return <section className="cw-call cw-call--wait" data-card-section="question"><div className="cw-call__head"><Sym kind="question"/><p className="cw-call__t od-fill" dir="auto">{c.wait.title}</p>
   {chat?.mine&&opened?.made.from==='chat'&&<Link className="btn btn--secondary btn--sm" href={opened.made.href}><ShellIcon name="chat"/><span>{t('cwAnswerInChat')}</span></Link>}</div>
   {!chat?.mine&&<p className="cw-call__s">{chat?chatBadge(chat):waitingOn(c.wait.person)}</p>}</section>;
  if(c.status!=='waiting') return null;
  return <section className="cw-call cw-call--wait" data-card-section="review"><div className="cw-call__head"><Sym kind="review"/><p className="cw-call__t od-fill">{mine?t('boardWaitingYou'):p.canCreate?waitingOn(c.next_actor):t('boardWaitingTeam')}</p></div>
   {c.rejection_reason&&<p className="cw-call__s" dir="auto">{c.rejection_reason}</p>}
   {mine&&<Decision slug={p.slug} company={p.company} card={c.id} workAction={workAction}/>}</section>; };
 // The description's place, until the description is the Card's own Markdown (#679, #680): what the previous Card page
 // held (its marketing fields, its checklist, its labels), read as it is. #684 moves them into the description.
 const windowDescription=(c:Card)=>{ const fields=([['hook',t('hook')],['offering',t('offering')],['segment',t('segment')],['goal',t('goal')],['channel',t('channel')],['format',t('format')],['caption',t('caption')]] as const).filter(([key])=>String(c[key]||'').trim());
  const todos=p.items.filter(i=>i.card_id===c.id); const labels=p.cardLabels.filter(x=>x.card_id===c.id).flatMap(x=>p.labels.find(l=>l.id===x.label_id)??[]);
  if(!fields.length&&!todos.length&&!labels.length) return null;
  const tick=p.canCreate&&!c.archived_at;
  return <>{fields.length>0&&<dl className="cw-kv">{fields.map(([key,label])=><div key={key} className="cw-kv__r"><dt>{label}</dt><dd dir="auto">{String(c[key])}</dd></div>)}</dl>}
   {labels.length>0&&<div className="member-chips">{labels.map(l=><span dir="auto" className="label-chip" style={{borderColor:l.color}} key={l.id}>{l.name}</span>)}</div>}
   {todos.length>0&&<ul className="cw-todos" aria-label={t('checklist')}>{todos.map(i=><li key={i.id}>{tick?<form action={workAction}>{hidden('check')}<input type="hidden" name="card" value={c.id}/><input type="hidden" name="item" value={i.id}/><input type="hidden" name="done" value={String(!i.done)}/><input type="hidden" name="view" value="sheet"/>
    <label dir="auto"><input type="checkbox" checked={i.done} onChange={e=>e.currentTarget.form?.requestSubmit()}/> {i.title}</label></form>:<label dir="auto"><input type="checkbox" checked={i.done} disabled/> {i.title}</label>}</li>)}</ul>}</>; };
 const assignable=p.members.filter(m=>m.role&&m.role!=='viewer');
 const assigneeOf=(c:Card)=>c.assignee_person?`p:${c.assignee_person}`:c.assignee_agent?`a:${c.assignee_agent}`:'';
 const windowView=(c:Card,data:CardWindowData)=>{ const own=cardAgentOf(c);
  const assigneeAgents=[...companyAgents.map(a=>({id:a.id,name:a.name})),...(own&&!companyAgents.some(a=>a.id===own.id)?[{id:own.id,name:own.name}]:[])];
  return <CardWindow key={c.id} slug={p.slug} company={p.company} me={p.me} data={data} canWrite={p.canCreate} alone={!!p.alone} message={p.message}
   card={{id:c.id,title:c.title,status:columnOf({...c,wait:null}),go_live:c.go_live,project_id:c.project_id,assignee:assigneeOf(c),archived:archivedOf(c)}}
   symbol={cardSymbol(c,{me:p.me,working:data.working})} columnName={columnName}
   assignees={{agents:assigneeAgents,people:assignable.map(m=>({id:m.person_id,name:m.people?.name||''}))}}
   people={p.members.filter(member=>member.person_id!==p.me&&member.people?.name).map(member=>({id:member.person_id,name:member.people!.name,role:member.role}))} agents={companyAgents}
   projects={p.projects} send={workAction} save={p.saveCard??(async()=>({error:t('couldNotSaveTheChangeCheckPermissionsAnd')}))} move={moveTo(c)}
   archive={p.archiveCards&&{archive:()=>archive([c.id]),restore:()=>restore([c.id])}}
   callout={windowCallout(c)} description={windowDescription(c)} intoReview={intoReview(c)}/>; };
 const ideasStage=stagesIn('ideas')[0]?.id;
 // "+" on Ideas opens that column's form and a second press closes it (#188); Cancel and Escape come back to it too.
 const closeIdea=()=>{ setAddingIdea(false); addButton.current?.focus({preventScroll:true}); };
 const toggleIdea=()=>{ if(addingIdea) closeIdea(); else setAddingIdea(true); };
 // The reader's own list under the bell (#677): the Cards they can act on, the Cards assigned to them until Live or Done
 // (each stays in its column), the requests waiting for their answer and their mentions; its rows are the count the
 // sidebar shows (approvalQueue's waitingCount).
 const bell=bellRows(p.waiting||[],p.assigned||[]);
 const cardTitle=(id:number|null)=>p.cards.find(c=>c.id===id)?.title;
 const cardHref=(id:number)=>`${base}/board?card=${id}`;
 const elsewhere=(item:WaitingItem)=>chatPlace(p.slug,item)??`/c/${p.slug}/approvals`;
 const bellGroups=[
  {key:'act',label:t('bellAct'),rows:bell.act.map(item=>({key:`act-${item.card_id}`,href:cardHref(item.card_id!),title:cardTitle(item.card_id)||item.title}))},
  {key:'assigned',label:t('bellAssigned'),rows:bell.assigned.map(c=>({key:`asg-${c.id}`,href:cardHref(c.id),title:c.title,sub:columnName(c.status)}))},
  {key:'requests',label:t('bellRequests'),rows:bell.requests.map(item=>({key:`rq-${item.kind}-${item.id}`,href:elsewhere(item),title:item.title||item.body,sub:item.asked_by||undefined}))},
  {key:'mentions',label:t('bellMentions'),rows:bell.mentions.map(item=>({key:`mn-${item.kind}-${item.id}`,href:item.kind==='mention'&&item.card_id?cardHref(item.card_id):elsewhere(item),title:(item.kind==='mention'&&cardTitle(item.card_id))||item.title||item.body,sub:item.asked_by||undefined}))},
 ];
 const bellCount=bellGroups.reduce((total,group)=>total+group.rows.length,0);
 const views=<div className="work-toolbar" data-canonical-toolbar="work"><nav className="tabs segmented" aria-label={t('boardViews')}>{[['board',t('board')],['calendar',t('calendar')],['list',t('list')]].map(([path,label])=><Link key={path} data-slot="button" data-active={p.section===`work/${path}`&&!p.focus} aria-current={p.section===`work/${path}`&&!p.focus?'page':undefined} className={`button ${p.section===`work/${path}`&&!p.focus?'active':''}`} href={`${base}/${path}`}>{label}</Link>)}</nav>{p.canCreate&&<button className="btn btn--primary btn--sm" data-slot="button" data-toolbar-primary onClick={()=>setComposing(true)}>{t('newCardAction')}</button>}</div>;
 const head=<header className="page-head"><div className="od-field"><h1 className="page-title">{t('marketingBoard')}</h1><p className="page-sub">{t('boardSubtitle')}</p><p className="sr-only" id="board-drag-hint">{t('boardDragHint')}</p></div>{views}</header>;
 // The Month filter's choices (#453): every month a Card is dated in, newest first, and the month already chosen even
 // when no Card is in it, so an empty filter reads "All months" in the board's own style, never the browser's raw
 // month placeholder. The Calendar keeps its month picker, which always has a month.
 const monthOptions=useMemo(()=>{const found=new Set(p.cards.flatMap(c=>c.go_live?[c.go_live.slice(0,7)]:[])); if(month) found.add(month); return [...found].sort().reverse();},[p.cards,month]);
 const monthSelect=<select data-toolbar-control aria-label={t('month')} disabled={!hydrated} value={month} onChange={e=>setMonth(e.target.value)}><option value="">{t('allMonths')}</option>{monthOptions.map(value=><option key={value} value={value}>{new Date(Number(value.slice(0,4)),Number(value.slice(5,7))-1,1).toLocaleDateString(locale,{month:'long',year:'numeric'})}</option>)}</select>;
 const boardFilters=<div className="work-filters" data-canonical-toolbar="work-filters"><label>{t('month')}{' '}{monthSelect}</label>{p.projects.length>0&&<label>{t('project')}{' '}<select data-toolbar-control aria-label={t('project')} disabled={!hydrated} value={project} onChange={e=>setProject(e.target.value)}><option value="">{t('allProjects')}</option>{p.projects.map(pr=><option dir="auto" key={pr.id} value={pr.id}>{pr.name}</option>)}</select></label>}</div>;
 const board=<div className={`board-view${p.focus?' approvals':''}`} data-focus={p.focus}>
  {head}
  <div className="board-tools">
   <div className="segmented kind-seg" role="group" aria-label={t('boardCardType')}>
    <button type="button" aria-pressed={kind==='all'} onClick={()=>setKind('all')}><span>{t('boardAll')}</span></button>
    <button type="button" aria-pressed={kind==='mkt'} onClick={()=>setKind('mkt')}><span>{t('boardMarketing')}</span><span className="num kind-seg__n">{visible.length}</span></button>
    <button type="button" aria-disabled="true" title={t('soon')}><BoardIcon name="code"/><span>{t('boardCode')}</span><span className="num kind-seg__n">{0}</span></button>
   </div>
   <div className="od-rail" role="group" aria-label={t('boardFilterByAgent')}>
    <button type="button" className="chip chip--plain" aria-pressed={filter==='all'} onClick={()=>setAgentFilter('all')}>{t('boardAll')}</button>
    {companyAgents.map(a=><button type="button" key={a.id} className="chip" aria-pressed={filter===a.id} onClick={()=>setAgentFilter(a.id)}><span className="chip__face" aria-hidden="true"><AgentFace agent={a.id} size={22}/></span><bdi>{a.name}</bdi></button>)}
   </div>
   {boardFilters}
   {p.archived&&!p.focus&&showArchived&&(archiveSearching||archiveQuery?<div className="bt-search is-open"><ShellIcon name="search"/><label className="sr-only" htmlFor="bf-q">{t('boardSearchArchived')}</label>
    <input ref={archiveField} type="search" id="bf-q" autoComplete="off" dir="auto" placeholder={t('boardSearchArchived')} value={archiveQuery} maxLength={200} onChange={e=>setArchiveQuery(e.target.value)}
     onBlur={()=>{ if(!archiveQuery) setArchiveSearching(false); }} onKeyDown={e=>{ if(e.key==='Escape'&&!archiveQuery) { e.preventDefault(); archiveEscaped.current=true; setArchiveSearching(false); } }}/></div>
    :<button ref={archiveSearchButton} type="button" className="ib" aria-label={t('boardSearchArchived')} title={t('boardSearchArchived')} onClick={()=>setArchiveSearching(true)}><ShellIcon name="search"/></button>)}
   {p.archived&&!p.focus&&<button type="button" className="ib" aria-pressed={showArchived} aria-label={archivedTotal==null?t('boardArchived'):t('boardArchivedCount',archivedTotal)} title={t('boardArchived')} onClick={()=>{ setShowArchived(!showArchived); setArchiveQuery(''); setArchiveSearching(false); dropAsking(); setSelected(null); }}><ShellIcon name="archive"/>{showArchived&&archivedTotal!=null&&<span className="num">{archivedTotal}</span>}</button>}
   {canSelect&&!selected&&<button ref={selectToggle} type="button" className="ib" aria-label={t('boardSelectCards')} title={t('boardSelectCards')} onClick={startSelecting}><ShellIcon name="multiSel"/></button>}
   <span className="board-tools__summary">{!p.canCreate?<><BoardIcon name="eye"/>{t('boardReadOnly')}</>:bell.assigned.length?<><span className="dot dot--waiting" aria-hidden="true"/>{t('thingsWaitingOnYou',bellCount)}</>:waitingTotal?<><span className="dot dot--waiting" aria-hidden="true"/>{(p.waiting||[]).some(item=>item.kind!=='approval')?t('thingsWaitingOnYou',waitingTotal):t(waitingTotal>1?'boardWaitingMany':'boardWaitingOne',waitingTotal)}</>:<><BoardIcon name="check"/>{t('boardNothingWaiting')}</>}</span>
   {p.canCreate&&<WaitingBell label={t('bellLabel',bellCount)} count={bellCount} groups={bellGroups} empty={t('bellEmpty')}/>}
   <BoardPager/>
  </div>
  {selected&&<div className="bsel" role="region" aria-label={t('boardSelecting')}>
   <span className="bsel__n" aria-live="polite">{t('boardSelectedCount','\u0000').split('\u0000')[0]}<b className="num">{selected.size}</b>{t('boardSelectedCount','\u0000').split('\u0000')[1]}</span>
   <button ref={selectAllButton} type="button" className="link-btn" onClick={()=>{ dropAsking(); const shownNow=showArchived?archivedShown:boardColumns.flatMap(inColumn); setSelected(now=>{ const next=new Map(now); for(const c of shownNow) next.set(c.id,c.title); return next; }); setFocusTo({to:'act'}); }}>{t('boardSelectAllShown')}</button>
   <span className="od-fill"/>
   <button type="button" className="btn btn--secondary btn--sm" onClick={endSelecting}>{t('cancel')}</button>
   <button ref={selectedAct} type="button" className="btn btn--primary btn--sm" disabled={!selected.size} onClick={()=>{ const ids=[...selected.keys()]; if(showArchived) restore(ids); else archive(ids); }}><ShellIcon name={showArchived?'restore':'archive'}/><span>{t(showArchived?'boardRestoreSelected':'boardArchiveSelected')}</span></button>
  </div>}
  {left&&<p role="alert" className="work-error bsel-left">{leftLine(left)}</p>}
  {moving&&<p role="status" className="board-status">{t('movingCard')}</p>}
  {showArchived&&<div className="arch">{archivedShown.length?<ul className="panel-card arch-list" aria-label={t('boardArchivedCards')}>{archivedShown.map(c=>{ const own=cardAgentOf(c); const agent=agentOfCard(c); const at=archivedOf(c);
   return <li key={c.id} className="arch-row">{selected&&<button type="button" className="sel-box" role="checkbox" aria-checked={selected.has(c.id)} aria-label={t('boardSelectCard',c.title)} onClick={()=>flip(c)}><span>{selected.has(c.id)&&<ShellIcon name="check"/>}</span></button>}<Link className="arch-open" href={`${base}/board?card=${c.id}`} scroll={false}>
    {own?<span aria-hidden="true"><AgentFace agent={own.id} size={24}/></span>:agent?<span aria-hidden="true">{letter(agent,24)}</span>:<span className="arch-none" aria-hidden="true"/>}
    <span className="od-field"><span className="arch-t authored-title" dir="auto">{c.title}</span><span className="arch-d">{columnName(columnOfCard(c))} · <bdi>{at?.by}</bdi> · <span className="num">{at?.at}</span></span></span></Link>
    {p.canCreate&&p.archiveCards&&!selected&&<button type="button" className="ib" aria-label={t('boardRestoreCard',c.title)} title={t('cardRestoreShort')} onClick={()=>restore([c.id])}><ShellIcon name="restore"/></button>}</li>; })}</ul>
   :!archiveList.page?<p className="col-empty arch-empty" role="alert"><b>{t('boardArchivedFailed')}</b></p>
   :<div className="col-empty arch-empty"><b>{t(archiveList.searched?'boardArchivedNoMatch':'boardArchivedEmpty')}</b></div>}
   {archiveList.page?.next&&<button type="button" className="btn btn--secondary btn--sm arch-more" aria-busy={archiveList.loading||undefined} disabled={archiveList.loading||!archiveList.settled}
    onClick={()=>void archiveList.more().then(answer=>{ if(answer==='failed') toast(t('boardArchivedFailed'),{icon:'x'}); })}>{t('boardArchivedMore')}</button>}</div>}
  {!showArchived&&!p.cards.length&&!items.length&&<div className="board-bare" role="note"><p>{t('boardEmpty',identities.find(a=>a.role==='account_manager')?.name||'Lead')}</p>{p.canCreate&&<Link className="btn btn--secondary btn--sm" href={`/c/${p.slug}/chat`}><BoardIcon name="chat"/><span>{t('boardTalkTo',identities.find(a=>a.role==='account_manager')?.name||'Lead')}</span></Link>}</div>}
  {!showArchived&&<KanbanBoard label={t('workBoard')} busy={moving} cards={boardColumns.flatMap(column=>inColumn(column)).map(c=>({id:c.id,title:c.title,column:columnOfCard(c)}))} columnName={columnName} renderOverlay={id=>cardView(p.cards.find(card=>card.id===id)!,true)} onMove={move}>
   {boardColumns.map(column=>{ const list=inColumn(column); const extra=column==='waiting'&&!ownList?items:[]; const stages=stagesIn(column);
    // Mentions of the reader (#22 in a note, #200 in a channel) wait apart from what needs their reply.
    const groups=[{id:'mn-h-mentions',label:'waitingMentions',items:extra.filter(item=>item.kind==='mention'||item.kind==='channel_mention')},{id:'mn-h',label:'waitingNeedsReply',items:extra.filter(item=>item.kind!=='mention'&&item.kind!=='channel_mention'&&!answeredHere(item))}].filter(group=>group.items.length);
    if(column==='waiting'&&ownList) {
     // The reader's own list: everything the mentions name first, under "Mentions of you" with its count, then what needs
     // their reply, as the board's column draws it (design-reference: mentionGroupHTML above the Cards).
     const mentions=ownEntries.filter(entry=>!entry.card&&(entry.item.kind==='mention'||entry.item.kind==='channel_mention'));
     const replies=ownEntries.filter(entry=>!mentions.includes(entry));
     return <KanbanColumn key={column} column={column} id={`col-${column}-section`} name={columnName(column)} count={ownEntries.length} waiting head={null}>
      {mentions.length>0&&<div className="mn-group" role="group" aria-labelledby="mn-h-own"><h3 className="mn-h" id="mn-h-own"><BoardIcon name="at"/><span>{t('waitingMentions')}</span> <span className="num">{mentions.length}</span></h3>{mentions.map(entry=>itemView(entry.item))}{replies.length>0&&<div className="mn-sep" role="separator"/>}</div>}
      {replies.map(entry=>entry.card?<div key={`approval:${entry.card.id}`} className="column" data-stage-id={entry.card.stage_id} data-stage-name={stageName(entry.card)}>{cardView(entry.card)}</div>:itemView(entry.item))}
      {!ownEntries.length&&<div className="col-empty"><b>{t(emptyKey[column][0])}</b>{emptyKey[column][1]&&<span>{t(emptyKey[column][1])}</span>}</div>}
     </KanbanColumn>;
    }
    const archiveAll=column==='done'&&canSelect&&!selected&&list.length?<button type="button" className="ib ib--sm col__act" aria-label={t('boardArchiveDone',columnName(column))} title={t('boardArchiveAll')} onClick={()=>archive(list.map(c=>c.id))}><ShellIcon name="archive"/></button>:null;
    const add=column==='ideas'&&p.canCreate&&ideasStage&&!selected?<button ref={addButton} type="button" className="circle-btn add-btn add-card" aria-label={t('boardAddIdea')} title={t('boardAddIdea')} aria-expanded={addingIdea} onClick={toggleIdea}><BoardIcon name="plus"/></button>:null;
    return <KanbanColumn key={column} column={column} id={`col-${column}-section`} name={columnName(column)} count={list.length+extra.length} waiting={column==='waiting'} head={add??archiveAll} data-stage-name={stages.length===1?stages[0].name:undefined}>
     {extra.filter(answeredHere).map(itemView)}
     {groups.map((group,n)=><div key={group.id} className="mn-group" role="group" aria-labelledby={group.id}><h3 className="mn-h" id={group.id}><BoardIcon name="at"/><span>{t(group.label)}</span> <span className="num">{group.items.length}</span></h3>{group.items.map(itemView)}{(list.length>0||n<groups.length-1)&&<div className="mn-sep" role="separator"/>}</div>)}
     {column==='ideas'&&addingIdea&&ideasStage&&<AddIdea company={p.company} slug={p.slug} stage={ideasStage} agents={companyAgents} preferred={filter==='all'?'':filter} addIdea={p.addIdea} onClose={closeIdea}/>}
     {list.map(c=><div key={c.id} className="column" data-stage-id={c.stage_id} data-stage-name={stageName(c)}>{cardView(c)}</div>)}
     {!list.length&&!extra.length&&!(column==='ideas'&&addingIdea)&&<div className="col-empty"><b>{t(emptyKey[column][0])}</b>{emptyKey[column][1]&&<span>{t(emptyKey[column][1])}</span>}</div>}
    </KanbanColumn>; })}
  </KanbanBoard>}
 </div>;
 return <div className="work-root">{(placeError||p.message)&&!sheetCard&&<p role="alert" className="work-error">{placeError||p.message}</p>}<>{p.section==='settings/work'?<div className="tabs"><Link className="button" href={`/c/${p.slug}/settings`}>{t('general')}</Link><Link className="button" href={`/c/${p.slug}/settings/members`}>{t('members')}</Link><Link className="button active" href={`/c/${p.slug}/settings/work`}>{t('work')}</Link></div>:null}{p.section==='settings/work'&&<section className="panel"><h2>{t('workStages')}</h2>{p.stages.map(s=><form action={workAction} className="settings-row" key={s.id}>{hidden('stage-settings')}<input type="hidden" name="stage" value={s.id}/><input dir="auto" aria-label={t('stageName', s.name)} name="name" defaultValue={s.name}/><input aria-label={t('stageOrder', s.name)} name="position" type="number" defaultValue={s.position}/><button>{t('save')}</button></form>)}<h2>{t('labels')}</h2>{p.labels.map(l=><form action={workAction} className="settings-row" key={l.id}>{hidden('label-settings')}<input type="hidden" name="label" value={l.id}/><input dir="auto" aria-label={t('labelName', l.name)} name="name" defaultValue={l.name}/><input dir="auto" aria-label={t('labelColor', l.name)} name="color" type="color" defaultValue={l.color}/><button>{t('save')}</button></form>)}</section>}
  {p.section==='work/board'&&board}
  {(p.section==='work/list'||p.section==='work/calendar')&&<div className="board-view board-view--page">{head}<div className="board-body"><div className="work-filters" data-canonical-toolbar="work-filters"><label>{t('month')}{' '}{p.section==='work/calendar'?<input data-toolbar-control type="month" disabled={!hydrated} value={month} onChange={e=>setMonth(e.target.value||new Date().toISOString().slice(0,7))}/>:monthSelect}</label>{p.projects.length>0&&p.section!=='work/calendar'&&<label>{t('project')}{' '}<select data-toolbar-control aria-label={t('project')} disabled={!hydrated} value={project} onChange={e=>setProject(e.target.value)}><option value="">{t('allProjects')}</option>{p.projects.map(pr=><option dir="auto" key={pr.id} value={pr.id}>{pr.name}</option>)}</select></label>}</div>{p.section==='work/list'&&<TaskList emptyMessage={!visible.length?t('noCardsToDisplay'):undefined}><thead><tr>{[['title',t('title')],['stage_id',t('stageField')],['channel',t('channel')],['go_live',t('publishingDate')],['assignee',t('assignee')]].map(([key,label])=><th key={key} aria-sort={sort===key?direction:undefined}><button onClick={()=>{if(sort===key) setDirection(direction==='ascending'?'descending':'ascending'); else {setSort(key);setDirection('ascending');}}}>{label} ↕</button></th>)}</tr></thead><tbody dir="auto">{sortWorkCards(visible,sort,direction,p.stages,p.members,companyAgents).map(c=><TaskListRow key={c.id}><td><AuthoredTitle href={`${base}/board?card=${c.id}`}>{c.title}</AuthoredTitle></td><td dir="auto">{p.stages.find(s=>s.id===c.stage_id)?.name}</td><td dir="auto">{c.channel}</td><td>{date(c.go_live,language)}</td><td dir="auto">{c.assignee_person?<><Avatar id={c.assignee_person} members={p.members} nameVisible/> <span>{p.members.find(m=>m.person_id===c.assignee_person)?.people?.name}</span></>:cardAgentOf(c)?<bdi>{cardAgentOf(c)?.name}</bdi>:null}</td></TaskListRow>)}</tbody></TaskList>}{p.section==='work/calendar'&&<div className="panel calendar-wrap"><h2 className="calendar-title">{month&&new Date(Number(month.slice(0,4)),Number(month.slice(5,7))-1,1).toLocaleDateString(locale,{month:'long',year:'numeric'})}</h2>{!p.cards.some(c=>c.go_live?.startsWith(month))&&<p className="empty-column">{t('noCardsThisMonth')}</p>}<div className="calendar">{[t('sunday'),t('monday'),t('tuesday'),t('wednesday'),t('thursday'),t('friday'),t('saturday')].map(d=><div className="day calendar-heading" key={d}>{d}</div>)}{Array.from({length:new Date(Number(month.slice(0,4)),Number(month.slice(5,7))-1,1).getDay()},(_,i)=><div className="day" key={`empty-${i}`}/>)}{Array.from({length:new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()},(_,i)=><div className="day" key={i}>{i+1}{p.cards.filter(c=>c.go_live&&new Date(c.go_live).getUTCDate()===i+1&&c.go_live.startsWith(month)).map(c=><AuthoredTitle key={c.id} href={`${base}/board?card=${c.id}`}>{c.title}</AuthoredTitle>)}</div>)}</div></div>}</div></div>}
 </>{composing&&<Suspense fallback={<div className="navigation-progress" role="progressbar" aria-label={t('openingPage')}/>}><NewCard slug={p.slug} company={p.company} agents={p.agents} members={p.members} stage={0} fromRoute={p.initialCreating} workAction={workAction} onClose={()=>setComposing(false)}/></Suspense>}
  {opened&&sheetCard&&windowView(sheetCard,opened)}{confirming&&<ArchiveConfirm stops={confirming.stops} heading={confirming.cards.length>1?t('archiveConfirmMany',confirming.cards.length):t('archiveConfirmOne')} confirm={()=>{ const chosen=confirming.cards; setConfirming(null); archiveNow(chosen); }} cancel={()=>setConfirming(null)}/>}</div>;
}
