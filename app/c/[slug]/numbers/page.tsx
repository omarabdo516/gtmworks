import '../../../log.css';
import '../../../numbers.css';
import { notFound, redirect } from 'next/navigation';
import Link from '@/lib/link';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import Shell from '@/app/shell';
import { approvalQueue } from '@/lib/approval-queue';
import { localeFor } from '@/lib/i18n.mjs';
import { feedSince, formatFigure, numbersTiles, parsePeriod, type AppReading } from '@/lib/numbers.mjs';
import type { LogRow } from '@/lib/activity-log.mjs';
import { FeedWhen } from '../log/log-client';
import { WhoFace, entryLine, logColumns, logPeople, whoOf } from '../log/entries';
import { PageIcon, SystemMark } from '../log/icons';

// The Numbers page (#35, design-reference: renderDashboard). The four figures, the leads chart and the channel table
// are read only from the Company's connected apps; "Waiting for your approval" and "What the agents did this week" are
// gtmworks's own records. Connecting apps arrives with Settings: apps (#30); until then no app is connected, so the
// app figures show the empty state and no number.
const connectedReadings:AppReading[]=[];

export default async function NumbersPage({params,searchParams}:{params:Promise<{slug:string}>,searchParams:Promise<{period?:string}>}) {
 const {t,language}=await getI18n(); const {slug}=await params; const period=parsePeriod((await searchParams).period);
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/numbers${period==='30'?'?period=30':''}`)}`);
 const {data:companies}=await db.from('companies').select('id,slug,name').order('name'); const company=companies?.find(c=>c.slug===slug);
 if(!company) notFound();
 const weekAgo=feedSince();
 const [{data:person},{data:membership},{data:agentRows}]=await Promise.all([
  db.from('people').select('name').eq('id',user.id).single(),
  db.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).is('removed_at',null).maybeSingle(),
  db.from('company_log').select(logColumns).eq('company_id',company.id).eq('actor_kind','agent').gte('created_at',weekAgo).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(6),
 ]);
 const {items,cards}=await approvalQueue(db,company.id,user.id,membership?.role||'');
 const feed=(agentRows||[]) as LogRow[];
 const people=await logPeople(db,company.id,[...feed.flatMap(row=>row.card_id!=null?[row.card_id]:[]),...items.flatMap(item=>item.card_id!=null?[item.card_id]:[])]);
 const {data:submitters}=cards.length?await db.from('work_cards').select('id,review_submitter').eq('company_id',company.id).in('id',cards.map(card=>card.id)):{data:[]};
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 const {connected,tiles}=numbersTiles(connectedReadings,period);
 const periodLabel=t(period==='7'?'numbersLast7':'numbersLast30');
 const writer=membership?.role!=='viewer';
 const locale=localeFor(language);
 const money=(value:string,currency:string|null)=>currency?(language==='ar'?<>{value}<span className="kpi__unit">{currency}</span></>:<><span className="kpi__unit kpi__unit--pre">{currency}</span>{value}</>):value;
 const noApp=<div className="wait-empty dash-empty"><b>{t('numbersNoApp')}</b><span>{t('numbersNoAppNote')}</span><Link className="btn btn--secondary btn--sm" href={`/c/${slug}/connections`}><PageIcon name="plug"/>{t('numbersConnect')}</Link></div>;
 const waitFace=(item:typeof items[number])=>{
  const submitter=item.kind==='approval'?(submitters||[]).find(card=>card.id===item.id)?.review_submitter as string|null|undefined:undefined;
  if(submitter) return <WhoFace who={whoOf({actor_kind:people.identities.some(agent=>agent.id===submitter)||people.members.some(member=>member.person_id===submitter&&member.agent_role)?'agent':'person',actor_id:submitter} as LogRow,people,t)}/>;
  if(item.asked_by) return <span className="lg-av" aria-hidden="true">{Array.from(item.asked_by.trim())[0]}</span>;
  return <SystemMark/>;
 };
 return <Shell company={company} companies={companies||[]} section="numbers" title={t('numbers')} personName={person?.name||user.email||''} role={roleNames[membership?.role||'']||''} owner={membership?.role==='owner'} approvalCount={items.length}>
  <main className="numbers-page">
   <div className="dash">
    <header className="page-head"><div className="od-field"><h1 className="page-title">{t('numbers')}</h1><p className="page-sub">{t('numbersSub')}</p></div>
     <div className="segmented" role="group" aria-label={t('numbersPeriod')}>
      {(['7','30'] as const).map(value=><Link key={value} href={`/c/${slug}/numbers${value==='7'?'':'?period=30'}`} aria-current={period===value?'true':undefined}>{t(value==='7'?'numbersLast7':'numbersLast30')}</Link>)}
     </div></header>
    <div className="dash__inner">
     <div className="kpis" data-connected={connected}>{tiles.map(tile=>{const value=formatFigure(tile,locale); return <div className="kpi" key={tile.name} data-figure={tile.name}>
      <span className="kpi__label">{t(tile.label)}</span>
      {value==null?<span className="kpi__val kpi__val--none" aria-label={t('unavailable')}>—</span>:<span className="kpi__val num">{tile.money?money(value,tile.currency):value}</span>}
      <span className="kpi__delta">{value==null?t('numbersNoSource'):t('numbersSource',tile.sources.join(language==='ar'?'، ':', '),periodLabel)}</span>
     </div>;})}</div>
     <div className="dash-row">
      <section className="panel" aria-labelledby="h-chart"><div className="panel__h"><h2 id="h-chart">{t('numbersLeadsPerDay')}</h2></div>
       <div className="chart-empty">{noApp}</div></section>
      <section className="panel panel--wait" aria-labelledby="h-wait"><div className="panel__h"><h2 id="h-wait">{t(writer?'numbersWaitingYou':'numbersWaitingTeam')}</h2><span className="muted num">{items.length}</span></div>
       {items.length?<div className="panel-card">{items.map(item=>{
        const href=item.card_id!=null?`/c/${slug}/work/board/${item.card_id}`:item.conversation_id?`/c/${slug}/conversations/${item.conversation_id}`:`/c/${slug}/approvals`;
        return <Link className="panel-row" key={`${item.kind}:${item.id}`} href={href}>{waitFace(item)}
         <span className="panel-row__text"><bdi className="panel-row__t">{item.title}</bdi><span className="panel-row__d">{item.kind==='approval'?t('numbersWaitingStep',item.body):<bdi>{item.body||item.asked_by}</bdi>}</span></span>
         <span className="panel-row__meta panel-row__meta--wait"><span className="dot dot--waiting" aria-hidden="true"/>{t(writer?'numbersWaitingOnYou':'numbersWaiting')}</span></Link>;
       })}</div>
       :<div className="wait-empty"><b>{t('numbersNothingWaiting')}</b><span>{t('numbersNothingWaitingNote')}</span></div>}
      </section>
     </div>
     <div className="dash-row">
      <section className="panel" aria-labelledby="h-chan"><div className="panel__h"><h2 id="h-chan">{t('numbersByChannel')}</h2></div>
       <div className="table-wrap"><table className="table"><thead><tr>{['numbersChannel','numbersSpend','numbersLeads','numbersCostPerLead','numbersSales','numbersRevenue','numbersRoas'].map(key=><th key={key} scope="col">{t(key)}</th>)}</tr></thead>
        <tbody><tr><td colSpan={7} className="table-empty">{noApp}</td></tr></tbody></table></div></section>
      <section className="panel" aria-labelledby="h-feed"><div className="panel__h"><h2 id="h-feed">{t('numbersAgentsDid')}</h2></div>
       {feed.length?<ul className="feed">{feed.map(row=>{const who=whoOf(row,people,t); const line=entryLine(row,people,t,language); const card=row.card_id!=null?people.cards.get(row.card_id):undefined; const object=line.obj||card;
        return <li key={row.id}><WhoFace who={who}/><div className="feed__body"><span className="feed__t"><b><bdi>{who.name}</bdi></b> {line.act}{object&&<> <bdi>{language==='ar'?`«${object}»`:`“${object}”`}</bdi></>}{line.to&&<>: <bdi>{line.to}</bdi></>}</span><FeedWhen value={row.created_at}/></div></li>;
       })}</ul>:<div className="wait-empty"><span>{t('numbersAgentsNone')}</span></div>}
      </section>
     </div>
    </div>
   </div>
  </main>
 </Shell>;
}
