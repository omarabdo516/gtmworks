import '../../../log.css';
import '../../../numbers.css';
import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { getI18n } from '@/lib/i18n-server';
import type { supabase } from '@/lib/supabase';
import { companyReader } from '@/lib/company-reader';
import { ShellPage } from '@/app/shell-page';
import { approvalQueue } from '@/lib/approval-queue';
import { localeFor } from '@/lib/i18n.mjs';
import { feedSince, parsePeriod, readNumbers } from '@/lib/numbers.mjs';
import type { LogRow } from '@/lib/activity-log.mjs';
import { FeedWhen } from '../log/log-client';
import { FeedText, WhoFace, logColumns, logPeople, whoOf } from '../log/entries';
import { SystemMark } from '../log/icons';
import { AgentFace } from '@/components/agent-face';
import { NoApp, NumbersFigures, NumbersHead, WaitingRow } from './parts';
import { NumbersPlaceholder } from './numbers-client';

// The Numbers page (#35, design-reference: renderDashboard). The four figures, the leads chart and the channel table
// are read only from the Company's connected apps; "Waiting for your approval" and "What the agents did this week" are
// gtmworks's own records. The app figures are read through readNumbers (lib/numbers.mjs); connecting apps arrives with
// Settings: apps (#30), and until then no app is connected, so they show the empty state and no number.
// The page, its title and its period switch are drawn first; the figures follow, with the reference's placeholder in
// their place until they arrive (#172).

export default async function NumbersPage({params,searchParams}:{params:Promise<{slug:string}>,searchParams:Promise<{period?:string}>}) {
 const {t,language}=await getI18n(); const {slug}=await params; const period=parsePeriod((await searchParams).period);
 const reader=await companyReader(slug);
 if(!reader) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/numbers${period==='30'?'?period=30':''}`)}`);
 const {db,user,company,role}=reader;
 if(!company) notFound();
 // Read beside the figures: the sidebar counts it once it arrives, and the figures list it.
 const queue=approvalQueue(db,company.id,user.id,role);
 return <><ShellPage approvals={queue.then(({count})=>count)}/>
  <main className="numbers-page">
   <div className="dash">
    <NumbersHead t={t} slug={slug} period={period}/>
    <Suspense key={period} fallback={<NumbersPlaceholder/>}>
     <Figures db={db} company={company.id} slug={slug} period={period} writer={role!=='viewer'} queue={queue} t={t} language={language}/>
    </Suspense>
   </div>
  </main>
 </>;
}

type Db=Awaited<ReturnType<typeof supabase>>;
type I18n=Awaited<ReturnType<typeof getI18n>>;
async function Figures({db,company,slug,period,writer,queue,t,language}:{db:Db,company:string,slug:string,period:'7'|'30',writer:boolean,queue:ReturnType<typeof approvalQueue>,t:I18n['t'],language:I18n['language']}) {
 const [{data:agentRows},{connected,tiles},{items,cards}]=await Promise.all([
  db.from('company_log').select(logColumns).eq('company_id',company).eq('actor_kind','agent').gte('created_at',feedSince()).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(6),
  readNumbers({company,period}),
  queue,
 ]);
 const feed=(agentRows||[]) as LogRow[];
 const people=await logPeople(db,company,[...feed.flatMap(row=>row.card_id!=null?[row.card_id]:[]),...items.flatMap(item=>item.card_id!=null?[item.card_id]:[])]);
 const {data:submitters}=cards.length?await db.from('work_cards').select('id,review_submitter').eq('company_id',company).in('id',cards.map(card=>card.id)):{data:[]};
 const locale=localeFor(language);
 const noApp=<NoApp t={t} slug={slug}/>;
 const waitFace=(item:typeof items[number])=>{
  const submitter=item.kind==='approval'?(submitters||[]).find(card=>card.id===item.id)?.review_submitter as string|null|undefined:undefined;
  if(submitter) return <WhoFace who={whoOf({actor_kind:'person',actor_id:submitter} as LogRow,people,t)}/>;
  // A permission request (#165) is its Agent's, so it shows the Agent's face (design-reference: renderDashboard's face(w.agent)).
  if(item.agent) return <span className="lg-face" aria-hidden="true"><AgentFace agent={item.agent.id} size={28}/></span>;
  if(item.asked_by) return <span className="lg-av" aria-hidden="true">{Array.from(item.asked_by.trim())[0]}</span>;
  return <SystemMark/>;
 };
 return <div className="dash__inner">
  <NumbersFigures t={t} language={language} locale={locale} period={period} connected={connected} tiles={tiles}/>
  <div className="dash-row">
   <section className="panel" aria-labelledby="h-chart"><div className="panel__h"><h2 id="h-chart">{t('numbersLeadsPerDay')}</h2></div>
    <div className="chart-empty">{noApp}</div></section>
   <section className="panel panel--wait" aria-labelledby="h-wait"><div className="panel__h"><h2 id="h-wait">{t(writer?'numbersWaitingYou':'numbersWaitingTeam')}</h2><span className="muted num">{items.length}</span></div>
    {items.length?<div className="panel-card">{items.map(item=><WaitingRow key={`${item.kind}:${item.id}`} t={t} slug={slug} writer={writer} item={item} face={waitFace(item)}/>)}</div>
    :<div className="wait-empty"><b>{t('numbersNothingWaiting')}</b><span>{t('numbersNothingWaitingNote')}</span></div>}
   </section>
  </div>
  <div className="dash-row">
   <section className="panel" aria-labelledby="h-chan"><div className="panel__h"><h2 id="h-chan">{t('numbersByChannel')}</h2></div>
    <div className="table-wrap"><table className="table"><thead><tr>{['numbersChannel','numbersSpend','numbersLeads','numbersCostPerLead','numbersSales','numbersRevenue','numbersRoas'].map(key=><th key={key} scope="col">{t(key)}</th>)}</tr></thead>
     <tbody><tr><td colSpan={7} className="table-empty">{noApp}</td></tr></tbody></table></div></section>
   <section className="panel" aria-labelledby="h-feed"><div className="panel__h"><h2 id="h-feed">{t('numbersAgentsDid')}</h2></div>
    {feed.length?<ul className="feed">{feed.map(row=><li key={row.id}><WhoFace who={whoOf(row,people,t)}/><div className="feed__body"><span className="feed__t"><FeedText row={row} people={people} t={t} language={language}/></span><FeedWhen value={row.created_at}/></div></li>)}</ul>:<div className="wait-empty"><span>{t('numbersAgentsNone')}</span></div>}
   </section>
  </div>
 </div>;
}
