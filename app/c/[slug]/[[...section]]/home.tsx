import { ChartCard } from '@/components/paperclip/ChartCard';
import { MetricCard } from '@/components/paperclip/MetricCard';
import { CircleDot } from 'lucide-react';
import { getI18n } from '@/lib/i18n-server';
import { AuthoredTitle } from '@/lib/authored-title';
import { workDate } from '@/lib/work-date.mjs';
import { roleAgents } from '@/lib/role-agents';
import { AgentRoleFace } from '@/components/agent-role-face';
import { ActivityRow, type WorkActivity, type WorkMember } from '@/lib/work-activity';
import { homeCharts, metricValue, type HomeCard, type HomeStage } from '@/lib/home-data.mjs';
async function Bars({values}:{values:{label:string,value:number}[]|null}) { const {t,language}=await getI18n();
 if(!values) return <p className="unavailable">{t('unavailable')}</p>;
 const max=Math.max(1,...values.map(row=>row.value));
 return <ul className="chart-bars">{values.map(row=><li key={row.label}><span dir="auto">{/^\d{4}-\d{2}-\d{2}$/.test(row.label)?workDate(row.label,language):row.label}</span><span className="bar-track"><i style={{width:`${row.value/max*100}%`}}/></span><strong>{row.value}</strong></li>)}</ul>;
}
export default async function Home({slug,cards,stages,activity,members,approvalCount}:{slug:string,cards:HomeCard[]|null,stages:HomeStage[]|null,activity:WorkActivity[]|null,members:(WorkMember & {agent_role:string|null})[],approvalCount:number|null}) { const {t,language}=await getI18n();
 const charts=homeCharts(cards,stages,activity);
 const recent=cards?.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id-a.id).slice(0,5);
 return <div className="home-dashboard">
  <section className="home-agents" aria-label={t('agents')}>{roleAgents.map(agent=>{
   const member=members.find(member=>member.agent_role===agent.key);
   const current=cards?.filter(card=>member&&card.next_actor===member.person_id).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id-a.id)[0];
   return <article className="panel role-agent" key={agent.key}><h2 aria-label={t(agent.name)}><AgentRoleFace agent={agent} size={32}/>{t(agent.name)}</h2>{current?<AuthoredTitle className="link" href={`/c/${slug}/work/board/${current.id}`}>{current.title}</AuthoredTitle>:<p>{cards && stages?t('notWorkingNow'):t('unavailable')}</p>}</article>;
  })}</section>
  <section className="stats" aria-label={t('workFigures')}>{([[t('awaitingYourApproval'),approvalCount],[t('publishedThisWeek'),null],[t('bookingsThisWeek'),null],[t('stoppedCards'),null]] as const).map(([label,value])=><article className="stat" key={label}><MetricCard icon={CircleDot} label={label} value={metricValue(value,language)} valueClassName={value===null?"unavailable text-base sm:text-xl tracking-normal":undefined}/></article>)}</section>
  <section className="home-charts" aria-label={t('last14Days')}>
   <ChartCard title={t('deliveredWork')} subtitle={t('last14DaysApprovedCards')}><Bars values={charts.delivered}/></ChartCard>
   <ChartCard title={t('cardsByStage')} subtitle={t('cardsCreatedInTheLast14Days')}><Bars values={charts.stages}/></ChartCard>
   <ChartCard title={t('firstTimeAcceptance')} subtitle={t('last14DaysCardsApprovedWithoutEarlierRejection')}><div className="acceptance-chart">{charts.acceptance===null?<p className="unavailable">{t('unavailable')}</p>:<><strong>{charts.acceptance}%</strong><progress max="100" value={charts.acceptance} aria-label={t('firstTimeAcceptance')}/></>}</div></ChartCard>
  </section>
  <section className="home-recent" aria-label={t('latestUpdates')}><article className="panel"><h2>{t('recentActivity')}</h2>{activity?activity.slice().sort((a,b)=>b.id-a.id).slice(0,8).map(a=><ActivityRow key={a.id} activity={a} members={members} slug={slug} showCard/>):<p>{t('unavailable')}</p>}{activity?.length===0&&<p className="empty">{t('noActivityYet')}</p>}</article><article className="panel"><h2>{t('recentCards')}</h2>{recent?recent.map(card=><div className="detail-row" key={card.id}><AuthoredTitle className="link" href={`/c/${slug}/work/board/${card.id}`}>{card.title}</AuthoredTitle></div>):<p>{t('unavailable')}</p>}{recent?.length===0&&<p className="empty">{t('noCardsYet')}</p>}</article></section>
 </div>;
}
