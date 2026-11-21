'use client';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { prefersReducedMotion } from '@/lib/motion';
import { countAt, formatNumber, type NumbersTile } from '@/lib/numbers.mjs';

type Period='7'|'30';
// The period a person just picked. The page is drawn again for it, switch included, so its new switch takes the focus
// the old one had when it went away, unless the person has moved the focus elsewhere meanwhile.
let chosen:Period|null=null;
// The period a person just picked, for the figures it draws, and the figures the page last drew (#134): the figures of a
// period just picked count from what was shown, and figures the page opens with count from zero.
let picked:Period|null=null;
let drawn=new Map<string,number>();

// The Numbers page's "Last 7 days / Last 30 days" (design-reference: renderDashboard's segmented). After a change the
// focus stays on the period chosen (design-reference: the period's click and loadDashboard).
export function PeriodSwitch({slug,period}:{slug:string,period:Period}) {
 const {t}=useI18n(); const group=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  if(chosen!==period) return;
  chosen=null;
  const focused=document.activeElement;
  if(focused&&focused!==document.body&&!group.current?.contains(focused)) return;
  group.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
 },[period]);
 return <div className="segmented" role="group" aria-label={t('numbersPeriod')} ref={group}>
  {(['7','30'] as const).map(value=><Link key={value} href={`/c/${slug}/numbers${value==='7'?'':'?period=30'}`} aria-current={period===value?'true':undefined}
   onClick={event=>{ if(value!==period&&event.button===0&&!(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)) { chosen=value; picked=value; } }}>{t(value==='7'?'numbersLast7':'numbersLast30')}</Link>)}
 </div>;
}

// The figures while they load (#172; design-reference: renderDashboard's loading branch): four tiles, then the chart
// beside the waiting list, then the channels beside the agents' week.
export function NumbersPlaceholder() {
 const {t}=useI18n();
 const block=(height:number,key?:number)=><div key={key} className="sk" style={{height,borderRadius:'var(--gw-r-lg)'}}/>;
 return <div className="dash__inner sk-hold" aria-busy="true"><span className="sr-only">{t('numbersLoading')}</span>
  <div className="kpis" aria-hidden="true">{[0,1,2,3].map(index=>block(118,index))}</div>
  <div className="dash-row" aria-hidden="true">{block(340)}{block(220)}</div>
  <div className="dash-row" aria-hidden="true">{block(280)}{block(280)}</div>
 </div>;
}

// The four figures (parts.tsx: NumbersFigures). Once its counts have started, the row keeps what it drew for the next
// period's counts and forgets the period just picked, so a later opening of the page counts from zero again. A child's
// layout effect runs before its parent's, so every count has read both by then.
export function FigureRow({period,connected,figures,children}:{period:Period,connected:boolean,figures:{name:string,value:number|null}[],children:ReactNode}) {
 const values=JSON.stringify(figures);
 useLayoutEffect(()=>{
  drawn=new Map((JSON.parse(values) as {name:string,value:number|null}[]).flatMap(({name,value})=>value==null?[]:[[name,value] as const]));
  picked=null;
 },[period,values]);
 return <div className="kpis" data-connected={connected}>{children}</div>;
}

// One figure's number counting to its value (#134; design-reference: countUp, dashEnter): 650ms on a curve that slows at
// the end, from 0 when the page opens, from the figure shown before when the period changes, not at all when the value
// is the one shown. It is written as the tile writes it at every step, its decimals included, and ends on the exact
// value. A screen reader is given the value itself from the first frame; with reduced motion the value is drawn at once,
// by the stylesheet before the page runs (app/numbers.css) and by the count after.
export function FigureCount({name,value,digits,locale,period}:{name:NumbersTile['name'],value:number,digits:number,locale:string,period:Period}) {
 const [start]=useState(()=>picked===period?drawn.get(name)??0:0);
 const [shown,setShown]=useState(start);
 // Where the count stands, so a count cut short (the figure drawn again) goes on from there.
 const at=useRef(start);
 useLayoutEffect(()=>{
  const from=at.current;
  if(from===value||prefersReducedMotion()) { at.current=value; setShown(value); return; }
  const start=performance.now(); let frame=0;
  const step=()=>{ const now=countAt(from,value,performance.now()-start); at.current=now; setShown(now); if(now!==value) frame=requestAnimationFrame(step); };
  setShown(from); frame=requestAnimationFrame(step);
  // Drawn again with another value mid-count, it counts on from where it stands.
  return ()=>cancelAnimationFrame(frame);
 },[value]);
 return <><span className="kpi__count" aria-hidden="true">{formatNumber(shown,digits,locale)}</span><span className="kpi__final">{formatNumber(value,digits,locale)}</span></>;
}
