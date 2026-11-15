import type { ReactNode } from 'react';
import Link from '@/lib/link';
import { getI18n } from '@/lib/i18n-server';
import type { supabase } from '@/lib/supabase';
import { approvalQueue } from '@/lib/approval-queue';
import { feedSince } from '@/lib/numbers.mjs';
import { canCreateCard } from '@/lib/card-permissions.mjs';
import { columnLabel } from '@/lib/board-columns.mjs';
import { agentLogFilter, agentStatus, agentTasks, latestActivity, type AgentStatus } from '@/lib/agent-details.mjs';
import type { LogRow } from '@/lib/activity-log.mjs';
import { FeedWhen, LogDays } from '@/app/c/[slug]/log/log-client';
import { FeedText, LogEntry, logColumns, logPeople } from '@/app/c/[slug]/log/entries';
import { PageIcon } from '@/app/c/[slug]/log/icons';

type Db=Awaited<ReturnType<typeof supabase>>;
export type AgentDetailsView={status:AgentStatus,actions:boolean,tabs:{activity:ReactNode,tasks:ReactNode,log:ReactNode}};
// The panel shows the Agent's newest log lines; the Activity log, one link away, pages through the rest.
const logShown=50;

// An Agent's details as the signed-in person may see them (design-reference: renderDetailsPanel, activityHTML,
// tasksHTML, agentLogHTML), read through their own session: its state, what it is doing now and did this week, its
// Cards on the board and its lines of the Company log. A Viewer gets the same panel with no action in it.
export async function agentDetails(db:Db,{company,agent,slug,me,role}:{company:string,agent:string,slug:string,me:string,role:string}):Promise<AgentDetailsView> {
 const {t,language}=await getI18n(); const writer=canCreateCard({role});
 const [{data:cardRows},{data:logRows,count},{data:runs},{items:waiting}]=await Promise.all([
  db.from('work_cards').select('id,title,stage_id').eq('company_id',company).eq('agent_id',agent).order('id'),
  db.from('company_log').select(logColumns,{count:'exact'}).eq('company_id',company).or(agentLogFilter(agent)).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(logShown),
  db.rpc('agent_open_run',{c:company,agent}),
  approvalQueue(db,company,me,role),
 ]);
 const cards=(cardRows||[]) as {id:number,title:string,stage_id:number}[]; const ids=cards.map(card=>card.id);
 const rows=(logRows||[]) as LogRow[];
 const run=(runs as {started_at:string,conversation:string|null}[]|null)?.[0];
 const [{data:stages},{data:checklist},{data:ask},people]=await Promise.all([
  ids.length?db.from('work_stages').select('id,name,board_column').eq('company_id',company):Promise.resolve({data:[]}),
  ids.length?db.from('work_checklist').select('card_id,title,done').eq('company_id',company).in('card_id',ids).order('id'):Promise.resolve({data:[]}),
  // Only the person whose Conversation it is reads what they asked, from their own record.
  run?.conversation?db.from('conversation_messages').select('body').eq('conversation_id',run.conversation).eq('author','person').eq('created_at',run.started_at).order('id',{ascending:false}).limit(1).maybeSingle():Promise.resolve({data:null}),
  logPeople(db,company,rows.flatMap(row=>row.card_id!=null?[row.card_id]:[])),
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

 const board=`/c/${slug}/work/board`;
 const tasksTab=tasks.length?<section className="dp-sec"><h3 className="dp-label"><span>{t('agentOnTheBoard')}</span><Link className="link-btn" href={board}>{t('agentOpenBoard')}</Link></h3>
  <div className="panel-card">{tasks.map(task=><Link key={task.id} className="panel-row" href={`${board}/${task.id}`}>
   <span className="panel-row__text"><bdi className="panel-row__t">{task.title}</bdi><span className="panel-row__d" dir="auto">{'key' in task.line?t(task.line.key,...task.line.args):task.line.text}</span></span>
   <span className={`panel-row__meta${task.waiting?' panel-row__meta--wait':''}`}>{t(columnLabel(task.column,writer))}</span>
  </Link>)}</div></section>
  :<section className="dp-sec"><div className="panel-card"><p className="panel-empty">{t('agentTasksEmpty')}</p></div></section>;

 const log=<section className="dp-sec"><h3 className="dp-label"><span>{t('chatTabLog')} <span className="muted num">{count??rows.length}</span></span><Link className="link-btn" href={`/c/${slug}/log?who=a:${agent}`}>{t('agentOpenLog')}</Link></h3>
  {rows.length?<div className="lg-wrap"><LogDays items={rows.map(row=>({id:row.id,at:row.created_at,node:<LogEntry row={row} people={people} me={me} slug={slug} t={t} language={language} faceSize={24}/>}))}/></div>
   :<div className="panel-card"><p className="panel-empty">{t('agentLogEmpty')}</p></div>}
  <p className="lg-forever"><PageIcon name="lock"/><span>{t('logForever')}</span></p>
 </section>;

 return {status:agentStatus({waitingMine:waiting.some(item=>item.card_id!=null&&ids.includes(item.card_id)),running:!!run}),actions:writer,tabs:{activity,tasks:tasksTab,log}};
}
