'use client';
// The tool calls the Engine reported for a reply's Run (#141; design-reference: stepsHTML, toggle-steps): how many and
// how long, on a button that opens and closes their list, one line per call with the tool's name, the Engine's preview
// of it and whether it ended ("Done") or failed ("Skipped", the reference's other state). Opened, the lines rise one
// after another and each check draws itself, only for a moment after opening (`is-just`). Drawn by a Conversation and a
// channel alike (#148); each supplies the words of its own catalogue.
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { useI18n } from '@/lib/i18n-client';
import type { RunSteps } from '@/lib/conversations';

export type StepsText=(key:string,...values:unknown[])=>string;
export type StepsBidiText=(key:string,...values:ReactNode[])=>ReactNode[];
const justFor=700; const arabicPlural=new Intl.PluralRules('ar');

export function StepsList({steps,c,cb}:{steps:RunSteps,c:StepsText,cb:StepsBidiText}) {
 const {language}=useI18n(); const list=useId();
 const [open,setOpen]=useState(false); const [openedAt,setOpenedAt]=useState<number|null>(null);
 useEffect(()=>{ if(openedAt===null) return; const timer=setTimeout(()=>setOpenedAt(null),justFor); return ()=>clearTimeout(timer); },[openedAt]);
 const count=steps.list.length;
 // Egyptian Arabic takes the plural for three to ten (أدوات, دقايق, ثواني) and the singular otherwise, as the reference
 // does up to ten; English, from two.
 const plural=(value:number)=>language==='ar'?arabicPlural.select(value)==='few':value!==1;
 const used=c(plural(count)?'stepsUsedMany':'stepsUsedOne',count);
 const minutes=Math.floor((steps.seconds??0)/60); const seconds=(steps.seconds??0)%60;
 const secondsText=c(plural(seconds)?'stepsSecondsMany':'stepsSeconds',seconds); const minutesText=c(plural(minutes)?'stepsMinutesMany':'stepsMinutes',minutes);
 const took=steps.seconds===null?null:!minutes?secondsText:seconds?c('stepsMinutesSeconds',minutesText,secondsText):minutesText;
 return <div className="steps">
  <button type="button" className="steps__toggle" aria-expanded={open} aria-controls={list} onClick={()=>{ setOpen(!open); setOpenedAt(open?null:Date.now()); }}>
   <span>{took?c('stepsUsedTook',used,took):used}</span><ShellIcon name="chevronDown" className="chev"/>
  </button>
  <ol className={`steps__list${open&&openedAt!==null?' is-just':''}`} id={list} hidden={!open}>{steps.list.map((step,index)=>
   <li key={index} className={`step step--${step.state==='failed'?'skipped':step.state}`} style={{'--i':index} as CSSProperties}><span className="step__dot" aria-hidden="true"/>
    <span className="step__label">{step.preview?cb('stepLine',step.tool,step.preview):<bdi>{step.tool}</bdi>}</span>
    {step.state!=='started'&&<span className="step__state">{step.state==='done'?<><ShellIcon name="check" className="step__ck"/>{c('stepDone')}</>:c('stepSkipped')}</span>}</li>)}</ol>
 </div>;
}
