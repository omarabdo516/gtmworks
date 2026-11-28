import type { ReactNode } from 'react';
import { getI18n } from '@/lib/i18n-server';
import type { supabase } from '@/lib/supabase';
import { feedSince } from '@/lib/numbers.mjs';
import { canCreateCard } from '@/lib/card-permissions.mjs';
import { agentFiles, agentLogFilter, fileSize, latestActivity, pickTab, type DetailsTab } from '@/lib/agent-details.mjs';
import { agentFaceStates, type AgentFaceState } from '@/lib/agent-face-states';
import { ShellIcon } from '@/components/shell-icon';
import type { LogRow } from '@/lib/activity-log.mjs';
import { FeedWhen, LogDays } from '@/app/c/[slug]/log/log-client';
import { FeedText, LogEntry, logColumns, logPeople } from '@/app/c/[slug]/log/entries';
import { detailsTabs } from '@/app/agent-details-tabs';
import { ConnectedTools } from '@/app/connected-tools';
import { AgentLibrary } from '@/app/agent-library';
import { AgentScreen } from '@/app/agent-screen';
import { AgentMemoryPart, AgentPermissionsPart } from '@/app/agent-details-parts';
import { AgentRoutines } from '@/app/agent-routines';
import { companyKnowledgeHref } from '@/lib/settings-overlay.mjs';
import { channelNameOf, channelTitle } from '@/lib/channels';
import { AgentBoardTasks } from '@/app/agent-board-tasks';

type Db=Awaited<ReturnType<typeof supabase>>;
export type AgentDetailsView={status:AgentFaceState,tab:DetailsTab,tabs:Record<DetailsTab,ReactNode>};
const logShown=50;

// The Agent's name and the reader's role may still be on their way: a page can start the details' reads beside its own
// (the chat does) and they are awaited with the first of them.
export async function agentDetails(db:Db,{company,agent,name:named,slug,me,role:roled,tab}:{company:string,agent:string,name:string|PromiseLike<string>,slug:string,me:string,role:string|PromiseLike<string>,tab?:string}):Promise<AgentDetailsView> {
 // The Agent's state for the reader (#699), the sidebar's own read; the open Run above says only what it is doing.
 const stateRead=agentFaceStates(db,company);
 const [{t,language},name,role,{data:logRows,count},{data:runs},{data:channelFileRows,count:channelFileCount}]=await Promise.all([getI18n(),named,roled,
  db.from('company_log').select(logColumns,{count:'exact'}).eq('company_id',company).or(agentLogFilter(agent)).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(logShown),
  db.rpc('agent_open_run',{c:company,agent}),
  // The files the Agent handed over in a channel (#715); a Conversation's are its Engine session's, opened there (#880): row-level security shows a person only the channels they are a
  // Member of, whose files are every Member's.
  db.from('channel_attachments').select('id,name,size,created_at,channel_messages!inner(author,agent_id),channels!inner(kind,name)',{count:'exact'}).eq('company_id',company)
   .eq('channel_messages.author','agent').eq('channel_messages.agent_id',agent).order('created_at',{ascending:false}).order('id',{ascending:false}),
 ]);
 const writer=canCreateCard({role});
 const rows=(logRows||[]) as LogRow[];
 const run=(runs as {started_at:string,my_conversation:string|null}[]|null)?.[0];
 const [{of:faceOf},people]=await Promise.all([stateRead,logPeople(db,company)]);
 const recent=latestActivity(rows,feedSince());

 const activity=run||recent.length?<ul className="panel-card">
   {run&&<li className="panel-row dp-now"><span className="panel-row__text">
    <span className="panel-row__t"><span className="dot dot--working" aria-hidden="true"/>{t('agentWorkingNow')}</span>
    {/* A Run of the reader's own Conversation is theirs; a teammate's says only that it is a teammate's (#141, #883). */}
    {!run.my_conversation&&<span className="panel-row__d">{t('agentOnTeammateRequest')}</span>}
    <FeedWhen value={run.started_at} className="panel-row__d"/>
   </span></li>}
   {recent.map(row=><li key={row.id} className="panel-row"><span className="panel-row__text">
    <span className="panel-row__t"><FeedText row={row} people={people} t={t} language={language}/></span>
    <FeedWhen value={row.created_at} className="panel-row__d"/>
   </span></li>)}
  </ul>:undefined;

 // Its Cards on the Company's Engine board (spec #831, #846), read in the browser after the panel is drawn (ADR 0030).
 const tasksTab=<AgentBoardTasks key={`tasks-${agent}`} company={company} slug={slug} agent={agent} writer={writer}/>;

 const files=agentFiles({slug,
  channelFiles:((channelFileRows||[]) as unknown as {id:number,name:string,size:number,created_at:string,channels:{kind:string,name:string|null}}[]).map(file=>({...file,channel:channelTitle(t,channelNameOf(file.channels))}))});
 const filesList=files.length?<ul className="panel-card">{files.map(file=><li key={file.key} className="panel-row"><span className="panel-row__icon"><ShellIcon name="file"/></span><span className="panel-row__text">
   <a className="panel-row__t od-truncate dp-file" href={file.href} target="_blank" rel="noreferrer" title={file.name}><bdi dir="auto">{file.name}</bdi></a>
   <span className="panel-row__d"><bdi dir="ltr">{fileSize(file.size)}</bdi> · <bdi>{file.source}</bdi></span></span></li>)}</ul>:undefined;

 const log=rows.length?<div className="lg-wrap"><LogDays items={rows.map(row=>({id:row.id,at:row.created_at,node:<LogEntry row={row} people={people} me={me} t={t} language={language} faceSize={24}/>}))}/></div>:undefined;

 // The Agent's Library (#194): the Owner and Managers open it, and the route refuses anyone below them. Its folder is
 // read in the browser after the panel is drawn, so no page waits on the Engine.
 const library=role==='owner'||role==='manager'?<AgentLibrary company={company} slug={slug} agent={agent} name={name}/>:undefined;

 return {status:faceOf(agent).state,tab:pickTab(tab),
  // The Agent's Screen (#712): read in the browser after the panel is drawn; Wake it is for a Member who is not a Viewer.
  tabs:detailsTabs({t,slug,agent,screen:<AgentScreen key={`screen-${agent}`} company={company} agent={agent} name={name} canWake={writer}/>,activity,tools:<ConnectedTools company={company} agent={agent} name={name} owner={role==='owner'}/>,
   // The Agent's Routines (#205): read in the browser too; the Owner and Managers change them, as in Settings (#31).
   routines:<AgentRoutines key={agent} company={company} agent={agent} name={name} canManage={role==='owner'||role==='manager'} canWrite={writer}/>,
   // Its standing permissions (#166) and its memory (#350) are its own Engine profile's: each is read from the browser
   // when shown (#769, ADR 0030), so the details never wait on the Engine and no part holds another.
   permissions:<AgentPermissionsPart key={`standing-${agent}`} company={company} agent={agent} canRevoke={role==='owner'||role==='manager'}/>,tasks:tasksTab,files:filesList,library,fileCount:channelFileCount??0,
   memory:<AgentMemoryPart key={agent} company={company} agent={{id:agent,name}} canReset={role==='owner'} canEdit={role==='owner'||role==='manager'} canForget={role==='owner'} knowledgeHref={companyKnowledgeHref(slug,role)}/>,
   log,logCount:count??rows.length})};
}
