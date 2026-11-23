'use client';
// The question an Agent asks with the Engine's own question tool (#138; design-reference: cardHTML's choice branch,
// .qcard, .opt). Open: the question, the hint and one lettered button per choice; the person may also answer in the
// message. Answered: the hint reads "Answered" and only the answer stays, its letter filled and a check after it, or the
// typed words with no letter when they are none of the choices. Closed: one line, since the Engine no longer waits. A
// question with no choices is answered in words.
//
// A question where several may be picked (#648) draws the same lettered rows, each a toggle (aria-pressed) whose letter
// fills and whose check shows once picked, and a Send that sends the picks as one answer, in the order they were offered;
// it can still be answered in words, except in a channel (`team`, #651), where typed words are not taken. Answered,
// every pick stays, each with its check. The main Agent asks it on this card too, since a chip is one pick, and while it
// waits for the Member it was asked of, its wait line names them.
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
// A team channel (`team`) takes no typed answer, so its chip card draws the reference's offer card with the empty
// "or type" line; a question with no choices has no chip to press and waits on the team instead.
import { useLayoutEffect, useRef, useState } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { useI18n } from '@/lib/i18n-client';
import { newId } from '@/app/conversation-composer';
import type { ReplyCard } from '@/lib/conversations';

type Question=Extract<ReplyCard,{kind:'question'}>;
// Sends a pick (its card, the choice's index, or the picked choices' indexes on a several-pick question, and the card's
// one key on this page); null when it was taken, else the refusal's message key.
export type AnswerQuestion=(card:number,choice:number|number[],answerKey:string)=>Promise<string|null>;
// design-reference: justCls. The answered card settles only on the page where it was answered, within this long.
const settling=900;

export function QuestionCard({card,fresh,answer,chips=false,waitingFor=null,team=false}:{card:Question,fresh:boolean,answer?:AnswerQuestion,chips?:boolean,waitingFor?:string|null,team?:boolean}) {
 const {t}=useI18n();
 const several=card.choices.length>0&&card.multiple;
 // A chip is one pick, so a several-pick question keeps the lettered card even for the main Agent.
 const chipCard=chips&&!several;
 // One letter per choice, in the interface's language (أ ب ج د, or A B C D). Only the lettered card draws them.
 const keys=Array.from(t('questionLetters'));
 const [answerKey]=useState(newId); const [picked,setPicked]=useState<number[]|null>(null); const [error,setError]=useState('');
 // The choices toggled on a several-pick question, not sent yet.
 const [toggled,setToggled]=useState<number[]>([]);
 const lettered=card.choices.length>0;
 // A pick, or a Send of picks, reads as answered at once; the record then confirms it, or shows the card closed.
 const said=card.state==='answered'?card.answer:card.state==='open'&&picked!==null?(several?picked.map(index=>card.choices[index]):card.choices[picked[0]]):null;
 const state=said===null?card.state:'answered';
 const [just,setJust]=useState(false); const was=useRef(state);
 useLayoutEffect(()=>{
  const before=was.current; was.current=state;
  if(before!=='open'||state!=='answered') return;
  setJust(true);
  const timer=setTimeout(()=>setJust(false),settling);
  return ()=>clearTimeout(timer);
 },[state]);
 // One pick, or a several-pick question's picks, is claimed once; a refusal gives the card back with its reason.
 const claim=async(choice:number|number[])=>{
  if(picked!==null||!answer) return;
  setPicked([choice].flat()); setError('');
  const failure=await answer(card.id,choice,answerKey);
  if(failure) { setPicked(null); setError(failure); }
 };
 const pick=(index:number)=>claim(index);
 const toggle=(index:number)=>setToggled(now=>now.includes(index)?now.filter(each=>each!==index):[...now,index].sort((a,b)=>a-b));
 const send=()=>toggled.length?claim([...toggled]):Promise.resolve();
 const head=(hint:string)=><div className="qcard__head"><span className="qcard__q">{card.question}</span><span className="qcard__hint">{hint}</span></div>;
 // The main Agent's card (design-reference: .ask1__head, .ask1__q): the question alone, since the Engine's grey "why"
 // line has no source here.
 const ask1Head=<div className="ask1__head"><span className="ask1__q">{card.question}</span></div>;
 const frame=`reply-card reply-card--question${chipCard?' reply-card--ask1':''}${fresh?' card-in':''}`;
 // The card's place in the channel, so "Waiting on you" opens it (#149).
 const place={id:`question-${card.id}`,tabIndex:-1};
 if(state==='closed') return <div className={frame} {...place} role="group" aria-label={card.question} dir="auto">{chipCard
  ?<div className="ask1__head"><span className="ask1__q">{card.question}</span><span className="qcard__hint">{t('questionClosed')}</span></div>
  :head(t('questionClosed'))}</div>;
 if(said!==null) {
  if(chipCard) return <div className={`${frame} is-resolved${just?' is-just':''}`} {...place} role="group" aria-label={`${card.question}: ${t('questionAnswered')}`} dir="auto">
   {ask1Head}
   <div className="card__outcome"><ShellIcon name="check"/><span dir="auto">{typeof said==='string'?said:said.join('\n')}</span></div>
  </div>;
  const row=(text:string,at:number)=><div key={at} className={`opt is-chosen${at<0?' opt--typed':''}`}>
   {at>=0&&<span className="opt__key" aria-hidden="true">{keys[at]}</span>}<span className="opt__t">{at>=0?card.choices[at]:text}</span><ShellIcon name="check" className="opt__check"/>
  </div>;
  const at=(text:string)=>lettered?card.choices.findIndex(choice=>choice.trim()===text.trim()):-1;
  return <div className={`${frame} is-resolved${just?' is-just':''}`} {...place} role="group" aria-label={`${card.question}: ${t('questionAnswered')}`} dir="auto">
   {head(t('questionAnswered'))}
   <div className="qcard__opts">{typeof said==='string'?row(said,at(said)):said.map(text=>row(text,at(text)))}</div>
  </div>;
 }
 // The card is someone else's to answer (#149): the main Agent's waits for the Member it was asked of, and any other
 // Agent's shows the team's wait line over its options as plain rows (design-reference: ask1HTML's wait line,
 // cardHTML's `.opt--static`).
 if(!answer) {
  const wait=waitingFor?t('questionWaitFor',waitingFor):t('questionWaitTeam');
  if(chipCard) return <div className={frame} {...place} role="group" aria-label={card.question} dir="auto">
   {ask1Head}
   <div className="card__outcome"><ShellIcon name="clock"/><span>{wait}</span></div>
  </div>;
  return <div className={frame} {...place} role="group" aria-label={card.question} dir="auto">
   {head(wait)}
   {lettered&&<div className="qcard__opts">{card.choices.map((choice,index)=><div key={index} className="opt opt--static">
    <span className="opt__key" aria-hidden="true">{keys[index]}</span><span className="opt__t">{choice}</span>
   </div>)}</div>}
  </div>;
 }
 if(chipCard) return <div className={frame} {...place} role="group" aria-label={card.question} dir="auto">
  {ask1Head}
  {lettered&&<div className="ask1__opts">{card.choices.map((choice,index)=><button key={index} type="button" className="chip" onClick={()=>void pick(index)}>{choice}</button>)}</div>}
  {team&&!lettered?<div className="card__outcome"><ShellIcon name="clock"/><span>{t('questionWaitTeam')}</span></div>
   :<p className="ask1__or">{team?'':t(lettered?'questionOrType':'questionHintWords')}</p>}
  {error&&<p className="qcard__error" role="alert">{t(error)}</p>}
 </div>;
 if(several) return <div className={frame} {...place} role="group" aria-label={card.question} dir="auto">
  {head(t(team?'questionHintPicksTeam':'questionHintPicks'))}
  <div className="qcard__opts">{card.choices.map((choice,index)=><button key={index} type="button" className="opt" aria-pressed={toggled.includes(index)} disabled={picked!==null} onClick={()=>toggle(index)}>
   <span className="opt__key" aria-hidden="true">{keys[index]}</span><span className="opt__t">{choice}</span>{toggled.includes(index)&&<ShellIcon name="check" className="opt__check"/>}
  </button>)}</div>
  {error&&<p className="qcard__error" role="alert">{t(error)}</p>}
  <div className="card__actions"><button type="button" className="btn btn--primary" disabled={!toggled.length||picked!==null} onClick={()=>void send()}>{t('questionSendPicks')}</button></div>
 </div>;
 return <div className={frame} {...place} role="group" aria-label={card.question} dir="auto">
  {head(t(lettered?'questionHint':'questionHintWords'))}
  {lettered&&<div className="qcard__opts">{card.choices.map((choice,index)=><button key={index} type="button" className="opt" onClick={()=>void pick(index)}>
   <span className="opt__key" aria-hidden="true">{keys[index]}</span><span className="opt__t">{choice}</span>
  </button>)}</div>}
  {error&&<p className="qcard__error" role="alert">{t(error)}</p>}
 </div>;
}
