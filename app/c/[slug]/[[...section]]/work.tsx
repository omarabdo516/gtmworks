'use client';
import { messages } from '@/lib/i18n.mjs';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { AuthoredTitle } from '@/lib/authored-title';
import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { BoardPager, KanbanBoard, KanbanCard, KanbanColumn, land } from '@/components/paperclip/KanbanBoard';
import { TaskList, TaskListRow } from '@/components/paperclip/TaskList';
import { BoardIcon } from '@/components/board-icon';
import { ShellIcon } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { CardDialog } from '@/app/card-dialog';
import { CardSheet, type CardSheetData } from '@/app/card-sheet';
import { toast } from '@/app/toast';
import { roleAgents } from '@/lib/role-agents';
import { useAgentIdentities } from '@/lib/agent-identities-client';
const NewCard=lazy(()=>import('./new-card'));
import AddIdea from './add-idea';
import { ChatCardFoot, useShowCard, type CardAgent } from './board-show';
import { decideAgentRule } from './skill-actions';
import { OwnerRequestCard } from './agent-request-card';
import { AgentKeyWaitCard } from './agent-key-wait-card';
import { Decision } from './decision';
import { ActivityRow, Avatar, isMessage, MessageRow, NoteReplyRow, type WorkActivity, type WorkAttachment, type WorkMember, MemberPicker } from '@/lib/work-activity';
import { NoteText, type EditableNote } from '@/app/note-edit';
import { workDate as date } from '@/lib/work-date.mjs';
import { sortWorkCards } from '@/lib/work-sort.mjs';
import { boardColumns, blockReason, cardAgent, chatPlace, chatWait, columnLabel, columnOf, keyboardTarget, onCard, orderColumn, placeByOne, progressOf, type CardWait } from '@/lib/board-columns.mjs';
import { useNewlyWaiting } from '@/lib/newly-waiting';
import type { WaitingItem } from '@/lib/approval-queue';
import '@/app/board.css';
type Stage={id:number,name:string,position:number,board_column?:string|null}; type Label={id:number,name:string,color:string}; type Card={id:number,title:string,stage_id:number,channel:string,format:string,go_live:string|null,offering:string,segment:string,hook:string,goal:string,caption:string,next_actor:string|null,mode:string|null,approval_step_id:number|null,rejection_reason:string|null,project_id:number|null,agent_id?:string|null,crew?:string[],wait?:CardWait|null,board_order?:number|null,created_at?:string|null}; type Project={id:number,name:string}; type Item={id:number,card_id:number,title:string,done:boolean}; type Person=WorkMember & {agent_role?:string|null}; type Activity=WorkActivity; type Creative={id:number,card_id:number,name:string}; type Version={id:number,creative_id:number,path:string,url:string|null}; type CL={card_id:number,label_id:number};
// An open Card's notes (#22): each note's current text, the Runs its Agent mentions started and their replies in the
// log, the Agents those are drawn with, the reader and the moment the page was drawn (for the edit countdown).
type CardNotes={me:string,drawnAt:number,comments:EditableNote[],runs:{note_id:number,agent_id:string,agent_name:string,outcome:string|null}[],replies:{reply_to:number,actor_id:string,actor_name:string|null,body:string,created_at:string}[],agents:{id:string,name:string,connection_id:string}[]};
// workAction is the board's server action (work-actions.ts), handed in so this client file never imports the server module.
export type WorkAction=(form:FormData)=>Promise<void>;
// "Undo" on a move (#168): the server's answer, and nothing else, decides whether the Card went back.
type UndoResult={state:'undone',column:string}|{state:'gone'}|{state:'refused'};
export type UndoMove=(form:FormData)=>Promise<UndoResult>;
// A place (#174) is answered in place: the board keeps its Cards and says in words why the Card stayed where it is.
export type PlaceResult={ok:true}|{error:string};
export type PlaceCard=(form:FormData)=>Promise<PlaceResult>;
export type WorkProps={workAction:WorkAction,placeMove:PlaceCard,undoMove:UndoMove,me:string,slug:string,company:string,section:string,cardId?:number,stages:Stage[],labels:Label[],cards:Card[],items:Item[],members:Person[],activity:Activity[],creatives:Creative[],versions:Version[],cardLabels:CL[],projects:Project[],assignees:{card_id:number,person_id:string}[],message?:string,approvableIds:number[],agents:{person_id:string,role:string,granted:boolean}[],canCreate:boolean,initialCreating:boolean,attachments:WorkAttachment[],waiting?:WaitingItem[],focus?:'waiting',alone?:boolean,notes?:CardNotes,sheet?:CardSheetData,show?:number,ideaAdded?:boolean,ruleDecision?:{approve:boolean,agent:string},cardAgents?:CardAgent[]};
const emptyKey:Record<string,[string,string]>={waiting:['boardEmptyWaiting','boardEmptyWaitingHint'],ideas:['boardEmptyIdeas','boardEmptyIdeasHint'],planned:['boardEmptyPlanned','boardEmptyPlannedHint'],progress:['boardEmptyProgress','boardEmptyProgressHint'],live:['boardEmptyLive','boardEmptyLiveHint'],done:['boardEmptyDone','']};
export default function Work(p:WorkProps) { const {workAction,placeMove,undoMove}=p; const {t,locale,language}=useI18n(); const router=useRouter(); const identities=useAgentIdentities();
 // A change-only form cannot submit before React attaches its handler.
 const hydrated=useSyncExternalStore(()=>()=>{},()=>true,()=>false);
 const [moving,setMoving]=useState(false); const [placeError,setPlaceError]=useState<string|null>(null); const focusCard=useRef<{id:number,column:string,landing?:boolean}>({id:0,column:''}); const [agentFilter,setAgentFilter]=useState('all'); const [kind,setKind]=useState<'all'|'mkt'>('all'); const [month,setMonth]=useState(p.section==='work/calendar'?new Date().toISOString().slice(0,7):''); const [composing,setComposing]=useState(p.initialCreating && p.canCreate); const [addingIdea,setAddingIdea]=useState(false); const addButton=useRef<HTMLButtonElement>(null); const [project,setProject]=useState(''); const [sort,setSort]=useState('title'); const [direction,setDirection]=useState<'ascending'|'descending'>('ascending');
 const base=`/c/${p.slug}/work`; const card=p.cards.find(c=>c.id===p.cardId); const shown=p.cards.filter(c=>!project||String(c.project_id)===project); const visible=shown.filter(c=>!month||!c.go_live||c.go_live.slice(0,7)===month); const hidden=(op:string)=><><input type="hidden" name="op" value={op}/><input type="hidden" name="slug" value={p.slug}/><input type="hidden" name="company" value={p.company}/></>;
 if(card&&composing) setComposing(false);
 // A card made from a message is marked with its mode, in the colour of the agent it was sent to.
 const modeChip=(c:Card)=>{ if(!c.mode) return null; const role=p.assignees.filter(x=>x.card_id===c.id).map(x=>p.agents.find(a=>a.person_id===x.person_id)?.role).find(Boolean); const color=roleAgents.find(r=>r.key===role)?.color; return <span className="mode-chip" data-mode={c.mode} style={{borderColor:color}}><i style={{background:color}}/>{c.mode==='plan'?t('modePlan'):c.mode==='do'?t('modeDo'):t('modeAnswer')}</span>; };
 // ---- the board (ADR 0013): six columns over the stages, "Waiting on you" first ----
 const rtl=language==='ar';
 const columnName=(column:string)=>t(columnLabel(column,p.canCreate));
 const agentIds=new Set([...p.agents.map(a=>a.person_id),...identities.map(a=>a.id)]);
 const agentName=(id:string)=>identities.find(a=>a.id===id)?.name||p.members.find(m=>m.person_id===id)?.people?.name||'';
 const agentRole=(id:string)=>identities.find(a=>a.id===id)?.role||p.agents.find(a=>a.person_id===id)?.role||p.members.find(m=>m.person_id===id)?.agent_role||'account_manager';
 const columnOfCard=(c:Card)=>columnOf(c,p.stages);
 // A card's Agent: its assigned Agent, else the Agent that made it (a card an Agent filed through the API). The person
 // who added an idea is the writer of its own log row (#188), so the Card can say "New idea from …".
 const makerOf=(c:Card)=>p.activity.find(a=>a.card_id===c.id&&(a.action==='card_created'||a.action==='idea_added'))?.actor_id;
 const agentOfCard=(c:Card)=>{ const creator=makerOf(c); return cardAgent(c,p.assignees,agentIds)??(creator&&agentIds.has(creator)?creator:null); };
 // The chips are the Company's Agents the reader sees, in the sidebar's order (#190); a Card is under its own Agent's.
 const companyAgents=p.cardAgents||[];
 const agentById=useMemo(()=>new Map((p.cardAgents||[]).map(a=>[a.id,a])),[p.cardAgents]);
 const cardAgentOf=(c:Card)=>c.agent_id?agentById.get(c.agent_id):undefined;
 // A filter on an Agent the reader no longer sees reads as All (design-reference: 5741).
 const filter=companyAgents.some(a=>a.id===agentFilter)?agentFilter:'all';
 const asked=p.show?p.cards.find(c=>c.id===p.show):undefined;
 useShowCard(p.show,{hides:!!asked&&filter!=='all'&&asked.agent_id!==filter,showAll:()=>setAgentFilter('all'),board:`${base}/board`});
 // The board keeps the month filter of the dated views: a card dated in another month is hidden, an undated one stays.
 const boardCards=visible.filter(c=>filter==='all'||c.agent_id===filter);
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
 // After a move the card is drawn again in its new column; the keyboard stays on it. A Card put back by "Undo" (#168)
 // lands in its old column with the reference's short motion (design-reference: undoMove's focus and land).
 useEffect(()=>{ const {id,column,landing}=focusCard.current; if(!id) return; const link=document.querySelector<HTMLElement>(`#board-cols [data-column="${column}"] .kcard[data-card-id="${id}"] a`); if(link) { link.focus({preventScroll:true}); link.scrollIntoView({block:'nearest',inline:'nearest'}); if(landing) land(link.closest('.kcard')); focusCard.current={id:0,column:''}; } });
 // The Inbox opens the board on "Waiting on you".
 // While an Agent called in a note is still working, the Card reads itself again so its reply shows when it lands (#22).
 const agentWorking=!!p.notes?.runs.some(run=>!run.outcome);
 useEffect(()=>{ if(!agentWorking) return; const timer=setInterval(()=>router.refresh(),3000); return ()=>clearInterval(timer); },[agentWorking,router]);
 useEffect(()=>{ if(p.focus==='waiting') document.querySelector('#board-cols > [data-column="waiting"]')?.scrollIntoView({block:'nearest',inline:'nearest'}); },[p.focus]);
 // An idea just added comes back on the board with the card it made (#188): the reference confirms it with a toast,
 // while useShowCard flashes that Card and puts the focus on it.
 useEffect(()=>{ if(p.ideaAdded) toast(t('ideaAdded')); },[p.ideaAdded,t]);
 // A decided learning suggestion comes back to the board with its outcome in the address (#169): the item has left the
 // list, and the toast names the Agent it was for. Shown once; a reload does not say it again.
 useEffect(()=>{ if(!p.ruleDecision) return;
  toast(t(p.ruleDecision.approve?'waitingRuleDecidedTeamWide':'waitingRuleDecidedDeclined',p.ruleDecision.agent),{icon:p.ruleDecision.approve?'check':'x'});
  const url=new URL(location.href); url.searchParams.delete('decided'); url.searchParams.delete('agent');
  history.replaceState(history.state,'',url.pathname+url.search+url.hash);
 },[p.ruleDecision,t]);
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
 const move=(id:number,to:string,before:number|null=null)=>{
  const c=p.cards.find(x=>x.id===id); if(!c||!p.canCreate) return;
  const from=columnOfCard(c);
  // "Waiting on you" keeps its own order, newest first, and takes no place by hand (ADR 0013).
  if(from==='waiting'&&to==='waiting') return;
  const why=blockReason(from,to,!!c.wait&&columnOf({...c,wait:null},p.stages)!=='waiting');
  if(why==='waiting') { toast(t('boardWaitingFillsItself'),{icon:'clock'}); return; }
  if(why==='chat') { toast(t('boardWaitingOnChat'),{icon:'hand'}); router.push(`${base}/board/${c.id}`); return; }
  if(why==='decide') { toast(t(to==='live'||to==='done'?'boardDecideFirst':'boardWaitingForDecision'),{icon:'hand'}); router.push(`${base}/board/${c.id}`); return; }
  const form=new FormData(); form.set('company',p.company); form.set('slug',p.slug); form.set('card',String(id)); form.set('column',to); form.set('before',before==null?'':String(before));
  setPlaceError(null); setMoving(true);
  void placeMove(form).then(result=>{
   // A refused place (#168, #174): the board stays as it is and says why; a place the server took draws the Card again.
   if('error' in result) { setPlaceError(result.error); focusCard.current={id:0,column:''}; return; }
   // A move to another column is told with "Undo" for six seconds; a place inside one column says nothing.
   if(to!==from) toast(t('boardMoved',columnName(to)),{action:{label:t('boardUndo'),run:()=>undo(id)}});
   focusCard.current={id,column:to};
   requestAnimationFrame(()=>land(document.querySelector<HTMLElement>(`#board-cols .kcard[data-card-id="${id}"]`)));
  }).finally(()=>setMoving(false));
 };
 const keys=(c:Card)=>(event:KeyboardEvent)=>{
  if(!event.shiftKey||!p.canCreate) return;
  const column=columnOfCard(c);
  if(event.key==='ArrowUp'||event.key==='ArrowDown') {
   event.preventDefault();
   if(column==='waiting') return;
   const before=placeByOne(inColumn(column).map(card=>card.id),c.id,event.key);
   if(before!==undefined) move(c.id,column,before);
   return;
  }
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight') return;
  event.preventDefault();
  const to=keyboardTarget(column,event.key,rtl); if(to) move(c.id,to);
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
 const cardView=(c:Card,isOverlay=false)=>{ const column=columnOfCard(c); const agent=agentOfCard(c); const own=cardAgentOf(c); const crew=(c.crew||[]).flatMap(id=>agentById.get(id)??[]); const names=crew.map(a=>a.name); const job=c.channel||own?.speciality||''; const mine=p.approvableIds.includes(c.id); const chat=chatOf(c); const step=(p.waiting||[]).find(item=>item.kind==='approval'&&item.id===c.id)?.body; const progress=column==='progress'?progressOf(c,p.items):null;
  const brief=stagesIn(column).length>1?stageName(c):[c.hook,c.offering,c.goal].find(Boolean)||'';
 // The line an idea added in the column carries (#188; design-reference: saveIdea's prog): who thought of it. A Card
 // made from a message has its mode and a Card read from the board's data keeps its brief, so neither takes this line.
 const maker=makerOf(c); const from=column==='ideas'&&!brief&&c.agent_id&&!c.mode?p.members.find(m=>m.person_id===maker)?.people?.name?.split(' ')[0]:undefined;
 const idea=from?t('boardNewIdeaFrom',from):null;
  return <KanbanCard id={c.id} column={column} isOverlay={isOverlay} key={c.id} disabled={!p.canCreate} className={mine?'approval-card':''} data-mine={mine||undefined} data-stage-id={c.stage_id} data-stage-name={stageName(c)}>
   {c.mode&&<span className="kcard__kind">{modeChip(c)}</span>}
   <Link className="authored-title kcard__title" dir="auto" href={p.focus?`${base}/board/${c.id}`:`${base}/board?card=${c.id}`} scroll={!!p.focus} draggable={false} tabIndex={isOverlay?-1:undefined} aria-label={crew.length>1?t('boardWorkedOnCard',c.title,names.join(t('boardNamesJoin'))):undefined} aria-describedby="board-drag-hint" aria-keyshortcuts={p.canCreate?'Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown':undefined} onKeyDown={isOverlay?undefined:keys(c)}><strong>{c.title}</strong></Link>
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
   {crew.length>1&&<span className="kcard__crew"><span className="fstack" aria-hidden="true">{crew.map(a=><CompanyAgentFace key={a.id} agent={a} size={18}/>)}</span><span className="kcard__crew-t">{t('boardWorkedOn')} {crew.map((a,i)=><Fragment key={a.id}>{i>0&&t('boardNamesJoin')}<bdi>{a.name}</bdi></Fragment>)}</span></span>}
   {own?<ChatCardFoot agent={own} job={job} due={due(c)&&<span className="kcard__due od-nowrap">{due(c)}</span>}/>:<span className="kcard__foot">{agent&&<span className="kcard__agent card-avatars"><AgentFace id={agent} role={agentRole(agent)} name={agentName(agent)} size={18}/><bdi className="od-truncate">{agentName(agent)}</bdi></span>}{job&&<span>{agent?'· ':''}<bdi>{job}</bdi></span>}{due(c)&&<span className="kcard__due od-nowrap">{due(c)}</span>}</span>}
  </KanbanCard>; };
 // A learning suggestion (#25; design-reference: lnRowHTML) is decided where it waits: the rule, its Agent, who told it,
 // and Decline or Make it team-wide.
 const named=(key:string,name:string)=>{ const [before,after]=t(key,'\u0000').split('\u0000'); return <>{before}<bdi>{name}</bdi>{after}</>; };
 const ruleView=(item:WaitingItem)=><div key={`${item.kind}:${item.id}`} className="mcard mcard--rule" data-kind={item.kind} role="group" aria-label={t('waitingRuleLabel',item.body,item.asked_by)}>
  <span className="mcard__top"><span className="od-fill mcard__who"><b>{t('waitingRuleKind')}</b></span><span className="mcard__time num">{date(item.created_at,language,{month:'short'})}</span></span>
  <span className="mcard__q" dir="auto">{item.suggestion?.rule??item.title}</span>
  <span className="ln-meta"><span className="ln-who">{item.suggestion?.agent&&<span aria-hidden="true"><CompanyAgentFace agent={item.suggestion.agent} size={16}/></span>}<bdi>{item.body}</bdi></span><span aria-hidden="true">·</span><span>{named('waitingRuleToldBy',item.asked_by)}</span><span className="badge badge--wait"><span className="dot dot--waiting" aria-hidden="true"/>{t('waitingRuleBadge')}</span></span>
  <form action={decideAgentRule} className="ln-acts"><input type="hidden" name="company" value={p.company}/><input type="hidden" name="slug" value={p.slug}/><input type="hidden" name="item" value={item.id}/>
   <button className="btn btn--secondary btn--sm" name="intent" value="reject">{t('waitingRuleDecline')}</button>
   <button className="btn btn--primary btn--sm" name="intent" value="approve">{t('waitingRuleApprove')}</button></form>
 </div>;
 const lead=identities.find(a=>a.role==='account_manager')?.name||'Lead';
 const decidedHere:Record<string,(item:WaitingItem)=>ReactNode>={
  rule_suggestion:ruleView,
  agent_request:item=><OwnerRequestCard key={`${item.kind}:${item.id}`} slug={p.slug} company={p.company} lead={lead} item={item}/>,
  agent_key:item=><AgentKeyWaitCard key={`${item.kind}:${item.id}`} item={item}/>,
 };
 const answeredHere=(item:WaitingItem)=>Object.hasOwn(decidedHere,item.kind);
 // A mention (#22) names who wrote the note and on which Card, shows the note and opens it on its Card. A step an Agent
 // handed over (#140; design-reference: waitTagHTML, kcardHTML's waiting branch) is tagged before its title and opens the
 // Conversation at its card. A permission request (#165) names its Agent with its face and opens the Conversation, or
// the channel, at its card.
 const itemView=(item:WaitingItem)=>answeredHere(item)?decidedHere[item.kind](item):<Link key={`${item.kind}:${item.id}`} className="mcard" data-kind={item.kind} href={chatPlace(p.slug,item)??`${base}/board/${item.card_id}${item.note_id?`#note-${item.note_id}`:''}`}>
  <span className="mcard__top"><span className="od-fill mcard__who">{item.kind==='question'?<b>{item.asked_by?t('waitingQuestionFrom',item.asked_by):t('waitingQuestion')}</b>:item.kind==='mention'?<><b dir="auto">{item.asked_by}</b> {named('waitingMentionIn',item.title)}</>:item.agent?<span className="ln-who"><span aria-hidden="true"><CompanyAgentFace agent={item.agent} size={16}/></span><b dir="auto">{item.asked_by}</b></span>:<b dir="auto">{item.asked_by}</b>}</span><span className="mcard__time num">{date(item.created_at,language,{month:'short'})}</span></span>
  {item.kind==='hand'&&<span className="wtag wtag--hand"><ShellIcon name="hand"/>{t('handBadge')}</span>}
  <span className="mcard__q od-clamp-3" dir="auto">{item.kind==='mention'?item.body:<>{item.title}{item.body&&<> {item.body}</>}</>}</span>
 </Link>;
 // A Card's conversation: each message with its current text; under a Member's note, the reply of the Agent it called,
 // or the line that it is working on it while its Run is open.
 const noteView=(a:Activity)=>{ const id=Number(a.details.id); const notes=p.notes; const comment=notes?.comments.find(c=>c.id===id);
  const reply=notes?.replies.find(r=>r.reply_to===id); const run=notes?.runs.find(r=>r.note_id===id); const agentOf=(agent:string)=>notes?.agents.find(x=>x.id===agent);
  return <Fragment key={a.id}>
   <MessageRow activity={comment?{...a,details:{...a.details,body:comment.body}}:a} members={p.members} slug={p.slug} anchor={`note-${id}`} files={p.attachments.filter(f=>f.comment_id===id)}
    note={comment&&notes?(files,time)=><NoteText note={comment} me={notes.me} canWrite={p.canCreate} company={p.company} slug={p.slug} drawnAt={notes.drawnAt} surface="card" meta={time}>{files}</NoteText>:undefined}/>
   {reply?<NoteReplyRow name={agentOf(reply.actor_id)?.name||reply.actor_name||''} face={agentOf(reply.actor_id)?.connection_id||null} body={reply.body} at={reply.created_at}/>
    :run&&!run.outcome?<NoteReplyRow name={agentOf(run.agent_id)?.name||run.agent_name} face={agentOf(run.agent_id)?.connection_id||null} working={p.members.find(m=>m.person_id===a.actor_id)?.people?.name?.split(' ')[0]||''}/>:null}
  </Fragment>; };
 // A Card opened over the board (#116; design-reference: renderSheetHead): its Agent, else its channel, and where it stands.
 const sheetView=(c:Card,sheet:CardSheetData)=>{ const agent=agentOfCard(c); const own=cardAgentOf(c); const column=columnOfCard(c); const chat=chatOf(c);
  return <CardSheet key={c.id} send={workAction} slug={p.slug} company={p.company} title={c.title} sheet={sheet} canWrite={p.canCreate} alone={!!p.alone} message={p.message}
   face={own?<span aria-hidden="true"><CompanyAgentFace agent={own} size={28}/></span>:agent?<span aria-hidden="true"><AgentFace id={agent} role={agentRole(agent)} name={agentName(agent)} size={28}/></span>:null}
   who={own?<bdi>{own.name}</bdi>:agent?<bdi>{agentName(agent)}</bdi>:c.channel?<bdi>{c.channel}</bdi>:null}
   badge={column==='waiting'?<span className="badge badge--wait"><span className="dot dot--waiting" aria-hidden="true"/>{chat?chatBadge(chat):p.approvableIds.includes(c.id)?t('boardWaitingYou'):p.canCreate?waitingOn(c.next_actor):t('boardWaitingTeam')}</span>:<span className="badge">{columnName(column)}</span>}/>; };
 const sheet=p.sheet; const sheetCard=sheet&&p.cards.find(c=>c.id===sheet.id);
 const ideasStage=stagesIn('ideas')[0]?.id;
 // "+" on Ideas opens that column's form and a second press closes it (#188); Cancel and Escape come back to it too.
 const closeIdea=()=>{ setAddingIdea(false); addButton.current?.focus({preventScroll:true}); };
 const toggleIdea=()=>{ if(addingIdea) closeIdea(); else setAddingIdea(true); };
 const views=<div className="work-toolbar" data-canonical-toolbar="work"><nav className="tabs segmented" aria-label={t('boardViews')}>{[['board',t('board')],['calendar',t('calendar')],['list',t('list')]].map(([path,label])=><Link key={path} data-slot="button" data-active={p.section===`work/${path}`&&!p.focus} aria-current={p.section===`work/${path}`&&!p.focus?'page':undefined} className={`button ${p.section===`work/${path}`&&!p.focus?'active':''}`} href={`${base}/${path}`}>{label}</Link>)}</nav>{p.canCreate&&<button className="btn btn--primary btn--sm" data-slot="button" data-toolbar-primary onClick={()=>setComposing(true)}>{t('newCardAction')}</button>}</div>;
 const head=<header className="page-head"><div className="od-field"><h1 className="page-title">{t('marketingBoard')}</h1><p className="page-sub">{t('boardSubtitle')}</p><p className="sr-only" id="board-drag-hint">{t('boardDragHint')}</p></div>{views}</header>;
 const boardFilters=<div className="work-filters" data-canonical-toolbar="work-filters"><label>{t('month')}{' '}<input data-toolbar-control type="month" disabled={!hydrated} value={month} onChange={e=>setMonth(e.target.value)}/></label>{p.projects.length>0&&<label>{t('project')}{' '}<select data-toolbar-control aria-label={t('project')} disabled={!hydrated} value={project} onChange={e=>setProject(e.target.value)}><option value="">{t('allProjects')}</option>{p.projects.map(pr=><option dir="auto" key={pr.id} value={pr.id}>{pr.name}</option>)}</select></label>}</div>;
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
    {companyAgents.map(a=><button type="button" key={a.id} className="chip" aria-pressed={filter===a.id} onClick={()=>setAgentFilter(a.id)}><span className="chip__face" aria-hidden="true"><CompanyAgentFace agent={a} size={22}/></span><bdi>{a.name}</bdi></button>)}
   </div>
   {boardFilters}
   <span className="board-tools__summary">{!p.canCreate?<><BoardIcon name="eye"/>{t('boardReadOnly')}</>:waitingTotal?<><span className="dot dot--waiting" aria-hidden="true"/>{(p.waiting||[]).some(item=>item.kind!=='approval')?t('thingsWaitingOnYou',waitingTotal):t(waitingTotal>1?'boardWaitingMany':'boardWaitingOne',waitingTotal)}</>:<><BoardIcon name="check"/>{t('boardNothingWaiting')}</>}</span>
   <BoardPager/>
  </div>
  {moving&&<p role="status" className="board-status">{t('movingCard')}</p>}
  {!p.cards.length&&!items.length&&<div className="board-bare" role="note"><p>{t('boardEmpty',identities.find(a=>a.role==='account_manager')?.name||'Lead')}</p>{p.canCreate&&<Link className="btn btn--secondary btn--sm" href={`/c/${p.slug}/chat`}><BoardIcon name="chat"/><span>{t('boardTalkTo',identities.find(a=>a.role==='account_manager')?.name||'Lead')}</span></Link>}</div>}
  <KanbanBoard label={t('workBoard')} busy={moving} cards={boardColumns.flatMap(column=>inColumn(column)).map(c=>({id:c.id,title:c.title,column:columnOfCard(c)}))} columnName={columnName} renderOverlay={id=>cardView(p.cards.find(card=>card.id===id)!,true)} onMove={move}>
   {boardColumns.map(column=>{ const list=inColumn(column); const extra=column==='waiting'&&!ownList?items:[]; const stages=stagesIn(column);
    // Mentions of the reader (#22) wait apart from what needs their reply.
    const groups=[{id:'mn-h-mentions',label:'waitingMentions',items:extra.filter(item=>item.kind==='mention')},{id:'mn-h',label:'waitingNeedsReply',items:extra.filter(item=>item.kind!=='mention'&&!answeredHere(item))}].filter(group=>group.items.length);
    if(column==='waiting'&&ownList) return <KanbanColumn key={column} column={column} id={`col-${column}-section`} name={columnName(column)} count={ownEntries.length} waiting head={null}>
     {ownEntries.map(entry=>entry.card?<div key={`approval:${entry.card.id}`} className="column" data-stage-id={entry.card.stage_id} data-stage-name={stageName(entry.card)}>{cardView(entry.card)}</div>:itemView(entry.item))}
     {!ownEntries.length&&<div className="col-empty"><b>{t(emptyKey[column][0])}</b>{emptyKey[column][1]&&<span>{t(emptyKey[column][1])}</span>}</div>}
    </KanbanColumn>;
    const add=column==='ideas'&&p.canCreate&&ideasStage?<button ref={addButton} type="button" className="circle-btn add-btn add-card" aria-label={t('boardAddIdea')} title={t('boardAddIdea')} aria-expanded={addingIdea} onClick={toggleIdea}><BoardIcon name="plus"/></button>:null;
    return <KanbanColumn key={column} column={column} id={`col-${column}-section`} name={columnName(column)} count={list.length+extra.length} waiting={column==='waiting'} head={add} data-stage-name={stages.length===1?stages[0].name:undefined}>
     {extra.filter(answeredHere).map(itemView)}
     {groups.map((group,n)=><div key={group.id} className="mn-group" role="group" aria-labelledby={group.id}><h3 className="mn-h" id={group.id}><BoardIcon name="at"/><span>{t(group.label)}</span> <span className="num">{group.items.length}</span></h3>{group.items.map(itemView)}{(list.length>0||n<groups.length-1)&&<div className="mn-sep" role="separator"/>}</div>)}
     {column==='ideas'&&addingIdea&&ideasStage&&<AddIdea company={p.company} slug={p.slug} stage={ideasStage} agents={companyAgents} preferred={filter==='all'?'':filter} workAction={workAction} onClose={closeIdea}/>}
     {list.map(c=><div key={c.id} className="column" data-stage-id={c.stage_id} data-stage-name={stageName(c)}>{cardView(c)}</div>)}
     {!list.length&&!extra.length&&!(column==='ideas'&&addingIdea)&&<div className="col-empty"><b>{t(emptyKey[column][0])}</b>{emptyKey[column][1]&&<span>{t(emptyKey[column][1])}</span>}</div>}
    </KanbanColumn>; })}
  </KanbanBoard>
 </div>;
 return <div className="work-root">{(placeError||p.message)&&!sheetCard&&<p role="alert" className="work-error">{placeError||p.message}</p>}{!card&&<>{p.section==='settings/work'?<div className="tabs"><Link className="button" href={`/c/${p.slug}/settings`}>{t('general')}</Link><Link className="button" href={`/c/${p.slug}/settings/members`}>{t('members')}</Link><Link className="button active" href={`/c/${p.slug}/settings/work`}>{t('work')}</Link></div>:null}{p.section==='settings/work'&&<section className="panel"><h2>{t('workStages')}</h2>{p.stages.map(s=><form action={workAction} className="settings-row" key={s.id}>{hidden('stage-settings')}<input type="hidden" name="stage" value={s.id}/><input dir="auto" aria-label={t('stageName', s.name)} name="name" defaultValue={s.name}/><input aria-label={t('stageOrder', s.name)} name="position" type="number" defaultValue={s.position}/><button>{t('save')}</button></form>)}<h2>{t('labels')}</h2>{p.labels.map(l=><form action={workAction} className="settings-row" key={l.id}>{hidden('label-settings')}<input type="hidden" name="label" value={l.id}/><input dir="auto" aria-label={t('labelName', l.name)} name="name" defaultValue={l.name}/><input dir="auto" aria-label={t('labelColor', l.name)} name="color" type="color" defaultValue={l.color}/><button>{t('save')}</button></form>)}</section>}
  {p.section==='work/board'&&board}
  {(p.section==='work/list'||p.section==='work/calendar')&&<div className="board-view board-view--page">{head}<div className="board-body"><div className="work-filters" data-canonical-toolbar="work-filters"><label>{t('month')}{' '}<input data-toolbar-control type="month" disabled={!hydrated} value={month} onChange={e=>setMonth(e.target.value||(p.section==='work/calendar'?new Date().toISOString().slice(0,7):''))}/></label>{p.projects.length>0&&p.section!=='work/calendar'&&<label>{t('project')}{' '}<select data-toolbar-control aria-label={t('project')} disabled={!hydrated} value={project} onChange={e=>setProject(e.target.value)}><option value="">{t('allProjects')}</option>{p.projects.map(pr=><option dir="auto" key={pr.id} value={pr.id}>{pr.name}</option>)}</select></label>}</div>{p.section==='work/list'&&<TaskList emptyMessage={!visible.length?t('noCardsToDisplay'):undefined}><thead><tr>{[['title',t('title')],['stage_id',t('stageField')],['channel',t('channel')],['go_live',t('publishingDate')],['next_actor',t('nextActor')]].map(([key,label])=><th key={key} aria-sort={sort===key?direction:undefined}><button onClick={()=>{if(sort===key) setDirection(direction==='ascending'?'descending':'ascending'); else {setSort(key);setDirection('ascending');}}}>{label} ↕</button></th>)}</tr></thead><tbody dir="auto">{sortWorkCards(visible,sort,direction,p.stages,p.members).map(c=><TaskListRow key={c.id}><td><AuthoredTitle href={`${base}/board/${c.id}`}>{c.title}</AuthoredTitle></td><td dir="auto">{p.stages.find(s=>s.id===c.stage_id)?.name}</td><td dir="auto">{c.channel}</td><td>{date(c.go_live,language)}</td><td dir="auto">{c.next_actor&&<Avatar id={c.next_actor} members={p.members} nameVisible/>} <span>{p.members.find(m=>m.person_id===c.next_actor)?.people?.name}</span></td></TaskListRow>)}</tbody></TaskList>}{p.section==='work/calendar'&&<div className="panel calendar-wrap"><h2 className="calendar-title">{month&&new Date(Number(month.slice(0,4)),Number(month.slice(5,7))-1,1).toLocaleDateString(locale,{month:'long',year:'numeric'})}</h2>{!p.cards.some(c=>c.go_live?.startsWith(month))&&<p className="empty-column">{t('noCardsThisMonth')}</p>}<div className="calendar">{[t('sunday'),t('monday'),t('tuesday'),t('wednesday'),t('thursday'),t('friday'),t('saturday')].map(d=><div className="day calendar-heading" key={d}>{d}</div>)}{Array.from({length:new Date(Number(month.slice(0,4)),Number(month.slice(5,7))-1,1).getDay()},(_,i)=><div className="day" key={`empty-${i}`}/>)}{Array.from({length:new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()},(_,i)=><div className="day" key={i}>{i+1}{p.cards.filter(c=>c.go_live&&new Date(c.go_live).getUTCDate()===i+1&&c.go_live.startsWith(month)).map(c=><AuthoredTitle key={c.id} href={`${base}/board/${c.id}`}>{c.title}</AuthoredTitle>)}</div>)}</div></div>}</div></div>}
 </>}{composing&&!card&&<Suspense fallback={<div className="navigation-progress" role="progressbar" aria-label={t('openingPage')}/>}><NewCard slug={p.slug} company={p.company} agents={p.agents} members={p.members} stage={0} fromRoute={p.initialCreating} workAction={workAction} onClose={()=>setComposing(false)}/></Suspense>}
 {card&&<CardDialog title={card.title} returnTo={`${base}/board`}>{p.message&&<p role="alert" className="work-error">{p.message}</p>}<Link className="close-card" href={`${base}/board`} aria-label={t('close')}>✕</Link>{card.rejection_reason&&<div className="rejection-notice"><strong>{t('rejectionReason')}</strong><p dir="auto">{card.rejection_reason}</p></div>}<p className="card-stage-line">{t('inStage')}{' '}{p.stages.find(s=>s.id===card.stage_id)?.name}{card.offering&&<> · {card.offering}</>}{card.project_id&&<> · <bdi>{p.projects.find(x=>x.id===card.project_id)?.name}</bdi></>}{card.mode&&<> · {modeChip(card)}</>}</p><div className="modal-grid"><div><form action={workAction}>{hidden('edit')}<input type="hidden" name="card" value={card.id}/>{[['title',t('title')],['offering',t('offering')],['segment',t('segment')],['hook',t('hook')],['channel',t('channel')],['format',t('format')],['go_live',t('publishingDate')],['goal',t('goal')],['caption',t('caption')]].map(([key,label])=><label key={key}>{label}{key==='format'?<select className="field" name={key} defaultValue={card.format}><option value="">{t('chooseFormat')}</option><option value={messages.ar.post}>{t('post')}</option><option value={messages.ar.reel}>{t('reel')}</option><option value={messages.ar.carousel}>{t('carousel')}</option></select>:key==='caption'?<textarea dir="auto" className="field caption-field" name={key} rows={4} defaultValue={card.caption||''}/>:<input dir="auto" className="field" name={key} type={key==='go_live'?'datetime-local':'text'} defaultValue={key==='go_live'?card.go_live?.slice(0,16):String(card[key as keyof Card]||'')}/>}</label>)}<label>{t('evidenceLinkOptional')}<input dir="auto" className="field" type="url" name="evidence"/></label><button className="primary">{t('saveChanges')}</button></form><h3>{t('checklist')}</h3><div className="checklist">{p.items.filter(i=>i.card_id===card.id).map(i=><form action={workAction} key={i.id}>{hidden('check')}<input type="hidden" name="card" value={card.id}/><input type="hidden" name="item" value={i.id}/><input type="hidden" name="done" value={String(!i.done)}/><label dir="auto"><input type="checkbox" checked={i.done} onChange={e=>e.currentTarget.form?.requestSubmit()}/> {i.title}</label></form>)}</div><h3>{t('designsAndVersions')}</h3>{p.creatives.filter(c=>c.card_id===card.id).map(c=><div key={c.id}><bdi>{c.name}</bdi>{p.versions.filter(v=>v.creative_id===c.id).map((v,i)=><p key={v.id}>{t('version')}{' '}{i+1}: {v.url?<a href={v.url} target="_blank" rel="noreferrer">{v.path.split('/').pop()}</a>:v.path.split('/').pop()}</p>)}<form action={workAction}>{hidden('upload')}<input type="hidden" name="card" value={card.id}/><input type="hidden" name="creative" value={c.id}/><input aria-label={t('newVersionFileForDesign', c.name)} type="file" name="file" required/><button>{t('uploadVersion')}</button></form></div>)}<form action={workAction}>{hidden('upload')}<input type="hidden" name="card" value={card.id}/><input aria-label={t('newDesignFile')} type="file" name="file" required/><button>{t('addDesign')}</button></form><h3>{t('commentsAndActivity')}</h3>{p.activity.filter(a=>a.card_id===card.id&&!isMessage(a)).map(a=><ActivityRow key={a.id} activity={a} members={p.members} slug={p.slug}/>)}<ol className="conversation" aria-label={t('conversation')}>{p.activity.filter(a=>a.card_id===card.id&&isMessage(a)).sort((a,b)=>a.id-b.id).map(noteView)}</ol>{p.canCreate?<><form action={workAction}>{hidden('comment')}<input type="hidden" name="card" value={card.id}/><label>{t('comment')}<textarea dir="auto" className="field" name="body" placeholder={t(p.alone?'notePlaceholderAlone':'notePlaceholderTeam')} aria-describedby="note-hint" required/></label><label>{t('evidenceLinkOptional')}<input dir="auto" className="field" type="url" name="evidence"/></label><label>{t('attachFiles')}<input className="field" type="file" name="files" multiple/></label><button>{t('send')}</button></form><p className="note-hint" id="note-hint"><BoardIcon name="clock"/><span>{t('noteHint')}</span></p></>:<p className="ro-line" role="note"><BoardIcon name="eye"/><span>{t('noteViewOnly')}</span></p>}</div><aside><form action={workAction} className="card-stage-control" data-card-section="stage">{hidden('move')}<input type="hidden" name="card" value={card.id}/><input type="hidden" name="view" value="card"/><label>{t('moveToList')}{' '}<select name="stage" disabled={!hydrated} aria-label={t('moveToList')} key={card.stage_id} defaultValue={card.stage_id} onChange={e=>e.currentTarget.form?.requestSubmit()}>{p.stages.map(s=><option dir="auto" key={s.id} value={s.id}>{s.name}</option>)}</select></label></form><div data-card-section="next-actor"><h3>{t('nextActor')}</h3>{card.approval_step_id?<p dir="auto">{p.members.find(m=>m.person_id===card.next_actor)?.people?.name || t('currentApprover')}</p>:<form action={workAction}>{hidden('actor')}<input type="hidden" name="card" value={card.id}/><MemberPicker key={card.id+':'+card.next_actor} label={t('nextActor')} name="person" defaultValue={card.next_actor||''} empty={t('notSpecified')} members={p.members}/><button>{t('save')}</button></form>}</div><div data-card-section="assignees"><h3>{t('assignees')}</h3><div className="member-chips">{p.assignees.filter(a=>a.card_id===card.id).map(a=><span dir="auto" key={a.person_id}><Avatar id={a.person_id} members={p.members} nameVisible/> <span>{p.members.find(m=>m.person_id===a.person_id)?.people?.name}</span></span>)}</div><form action={workAction}>{hidden('assignee')}<input type="hidden" name="card" value={card.id}/><MemberPicker key={card.id} label={t('addAssignee')} name="person" members={p.members}/><button>{t('add')}</button></form></div><div data-card-section="labels"><h3>{t('labels')}</h3><div className="member-chips">{p.cardLabels.filter(x=>x.card_id===card.id).map(x=>{const l=p.labels.find(l=>l.id===x.label_id); return l&&<span dir="auto" className="label-chip" style={{borderColor:l.color}} key={l.id}>{l.name}</span>})}</div><form action={workAction}>{hidden('label')}<input type="hidden" name="card" value={card.id}/><select aria-label={t('addLabel')} name="label">{p.labels.map(l=><option dir="auto" key={l.id} value={l.id}>{l.name}</option>)}</select><button>{t('add')}</button></form></div>{p.projects.length>0&&<div data-card-section="project"><h3>{t('project')}</h3><form action={workAction}>{hidden('project')}<input type="hidden" name="card" value={card.id}/><select key={card.project_id||''} aria-label={t('project')} name="project" defaultValue={card.project_id||''}><option value="">{t('noProject')}</option>{p.projects.map(pr=><option dir="auto" key={pr.id} value={pr.id}>{pr.name}</option>)}</select><button>{t('save')}</button></form></div>}{p.approvableIds.includes(card.id)&&<section data-card-section="review"><h3>{t('reviewDecision')}</h3><Decision slug={p.slug} company={p.company} card={card.id} workAction={workAction}/></section>}</aside></div></CardDialog>}{sheet&&sheetCard&&sheetView(sheetCard,sheet)}</div>;
}
