'use client';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { cardColumns, columnLabel } from '@/lib/board-columns.mjs';
import { useBoard } from '@/app/board-read';
import { cardAddress } from '@/app/board-card';

// An Agent's Cards on the Company's Engine board (spec #831, #846), in the details panel's Tasks tab: read in the browser
// after the panel is drawn, from the one board read the page shares (app/board-read.ts), column by column, each opening
// over the board. Until the board has answered the tab says nothing; with no good read it says it cannot be read.
export function AgentBoardTasks({company,slug,agent,writer}:{company:string,slug:string,agent:string,writer:boolean}) {
 const {t}=useI18n();
 const read=useBoard(company);
 const board=`/c/${slug}/work/board`;
 if(!read.board) return read.state==='failed'?<section className="dp-sec"><div className="panel-card"><p className="panel-empty">{t('boardReadFailed')}</p></div></section>:null;
 const cards=read.board.cards.filter(card=>card.agent?.id===agent).sort((a,b)=>cardColumns.indexOf(a.column)-cardColumns.indexOf(b.column));
 if(!cards.length) return <section className="dp-sec"><div className="panel-card"><p className="panel-empty">{t('agentTasksEmpty')}</p></div></section>;
 return <section className="dp-sec"><h3 className="dp-label"><span>{t('agentOnTheBoard')}</span><Link className="link-btn" href={board}>{t('agentOpenBoard')}</Link></h3>
  <div className="panel-card">{cards.map(card=><Link key={card.id} className="panel-row" href={cardAddress(slug,card.id)}>
   <span className="panel-row__text"><span className="panel-row__t"><bdi>{card.title}</bdi></span></span>
   <span className={`panel-row__meta${card.column==='waiting'?' panel-row__meta--wait':''}`}>{t(columnLabel(card.column,writer))}</span>
  </Link>)}</div></section>;
}
