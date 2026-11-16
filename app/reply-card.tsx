// A card an Agent's reply carries (#136; design-reference: cardHTML, kvHTML): one frame for every kind, named by its
// title, around the kind's own body. Every word on it is the Agent's: the card is laid out in its title's direction, as
// the reference lays out its Arabic card right to left in either language, and every other text keeps its own. `fresh`:
// it arrived after the page was drawn, so it rises in once (design-reference: card-in).
import { ShellIcon } from '@/components/shell-icon';
import { useI18n } from '@/lib/i18n-client';
import type { ReplyCard as Card } from '@/lib/conversations';

export function ReplyCard({card,fresh}:{card:Card,fresh:boolean}) {
 const {t}=useI18n();
 const label=card.kind==='review'?t('replyReviewLabel',card.title):card.title;
 return <div className={`reply-card reply-card--${card.kind}${fresh?' card-in':''}`} role="group" aria-label={label} dir="auto"><Body card={card}/></div>;
}

function Body({card}:{card:Card}) {
 switch(card.kind) {
  case 'draft': return <DraftBody card={card}/>;
  case 'review': return <ReviewBody card={card}/>;
  default: { const unknown:never=card; return unknown; }
 }
}

// A draft (design-reference: the plan card): the ink tile with the file icon, the title, the line under it and its rows.
function DraftBody({card}:{card:Extract<Card,{kind:'draft'}>}) {
 return <>
  <div className="card__head"><span className="tool-tile tool-tile--lg tool-tile--ink" aria-hidden="true"><ShellIcon name="file"/></span>
   <div className="card__titles"><span className="card__title">{card.title}</span><span className="card__sub" dir="auto">{card.line}</span></div></div>
  {card.rows.length>0&&<dl className="kv">{card.rows.map((row,index)=><div key={index} className="kv__row"><dt dir="auto">{row.label}</dt><dd dir="auto">{row.value}</dd></div>)}</dl>}
 </>;
}

// A review (#137; design-reference: the review card): the ink tile with the review icon, the title, the line under it,
// one numbered verdict per reviewed text with the Agent's note under it, and the decision last.
function ReviewBody({card}:{card:Extract<Card,{kind:'review'}>}) {
 const {t}=useI18n();
 return <>
  <div className="card__head"><span className="tool-tile tool-tile--lg tool-tile--ink" aria-hidden="true"><ShellIcon name="review"/></span>
   <div className="card__titles"><span className="card__title">{card.title}</span><span className="card__sub" dir="auto">{card.line}</span></div></div>
  <ol className="rv-list">{card.items.map((item,index)=><li key={index} className="rv-item">
   <div className="rv-item__top"><span className="rv-n num">{index+1}</span><span className="rv-q">«{item.text}»</span>
    <span className={`badge rv-badge${item.fine?'':' is-fix'}`}><ShellIcon name={item.fine?'check':'pencil'}/>{t(item.fine?'replyReviewFine':'replyReviewEdit')}</span></div>
   <p className="rv-note">{item.note}</p></li>)}</ol>
  <div className="rv-decision"><span className="rv-decision__l">{t('replyReviewDecision')}</span><span className="rv-decision__t">{card.decision}</span></div>
 </>;
}
