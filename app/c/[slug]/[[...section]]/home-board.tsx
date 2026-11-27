'use client';
import { CircleDot } from 'lucide-react';
import { MetricCard } from '@/components/paperclip/MetricCard';
import { AuthoredTitle } from '@/lib/authored-title';
import { useI18n } from '@/lib/i18n-client';
import { metricValue } from '@/lib/home-data.mjs';
import { useBoard, useWaitingCards, type BoardCard } from '@/app/board-read';
import { cardAddress } from '@/app/board-card';

// Home's parts that show the Company's Engine board (spec #831, #846), read in the browser after the page has drawn as
// the board is (ADR 0030), from the one board read the sidebar shares (app/board-read.ts). Until it has answered they say
// nothing; when the Engine does not answer and there was no good read, they say the figure is unavailable.
// Newest made first.
const newest=(cards:BoardCard[])=>cards.slice().sort((a,b)=>(b.createdAt??0)-(a.createdAt??0));

/** The Card an Agent is working now: its newest Card In progress on the board. */
export function AgentWork({company,slug,agent}:{company:string,slug:string,agent:string}) {
 const {t}=useI18n();
 const read=useBoard(company);
 if(!read.board) return read.state==='failed'?<p>{t('unavailable')}</p>:null;
 const current=newest(read.board.cards.filter(card=>card.agent?.id===agent&&card.column==='progress'))[0];
 return current?<AuthoredTitle className="link" href={cardAddress(slug,current.id)}>{current.title}</AuthoredTitle>:<p>{t('notWorkingNow')}</p>;
}

/** How many things wait on the reader, as the sidebar's count counts them: their rows and the board's Cards on them (#841). */
export function WaitingFigure({company,rows}:{company:string,rows:number|null}) {
 const {t,language}=useI18n();
 const cards=useWaitingCards(company);
 const value=rows===null?null:cards===undefined?undefined:rows+cards.length;
 return <MetricCard icon={CircleDot} label={t('boardColWaiting')} value={value===undefined?'':metricValue(value,language)} valueClassName={value===null?'unavailable text-base sm:text-xl tracking-normal':undefined}/>;
}

/** The five Cards made last on the board. */
export function RecentCards({company,slug}:{company:string,slug:string}) {
 const {t}=useI18n();
 const read=useBoard(company);
 if(!read.board) return read.state==='failed'?<p>{t('unavailable')}</p>:null;
 const recent=newest(read.board.cards).slice(0,5);
 return recent.length?<>{recent.map(card=><div className="detail-row" key={card.id}><AuthoredTitle className="link" href={cardAddress(slug,card.id)}>{card.title}</AuthoredTitle></div>)}</>:<p className="empty">{t('noCardsYet')}</p>;
}
