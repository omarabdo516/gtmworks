import type { ReactNode } from 'react';
import Link from '@/lib/link';
import { getI18n } from '@/lib/i18n-server';
import type { supabase } from '@/lib/supabase';
import { approvalQueue } from '@/lib/approval-queue';
import { feedSince } from '@/lib/numbers.mjs';
import { canCreateCard } from '@/lib/card-permissions.mjs';
import { columnLabel } from '@/lib/board-columns.mjs';
import { agentFiles, agentLogFilter, agentStatus, agentTasks, fileSize, latestActivity, pickTab, type AgentStatus, type DetailsTab } from '@/lib/agent-details.mjs';
import { workDate } from '@/lib/work-date.mjs';
import { ShellIcon } from '@/components/shell-icon';
import type { LogRow } from '@/lib/activity-log.mjs';
import { FeedWhen, LogDays } from '@/app/c/[slug]/log/log-client';
import { FeedText, LogEntry, logColumns, logPeople } from '@/app/c/[slug]/log/entries';
import { PageIcon } from '@/app/c/[slug]/log/icons';

type Db=Awaited<ReturnType<typeof supabase>>;
export type AgentDetailsView={status:AgentStatus,actions:boolean,tab:DetailsTab,tabs:Record<DetailsTab,ReactNode>};
const logShown=50; const filesShown=50;

export async function agentDetails(db:Db,{company,agent,slug,me,role,tab}:{company:string,agent:string,slug:string,me:string,role:string,tab?:string}):Promise<AgentDetailsView> {
 const {t,language}=await getI18n(); const writer=canCreateCard({role});
 const [{data:cardRows},{data:logRows,count},{data:runs},{items:waiting},{data:talkFileRows,count:talkFileCount}]=await Promise.all([
  db.from('work_cards').select('id,title,stage_id').eq('company_id',company).eq('agent_id',agent).order('id'),
  db.from('company_log').select(logColumns,{count:'exact'}).eq('company_id',company).or(agentLogFilter(agent)).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(logShown),
  db.rpc('agent_open_run',{c:company,agent}),
  approvalQueue(db,company,me,role),
  // The files of the reader's own Conversations with the Agent (#21): row-level security shows a person only theirs.
  db.from('conversation_attachments').select('id,name,size,created_at,conversation_id,conversations!inner(agent_name)',{count:'exact'}).eq('company_id',company).eq('conversations.agent_id',agent)
   .order('created_at',{ascending:false}).order('id',{ascending:false}).limit(filesShown),
 ]);
 const cards=(cardRows||[]) as {id:number,title:string,stage_id:number}[]; const ids=cards.map(card=>card.id);
 const rows=(logRows||[]) as LogRow[];
 const run=(runs as {started_at:string,my_conversation:string|null}[]|null)?.[0];
 const talkFiles=((talkFileRows||[]) as unknown as {id:number,name:string,size:number,created_at:string,conversation_id:string,conversations:{agent_name:string}}[]).map(file=>({...file,agent_name:file.conversations.agent_name}));
 const talks=[...new Set(talkFiles.map(file=>file.conversation_id))];
 const [{data:stages},{data:checklist},{data:ask},people,{data:cardFileRows,count:cardFileCount},firsts]=await Promise.all([
  ids.length?db.from('work_stages').select('id,name,board_column').eq('company_id',company):Promise.resolve({data:[]}),
  ids.length?db.from('work_checklist').select('card_id,title,done').eq('company_id',company).in('card_id',ids).order('id'):Promise.resolve({data:[]}),
  run?.my_conversation?db.from('conversation_messages').select('body').eq('conversation_id',run.my_conversation).eq('author','person').eq('created_at',run.started_at).order('id',{ascending:false}).limit(1).maybeSingle():Promise.resolve({data:null}),
  logPeople(db,company,rows.flatMap(row=>row.card_id!=null?[row.card_id]:[])),
  ids.length?db.from('work_attachments').select('id,name,size,created_at,card_id',{count:'exact'}).eq('company_id',company).in('card_id',ids).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(filesShown):Promise.resolve({data:[],count:0}),
  // A Conversation is named as the sidebar names it: the first line of its person's first message.
  Promise.all(talks.map(async talk=>(await db.from('conversation_messages').select('body').eq('conversation_id',talk).eq('author','person').order('id').limit(1).maybeSingle()).data?.body as string|undefined)),
 ]);
 const tasks=agentTasks(cards,stages||[],checklist||[],waiting);
 const recent=latestActivity(rows,feedSince());
 const asked=(ask as {body:string}|null)?.body.split('\n')[0].slice(0,200);

 const activity=<section className="dp-sec"><h3 className="dp-label"><span>{t('agentLatestActivity')}</span></h3>
  {run||recent.length?<ul className="panel-card">
   {run&&<li className="panel-row dp-now"><span className="panel-row__text">
    <span className="panel-row__t"><span className="dot dot--working" aria-hidden="true"/>{t('agentWorkingNow')}</span>
    <span className="panel-row__d">{asked?<>{t('agentOnYourRequest')} <bdi>{asked}</bdi></>:t('agentOnTeammateRequest')}</span>
    <FeedWhen value={run.started_at} className="panel-row__d"/>
   </span></li>}
   {recent.map(row=><li key={row.id} className="panel-row"><span className="panel-row__text">
    <span className="panel-row__t"><FeedText row={row} people={people} t={t} language={language}/></span>
    <FeedWhen value={row.created_at} className="panel-row__d"/>
   </span></li>)}
  </ul>:<div className="panel-card"><p className="panel-empty">{t('agentActivityEmpty')}</p></div>}
 </section>;
 // design-reference: screenSecHTML. The pinned Engine shows no Agent's screen, and gtmworks keeps the browser and
 // computer tools off (lib/agent-levels.mjs), so the screen is always the reference's asleep frame: not a button.
 const screen=<section className="dp-sec" aria-labelledby="scr-h"><h3 className="dp-label"><span id="scr-h">{t('agentScreen')}</span></h3>
  <div className="scr-card"><div className="scr-thumb is-static"><div className="scr is-off">
   <span className="scr__bar" aria-hidden="true"><span className="scr__dots"><i/><i/><i/></span><span className="scr__url" dir="ltr"/></span>
   <span className="scr__body"><span className="scr__off"><ShellIcon name="moon"/><span>{t('agentScreenOff')}</span></span></span>
  </div></div></div></section>;

 const board=`/c/${slug}/work/board`;
 const tasksTab=tasks.length?<section className="dp-sec"><h3 className="dp-label"><span>{t('agentOnTheBoard')}</span><Link className="link-btn" href={board}>{t('agentOpenBoard')}</Link></h3>
  <div className="panel-card">{tasks.map(task=><Link key={task.id} className="panel-row" href={`${board}/${task.id}`}>
   <span className="panel-row__text"><span className="panel-row__t"><bdi>{task.title}</bdi></span><span className="panel-row__d"><bdi>{'key' in task.line?t(task.line.key,...task.line.args):task.line.text}</bdi></span></span>
   <span className={`panel-row__meta${task.waiting?' panel-row__meta--wait':''}`}>{t(columnLabel(task.column,writer))}</span>
  </Link>)}</div></section>
  :<section className="dp-sec"><div className="panel-card"><p className="panel-empty">{t('agentTasksEmpty')}</p></div></section>;

 // design-reference: filesTabHTML, without its Add button and its library, which are not built.
 const titles=new Map(talks.flatMap((talk,index)=>{ const line=firsts[index]?.split('\n')[0]; return line?[[talk,line] as [string,string]]:[]; }));
 const files=agentFiles({slug,cards,cardFiles:(cardFileRows||[]) as {id:number,name:string,size:number,created_at:string,card_id:number}[],conversationFiles:talkFiles,titles});
 const filesTab=<section className="dp-sec" aria-labelledby="dp-files-h"><h3 className="dp-label" id="dp-files-h"><span>{t('agentFiles')} <span className="muted num">{(cardFileCount??0)+(talkFileCount??0)}</span></span></h3>
  {files.length?<ul className="panel-card">{files.map(file=><li key={file.key} className="panel-row"><span className="panel-row__icon"><ShellIcon name="file"/></span><span className="panel-row__text">
   <a className="panel-row__t od-truncate dp-file" href={file.href} target="_blank" rel="noreferrer" title={file.name}><bdi dir="auto">{file.name}</bdi></a>
   <span className="panel-row__d"><bdi dir="ltr">{fileSize(file.size)}</bdi> · <bdi>{file.source}</bdi> · <time dateTime={file.at}>{workDate(file.at,language,{month:'short'})}</time></span></span></li>)}</ul>
  :<div className="panel-card"><p className="panel-empty">{t('agentFilesEmpty')}</p></div>}</section>;

 const log=<section className="dp-sec"><h3 className="dp-label"><span>{t('chatTabLog')} <span className="muted num">{count??rows.length}</span></span><Link className="link-btn" href={`/c/${slug}/log?who=a:${agent}`}>{t('agentOpenLog')}</Link></h3>
  {rows.length?<div className="lg-wrap"><LogDays items={rows.map(row=>({id:row.id,at:row.created_at,node:<LogEntry row={row} people={people} me={me} slug={slug} t={t} language={language} faceSize={24}/>}))}/></div>
   :<div className="panel-card"><p className="panel-empty">{t('agentLogEmpty')}</p></div>}
  <p className="lg-forever"><PageIcon name="lock"/><span>{t('logForever')}</span></p>
 </section>;

 return {status:agentStatus({waitingMine:waiting.some(item=>item.card_id!=null&&ids.includes(item.card_id)),running:!!run}),actions:writer,tab:pickTab(tab),
  tabs:{activity:<>{screen}{activity}</>,tasks:tasksTab,files:filesTab,log}};
}
