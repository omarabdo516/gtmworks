'use client';
// The question an Agent asks with the Engine's own question tool (#138; design-reference: cardHTML's choice branch,
// .qcard, .opt). Open: the question, the hint and one lettered button per choice; the person may also answer in the
// message. Answered: the hint reads "Answered" and only the answer stays, its letter filled and a check after it, or the
// typed words with no letter when they are none of the choices. Closed: one line, since the Engine no longer waits. A
// question whose choices cannot be picked one by one (several may be picked, or there are none) is answered in words.
// Every word on it but the hint, the letters and "Answered" is the Engine's, so it is laid out in its own direction.
// The reference's description under each choice and its cost chip have no source in the Engine and are not drawn.
//
// The main Agent's question is the same Engine question drawn in the reference's chip form (#143; design-reference:
// ask1HTML): the question, one chip per choice and "or type the answer below"; answered, the question stays and the
// answer shows with a check, the reference's outcome line. Any other Agent's question keeps the lettered card. The
// reference's grey "why" line has no source in the Engine (it goes into the question's own words), and its offer card
// is drawn with the "or type" line too, since the Engine always allows a free answer.
//
// In a channel (#149) the card is the team's: a Member who may not answer it (a Viewer, or anyone else when the main
// Agent asked the Member whose message it answers) sees its options as plain rows under "Waiting for someone on the
// team to pick", or the main Agent's card as its wait line "Waiting for <first name>". `waitingFor` names that Member.
import { useLayoutEffect, useRef, useState } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { useI18n } from '@/lib/i18n-client';
import { newId } from '@/app/conversation-composer';
import type { ReplyCard } from '@/lib/conversations';

type Question=Extract<ReplyCard,{kind:'question'}>;
// Sends a pick (its card, the choice's index and the card's one key on this page); null when it was taken, else the
// refusal's message key.
export type AnswerQuestion=(card:number,choice:number,answerKey:string)=>Promise<string|null>;
// design-reference: justCls. The answered card settles only on the page where it was answered, within this long.
const settling=900;

export function QuestionCard({card,fresh,answer,chips=false,waitingFor=null}:{card:Question,fresh:boolean,answer?:AnswerQuestion,chips?:boolean,waitingFor?:string|null}) {
 const {t}=useI18n();
 // One letter per choice, in the interface's language (أ ب ج د, or A B C D). Only the lettered card draws them.
 const keys=Array.from(t('questionLetters'));
 const [answerKey]=useState(newId); const [picked,setPicked]=useState<number|null>(null); const [error,setError]=useState('');
 const lettered=card.choices.length>0&&!card.multiple;
 // A pick reads as answered at once; the record then confirms it, or shows the card closed.
 const said=card.state==='answered'?card.answer:card.state==='open'&&picked!==null?card.choices[picked]:null;
 const state=said===null?card.state:'answered';
 const [just,setJust]=useState(false); const was=useRef(state);
 useLayoutEffect(()=>{
  const before=was.current; was.current=state;
  if(before!=='open'||state!=='answered') return;
  setJust(true);
  const timer=setTimeout(()=>setJust(false),settling);
  return ()=>clearTimeout(timer);
 },[state]);
 const pick=async(index:number)=>{
  if(picked!==null||!answer) return;
  setPicked(index); setError('');
  const failure=await answer(card.id,index,answerKey);
  if(failure) { setPicked(null); setError(failure); }
 };
 const head=(hint:string)=><div className="qcard__head"><span className="qcard__q">{card.question}</span><span className="qcard__hint">{hint}</span></div>;
 // The main Agent's card (design-reference: .ask1__head, .ask1__q): the question alone, since the Engine's grey "why"
 // line has no source here.
 const ask1Head=<div className="ask1__head"><span className="ask1__q">{card.question}</span></div>;
 const frame=`reply-card reply-card--question${chips?' reply-card--ask1':''}${fresh?' card-in':''}`;
 // The card's place in the channel, so "Waiting on you" opens it (#149).
 const place={id:`question-${card.id}`,tabIndex:-1};
 if(state==='closed') return <div className={frame} {...place} role="group" aria-label={card.question} dir="auto">{chips
  ?<div className="ask1__head"><span className="ask1__q">{card.question}</span><span className="qcard__hint">{t('questionClosed')}</span></div>
  :head(t('questionClosed'))}</div>;
 if(said!==null) {
  if(chips) return <div className={`${frame} is-resolved${just?' is-just':''}`} {...place} role="group" aria-label={`${card.question}: ${t('questionAnswered')}`} dir="auto">
   {ask1Head}
   <div className="card__outcome"><ShellIcon name="check"/><span dir="auto">{said}</span></div>
  </div>;
  const chosen=lettered?card.choices.findIndex(choice=>choice.trim()===said.trim()):-1;
  return <div className={`${frame} is-resolved${just?' is-just':''}`} {...place} role="group" aria-label={`${card.question}: ${t('questionAnswered')}`} dir="auto">
   {head(t('questionAnswered'))}
   <div className="qcard__opts"><div className={`opt is-chosen${chosen<0?' opt--typed':''}`}>
    {chosen>=0&&<span className="opt__key" aria-hidden="true">{keys[chosen]}</span>}<span className="opt__t">{chosen>=0?card.choices[chosen]:said}</span><ShellIcon name="check" className="opt__check"/>
   </div></div>
  </div>;
 }
 // The card is someone else's to answer (#149): the main Agent's waits for the Member it was asked of, and any other
 // Agent's shows the team's wait line over its options as plain rows (design-reference: ask1HTML's wait line,
 // cardHTML's `.opt--static`).
 if(!answer) {
  if(chips) return <div className={frame} {...place} role="group" aria-label={card.question} dir="auto">
   {ask1Head}
   <div className="card__outcome"><ShellIcon name="clock"/><span>{waitingFor?t('questionWaitFor',waitingFor):t('questionWaitTeam')}</span></div>
  </div>;
  return <div className={frame} {...place} role="group" aria-label={card.question} dir="auto">
   {head(t('questionWaitTeam'))}
   {lettered&&<div className="qcard__opts">{card.choices.map((choice,index)=><div key={index} className="opt opt--static">
    <span className="opt__key" aria-hidden="true">{keys[index]}</span><span className="opt__t">{choice}</span>
   </div>)}</div>}
  </div>;
 }
 if(chips) return <div className={frame} {...place} role="group" aria-label={card.question} dir="auto">
  {ask1Head}
  {lettered&&<div className="ask1__opts">{card.choices.map((choice,index)=><button key={index} type="button" className="chip" onClick={()=>void pick(index)}>{choice}</button>)}</div>}
  <p className="ask1__or">{t(lettered?'questionOrType':'questionHintWords')}</p>
  {error&&<p className="qcard__error" role="alert">{t(error)}</p>}
 </div>;
 return <div className={frame} {...place} role="group" aria-label={card.question} dir="auto">
  {head(t(lettered?'questionHint':'questionHintWords'))}
  {lettered&&<div className="qcard__opts">{card.choices.map((choice,index)=><button key={index} type="button" className="opt" onClick={()=>void pick(index)}>
   <span className="opt__key" aria-hidden="true">{keys[index]}</span><span className="opt__t">{choice}</span>
  </button>)}</div>}
  {error&&<p className="qcard__error" role="alert">{t(error)}</p>}
 </div>;
}
