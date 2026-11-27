import { MetricCard } from '@/components/paperclip/MetricCard';
import { CircleDot } from 'lucide-react';
import { getI18n } from '@/lib/i18n-server';
import { AgentFace } from '@/components/agent-face';
import { sidebarReads } from '@/app/shell';
import { metricValue } from '@/lib/home-data.mjs';
import { AgentWork, RecentCards, WaitingFigure } from './home-board';
// Home (spec #831, #846): the Company's Agents with the Card each works now, what waits on the reader, and the Cards made
// last, all from the Company's Engine board, read in the browser after the page has drawn (./home-board.tsx). The old
// board's charts and log, which only its approvals and stages fed, are gone with it.
export default async function Home({slug,companyId,waitingRows}:{slug:string,companyId:string,waitingRows:number|null}) { const {t,language}=await getI18n();
 const [[agents]]=await sidebarReads(companyId);
 return <div className="home-dashboard">
  <section className="home-agents" aria-label={t('agents')}>{agents.map(agent=><article className="panel role-agent" key={agent.id}><h2 aria-label={agent.name}><AgentFace agent={agent.id} size={32}/><bdi>{agent.name}</bdi></h2><AgentWork company={companyId} slug={slug} agent={agent.id}/></article>)}</section>
  <section className="stats" aria-label={t('workFigures')}>
   <article className="stat"><WaitingFigure company={companyId} rows={waitingRows}/></article>
   {([t('publishedThisWeek'),t('bookingsThisWeek'),t('stoppedCards')]).map(label=><article className="stat" key={label}><MetricCard icon={CircleDot} label={label} value={metricValue(null,language)} valueClassName="unavailable text-base sm:text-xl tracking-normal"/></article>)}
  </section>
  <section className="home-recent" aria-label={t('latestUpdates')}><article className="panel"><h2>{t('recentCards')}</h2><RecentCards company={companyId} slug={slug}/></article></section>
 </div>;
}
