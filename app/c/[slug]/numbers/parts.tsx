import Link from '@/lib/link';
import type { I18n, Language } from '@/lib/i18n.mjs';
import { formatFigure, type NumbersTile, type Period } from '@/lib/numbers.mjs';
import { PageIcon } from '../log/icons';

// The parts of the Numbers page (page.tsx) drawn from what the server read. They import no server code, so a component
// test draws them as the page does.
type T=I18n['t'];

export function NumbersHead({t,slug,period}:{t:T,slug:string,period:Period}) {
 return <header className="page-head"><div className="od-field"><h1 className="page-title">{t('numbers')}</h1><p className="page-sub">{t('numbersSub')}</p></div>
  <div className="segmented" role="group" aria-label={t('numbersPeriod')}>
   {(['7','30'] as const).map(value=><Link key={value} href={`/c/${slug}/numbers${value==='7'?'':'?period=30'}`} aria-current={period===value?'true':undefined}>{t(value==='7'?'numbersLast7':'numbersLast30')}</Link>)}
  </div></header>;
}

export function NumbersFigures({t,language,locale,period,connected,tiles}:{t:T,language:Language,locale:string,period:Period,connected:boolean,tiles:NumbersTile[]}) {
 const periodLabel=t(period==='7'?'numbersLast7':'numbersLast30');
 const money=(value:string,currency:string|null)=>currency?(language==='ar'?<>{value}<span className="kpi__unit">{currency}</span></>:<><span className="kpi__unit kpi__unit--pre">{currency}</span>{value}</>):value;
 return <div className="kpis" data-connected={connected}>{tiles.map(tile=>{const value=formatFigure(tile,locale); return <div className="kpi" key={tile.name} data-figure={tile.name}>
  <span className="kpi__label">{t(tile.label)}</span>
  {value==null?<span className="kpi__val kpi__val--none" aria-label={t('unavailable')}>—</span>:<span className="kpi__val num">{tile.money?money(value,tile.currency):value}</span>}
  <span className="kpi__delta">{value==null?t('numbersNoSource'):t('numbersSource',tile.sources.join(language==='ar'?'، ':', '),periodLabel)}</span>
 </div>;})}</div>;
}

export function NoApp({t,slug}:{t:T,slug:string}) {
 return <div className="wait-empty dash-empty"><b>{t('numbersNoApp')}</b><span>{t('numbersNoAppNote')}</span><Link className="btn btn--secondary btn--sm" href={`/c/${slug}/connections`}><PageIcon name="plug"/>{t('numbersConnect')}</Link></div>;
}
