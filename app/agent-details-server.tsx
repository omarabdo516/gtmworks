import type { ReactNode } from 'react';
import Link from '@/lib/link';
import { getI18n } from '@/lib/i18n-server';
import type { supabase } from '@/lib/supabase';
import { approvalQueue } from '@/lib/approval-queue';
import { feedSince } from '@/lib/numbers.mjs';
import { canCreateCard } from '@/lib/card-permissions.mjs';
import { columnLabel, type CardWait } from '@/lib/board-columns.mjs';
import { agentFiles, agentLogFilter, agentTasks, fileSize, latestActivity, pickTab, type DetailsTab } from '@/lib/agent-details.mjs';
import { agentFaceStates, type AgentFaceState } from '@/lib/agent-face-states';
import { ShellIcon } from '@/components/shell-icon';
import { drawnAt, type LogRow } from '@/lib/activity-log.mjs';
import { FeedWhen, LogDays } from '@/app/c/[slug]/log/log-client';
import { FeedText, LogEntry, logColumns, logPeople } from '@/app/c/[slug]/log/entries';
import { detailsTabs } from '@/app/agent-details-tabs';
import { ConnectedTools } from '@/app/connected-tools';
import { AgentLibrary } from '@/app/agent-library';
import { AgentMemory } from '@/app/agent-memory';
import { AgentRoutines } from '@/app/agent-routines';
import { companyKnowledgeHref } from '@/lib/settings-overlay.mjs';
import { readAgentMemory } from '@/lib/agent-memory.mjs';
import { readAgentPermissions } from '@/lib/standing-permissions.mjs';
import { StandingPermissions } from '@/app/standing-permissions';
import { channelNameOf, channelTitle } from '@/lib/channels';

type Db=Awaited<ReturnType<typeof supabase>>;
export type AgentDetailsView={status:AgentFaceState,tab:DetailsTab,tabs:Record<DetailsTab,ReactNode>};
const logShown=50;

// The Agent's name and the reader's role may still be on their way: a page can start the details' reads beside its own
// (the chat does) and they are awaited with the first of them.
export async function agentDetails(db:Db,{company,agent,name:named,slug,me,role:roled,tab}:{company:string,agent:string,name:string|PromiseLike<string>,slug:string,me:string,role:string|PromiseLike<string>,tab?:string}):Promise<AgentDetailsView> {
 const drawn=drawnAt();
 // What waits on the reader is two reads deep and needed only to draw: the reads that depend on the first ones go out
 // without waiting for it.
 const waitingRead=approvalQueue(db,company,me);
 // The Agent's state for the reader (#699), the sidebar's own read; the open Run above says only what it is doing.
 const stateRead=agentFaceStates(db,company);
 const [{t,language},name,role,{data:cardRows},{data:logRows,count},{data:runs},{data:talkFileRows,count:talkFileCount},{data:channelFileRows,count:channelFileCount}]=await Promise.all([getI18n(),named,roled,
  db.from('work_cards').select('id,title,status,wait:card_wait').eq('company_id',company).eq('agent_id',agent).order('id'),
  db.from('company_log').select(logColumns,{count:'exact'}).eq('company_id',company).or(agentLogFilter(agent)).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(logShown),
  db.rpc('agent_open_run',{c:company,agent}),
  // The files of the reader's own Conversations with the Agent (#21): row-level security shows a person only theirs.
  db.from('conversation_attachments').select('id,name,size,created_at,conversation_id,conversations!inner(agent_name)',{count:'exact'}).eq('company_id',company).eq('conversations.agent_id',agent)
   .order('created_at',{ascending:false}).order('id',{ascending:false}),
  // The files the Agent handed over in a channel (#715): row-level security shows a person only the channels they are a
  // Member of, whose files are every Member's.
  db.from('channel_attachments').select('id,name,size,created_at,channel_messages!inner(author,agent_id),channels!inner(kind,name)',{count:'exact'}).eq('company_id',company)
   .eq('channel_messages.author','agent').eq('channel_messages.agent_id',agent).order('created_at',{ascending:false}).order('id',{ascending:false}),
 ]);
 const writer=canCreateCard({role});
 const cards=(cardRows||[]) as {id:number,title:string,status:string,wait:CardWait|null}[]; const ids=cards.map(card=>card.id);
 const rows=(logRows||[]) as LogRow[];
 const run=(runs as {started_at:string,my_conversation:string|null}[]|null)?.[0];
 const talkFiles=((talkFileRows||[]) as unknown as {id:number,name:string,size:number,created_at:string,conversation_id:string,conversations:{agent_name:string}}[]).map(file=>({...file,agent_name:file.conversations.agent_name}));
 const talks=[...new Set(talkFiles.map(file=>file.conversation_id))];
 const [{of:faceOf},{items:waiting},{data:checklist},{data:ask},people,{data:cardFileRows,count:cardFileCount},firsts,memory,standing]=await Promise.all([stateRead,waitingRead,
  ids.length?db.from('work_checklist').select('card_id,title,done').eq('company_id',company).in('card_id',ids).order('id'):Promise.resolve({data:[]}),
  run?.my_conversation?db.from('conversation_messages').select('body,reply_cards(title)').eq('conversation_id',run.my_conversation).eq('author','person').eq('created_at',run.started_at).order('id',{ascending:false}).limit(1).maybeSingle():Promise.resolve({data:null}),
  logPeople(db,company,rows.flatMap(row=>row.card_id!=null?[row.card_id]:[])),
  ids.length?db.from('work_attachments').select('id,name,size,created_at,card_id',{count:'exact'}).eq('company_id',company).in('card_id',ids).order('created_at',{ascending:false}).order('id',{ascending:false}):Promise.resolve({data:[],count:0}),
  // A Conversation is named as the sidebar names it: the first line of its person's first message.
  Promise.all(talks.map(async talk=>(await db.from('conversation_messages').select('body').eq('conversation_id',talk).eq('author','person').order('id').limit(1).maybeSingle()).data?.body as string|undefined)),
  // The Agent's memory (#350) is its own Engine profile's; an Agent the reader does not see is not found, and an Engine
  // that cannot be read leaves the tab unread rather than empty.
  readAgentMemory(db,{company,agent}).catch(()=>({state:'failed' as const,main:false,notes:null})),
  // Its standing permissions (#166), from that same own profile; one that cannot be read draws no section.
  readAgentPermissions(db,{company,agent}).catch(()=>({state:'failed',permissions:null})),
 ]);
 const tasks=agentTasks(cards,checklist||[],waiting);
 const recent=latestActivity(rows,feedSince());
 // A Run "Done it" started (#140) is on the step the person did, named by its card, not the sentence the Agent was told.
 const asking=ask as {body:string,reply_cards:{title:string}|null}|null;
 const asked=(asking?.reply_cards?.title??asking?.body)?.split('\n')[0].slice(0,200);

 const activity=run||recent.length?<ul className="panel-card">
   {run&&<li className="panel-row dp-now"><span className="panel-row__text">
    <span className="panel-row__t"><span className="dot dot--working" aria-hidden="true"/>{t('agentWorkingNow')}</span>
    <span className="panel-row__d">{asked?<>{t('agentOnYourRequest')} <bdi>{asked}</bdi></>:t('agentOnTeammateRequest')}</span>
    <FeedWhen value={run.started_at} className="panel-row__d"/>
   </span></li>}
   {recent.map(row=><li key={row.id} className="panel-row"><span className="panel-row__text">
    <span className="panel-row__t"><FeedText row={row} people={people} t={t} language={language}/></span>
    <FeedWhen value={row.created_at} className="panel-row__d"/>
   </span></li>)}
  </ul>:undefined;

 const board=`/c/${slug}/work/board`;
 const tasksTab=tasks.length?<section className="dp-sec"><h3 className="dp-label"><span>{t('agentOnTheBoard')}</span><Link className="link-btn" href={board}>{t('agentOpenBoard')}</Link></h3>
  <div className="panel-card">{tasks.map(task=><Link key={task.id} className="panel-row" href={`${board}/${task.id}`}>
   <span className="panel-row__text"><span className="panel-row__t"><bdi>{task.title}</bdi></span><span className="panel-row__d"><bdi>{'key' in task.line?t(task.line.key,...task.line.args):task.line.text}</bdi></span></span>
   <span className={`panel-row__meta${task.waiting?' panel-row__meta--wait':''}`}>{t(columnLabel(task.column,writer))}</span>
  </Link>)}</div></section>:undefined;

 const titles=new Map(talks.flatMap((talk,index)=>{ const line=firsts[index]?.split('\n')[0]; return line?[[talk,line] as [string,string]]:[]; }));
 const files=agentFiles({slug,cards,cardFiles:(cardFileRows||[]) as {id:number,name:string,size:number,created_at:string,card_id:number}[],conversationFiles:talkFiles,titles,
  channelFiles:((channelFileRows||[]) as unknown as {id:number,name:string,size:number,created_at:string,channels:{kind:string,name:string|null}}[]).map(file=>({...file,channel:channelTitle(t,channelNameOf(file.channels))}))});
 const filesList=files.length?<ul className="panel-card">{files.map(file=><li key={file.key} className="panel-row"><span className="panel-row__icon"><ShellIcon name="file"/></span><span className="panel-row__text">
   <a className="panel-row__t od-truncate dp-file" href={file.href} target="_blank" rel="noreferrer" title={file.name}><bdi dir="auto">{file.name}</bdi></a>
   <span className="panel-row__d"><bdi dir="ltr">{fileSize(file.size)}</bdi> · <bdi>{file.source}</bdi></span></span></li>)}</ul>:undefined;

 const log=rows.length?<div className="lg-wrap"><LogDays items={rows.map(row=>({id:row.id,at:row.created_at,node:<LogEntry row={row} people={people} me={me} slug={slug} company={company} canWrite={writer} drawnAt={drawn} t={t} language={language} faceSize={24}/>}))}/></div>:undefined;

 // The Agent's Library (#194): the Owner and Managers open it, and the route refuses anyone below them. Its folder is
 // read in the browser after the panel is drawn, so no page waits on the Engine.
 const library=role==='owner'||role==='manager'?<AgentLibrary company={company} slug={slug} agent={agent} name={name}/>:undefined;

 return {status:faceOf(agent).state,tab:pickTab(tab),
  tabs:detailsTabs({t,slug,agent,activity,tools:<ConnectedTools company={company} agent={agent} name={name} owner={role==='owner'}/>,
   // The Agent's Routines (#205): read in the browser too; the Owner and Managers change them, as in Settings (#31).
   routines:<AgentRoutines key={agent} company={company} agent={agent} name={name} canManage={role==='owner'||role==='manager'} canWrite={writer}/>,
   permissions:standing.permissions?.length?<StandingPermissions key={`standing-${agent}`} company={company} agent={agent} permissions={standing.permissions} canRevoke={role==='owner'||role==='manager'} returnTo="dp-settings"/>:undefined,tasks:tasksTab,files:filesList,library,fileCount:(cardFileCount??0)+(talkFileCount??0)+(channelFileCount??0),
   memory:memory.state==='found'?<AgentMemory key={agent} company={company} agent={{id:agent,name}} notes={memory.notes} main={memory.main} canReset={role==='owner'} canEdit={role==='owner'||role==='manager'} canForget={role==='owner'} knowledgeHref={companyKnowledgeHref(slug,role)}/>:undefined,
   log,logCount:count??rows.length})};
}
