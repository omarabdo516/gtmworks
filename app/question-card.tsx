'use client';
// The question an Agent asks with the Engine's own question tool (#138; design-reference: cardHTML's choice branch,
// .qcard, .opt). Open: the question, the hint and one lettered button per choice; the person may also answer in the
// message. Answered: the hint reads "Answered" and only the answer stays, its letter filled and a check after it, or the
// typed words with no letter when they are none of the choices. Closed: one line, since the Engine no longer waits. A
// question whose choices cannot be picked one by one (several may be picked, or there are none) is answered in words.
// Every word on it but the hint, the letters and "Answered" is the Engine's, so it is laid out in its own direction.
// The reference's description under each choice and its cost chip have no source in the Engine and are not drawn.
import { useLayoutEffect, useRef, useState } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { useI18n } from '@/lib/i18n-client';
import { newId } from '@/app/conversation-composer';
import type { ReplyCard } from '@/lib/conversations';

type Question=Extract<ReplyCard,{kind:'question'}>;
// Sends a pick (its card, the choice's index and the card's one key on this page); null when it was taken, else the
// refusal's message key.
export type AnswerQuestion=(card:number,choice:number,answerKey:string)=>Promise<string|null>;
const letters={ar:['أ','ب','ج','د'],en:['A','B','C','D']};
// design-reference: justCls. The answered card settles only on the page where it was answered, within this long.
const settling=900;

export function QuestionCard({card,fresh,answer}:{card:Question,fresh:boolean,answer?:AnswerQuestion}) {
 const {t,language}=useI18n();
 const keys=language==='ar'?letters.ar:letters.en;
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
 const frame=`reply-card reply-card--question${fresh?' card-in':''}`;
 if(state==='closed') return <div className={`${frame} is-resolved`} role="group" aria-label={card.question} dir="auto">{head(t('questionClosed'))}</div>;
 if(said!==null) {
  const chosen=lettered?card.choices.findIndex(choice=>choice.trim()===said.trim()):-1;
  return <div className={`${frame} is-resolved${just?' is-just':''}`} role="group" aria-label={`${card.question}: ${t('questionAnswered')}`} dir="auto">
   {head(t('questionAnswered'))}
   <div className="qcard__opts"><div className={`opt is-chosen${chosen<0?' opt--typed':''}`}>
    {chosen>=0&&<span className="opt__key" aria-hidden="true">{keys[chosen]}</span>}<span className="opt__t">{chosen>=0?card.choices[chosen]:said}</span><ShellIcon name="check" className="opt__check"/>
   </div></div>
  </div>;
 }
 return <div className={frame} role="group" aria-label={card.question} dir="auto">
  {head(t(lettered?'questionHint':'questionHintWords'))}
  {lettered&&<div className="qcard__opts">{card.choices.map((choice,index)=><button key={index} type="button" className="opt" onClick={()=>void pick(index)}>
   <span className="opt__key" aria-hidden="true">{keys[index]}</span><span className="opt__t">{choice}</span>
  </button>)}</div>}
  {error&&<p className="qcard__error" role="alert">{t(error)}</p>}
 </div>;
}
