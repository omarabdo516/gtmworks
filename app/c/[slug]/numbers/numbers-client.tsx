'use client';
import { useLayoutEffect, useRef } from 'react';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';

type Period='7'|'30';
// The period a person just picked. The page is drawn again for it, switch included, so its new switch takes the focus.
let chosen:Period|null=null;

// The Numbers page's "Last 7 days / Last 30 days" (design-reference: renderDashboard's segmented). After a change the
// focus stays on the period chosen (design-reference: the period's click and loadDashboard).
export function PeriodSwitch({slug,period}:{slug:string,period:Period}) {
 const {t}=useI18n(); const group=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  if(chosen!==period) return;
  chosen=null;
  group.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
 },[period]);
 return <div className="segmented" role="group" aria-label={t('numbersPeriod')} ref={group}>
  {(['7','30'] as const).map(value=><Link key={value} href={`/c/${slug}/numbers${value==='7'?'':'?period=30'}`} aria-current={period===value?'true':undefined}
   onClick={event=>{ if(value!==period&&event.button===0&&!(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)) chosen=value; }}>{t(value==='7'?'numbersLast7':'numbersLast30')}</Link>)}
 </div>;
}

// The figures while they load (#172; design-reference: renderDashboard's loading branch): four tiles, then the chart
// beside the waiting list, then the channels beside the agents' week.
export function NumbersPlaceholder() {
 const {t}=useI18n();
 const block=(height:number,key?:number)=><div key={key} className="sk" style={{height,borderRadius:'var(--gw-r-lg)'}}/>;
 return <div className="dash__inner sk-hold" aria-busy="true" aria-label={t('numbersLoading')}>
  <div className="kpis">{[0,1,2,3].map(index=>block(118,index))}</div>
  <div className="dash-row">{block(340)}{block(220)}</div>
  <div className="dash-row">{block(280)}{block(280)}</div>
 </div>;
}
