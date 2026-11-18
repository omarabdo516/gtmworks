// A card an Agent's reply carries (#136; design-reference: cardHTML, kvHTML): one frame for every kind, named by its
// title, around the kind's own body. Every word on it is the Agent's: the card is laid out in its title's direction, as
// the reference lays out its Arabic card right to left in either language, and every other text keeps its own. `fresh`:
// it arrived after the page was drawn, so it rises in once (design-reference: card-in). A question (#138) is answered
// in the card itself (`answer`), so it draws its own frame (app/question-card.tsx), as a step handed to the person does
// (#139, `done`; app/hand-card.tsx), and a request to allow an action (#163, `decide`, with the choices this person may
// send, `may`; app/permission-card.tsx), and an app the Agent needs (#203, `connect`; app/connect-card.tsx). The main
// Agent's question draws the reference's chip card (`chips`, #143); any other Agent's draws the lettered one.
import { ShellIcon } from '@/components/shell-icon';
import { useI18n } from '@/lib/i18n-client';
import { QuestionCard, type AnswerQuestion } from '@/app/question-card';
import { HandCard, type MarkHandDone } from '@/app/hand-card';
import { PermissionCard, type DecidePermission } from '@/app/permission-card';
import { ConnectCard, type ConnectApps } from '@/app/connect-card';
import { offeredChoices, type PermissionChoice, type ReplyCard as Card } from '@/lib/conversations';

export function ReplyCard({card,fresh,answer,chips=false,done,decide,may=[],connect}:{card:Card,fresh:boolean,answer?:AnswerQuestion,chips?:boolean,done?:MarkHandDone,decide?:DecidePermission,may?:PermissionChoice[],connect?:ConnectApps}) {
 switch(card.kind) {
  case 'question': return <QuestionCard card={card} fresh={fresh} answer={answer} chips={chips}/>;
  case 'hand': return <HandCard card={card} fresh={fresh} done={done}/>;
  case 'permission': return <PermissionCard card={card} fresh={fresh} offered={offeredChoices(card,may)} decide={decide}/>;
  case 'connect': return <ConnectCard card={card} fresh={fresh} connect={connect}/>;
  case 'draft': case 'review': return <Shown card={card} fresh={fresh}/>;
  default: { const unknown:never=card; return unknown; }
 }
}

function Shown({card,fresh}:{card:Extract<Card,{kind:'draft'|'review'}>,fresh:boolean}) {
 const {t}=useI18n();
 const label=card.kind==='review'?t('replyReviewLabel',card.title):card.title;
 return <div className={`reply-card reply-card--${card.kind}${fresh?' card-in':''}`} role="group" aria-label={label} dir="auto">{card.kind==='draft'?<DraftBody card={card}/>:<ReviewBody card={card}/>}</div>;
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
