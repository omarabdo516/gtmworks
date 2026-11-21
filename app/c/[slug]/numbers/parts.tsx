import type { ReactNode } from 'react';
import Link from '@/lib/link';
import type { I18n, Language } from '@/lib/i18n.mjs';
import type { WaitingItem } from '@/lib/approval-queue';
import { figureDigits, type NumbersTile, type Period } from '@/lib/numbers.mjs';
import { chatPlace } from '@/lib/board-columns.mjs';
import { PageIcon } from '../log/icons';
import { FigureCount, FigureRow, PeriodSwitch } from './numbers-client';

// The parts of the Numbers page (page.tsx) drawn from what the server read. They import no server code, so a component
// test draws them as the page does.
type T=I18n['t'];

export function NumbersHead({t,slug,period}:{t:T,slug:string,period:Period}) {
 return <header className="page-head"><div className="od-field"><h1 className="page-title">{t('numbers')}</h1><p className="page-sub">{t('numbersSub')}</p></div>
  <PeriodSwitch slug={slug} period={period}/></header>;
}

export function NumbersFigures({t,language,locale,period,connected,tiles}:{t:T,language:Language,locale:string,period:Period,connected:boolean,tiles:NumbersTile[]}) {
 const periodLabel=t(period==='7'?'numbersLast7':'numbersLast30');
 const money=(value:ReactNode,currency:string|null)=>currency?(language==='ar'?<>{value}<span className="kpi__unit">{currency}</span></>:<><span className="kpi__unit kpi__unit--pre">{currency}</span>{value}</>):value;
 // Each figure with a value counts up to it (FigureCount, #134); an unavailable one is drawn as it is.
 return <FigureRow period={period} connected={connected} figures={tiles.map(({name,value})=>({name,value}))}>{tiles.map(tile=>{const value=tile.value; const count=value==null?null:<FigureCount name={tile.name} value={value} digits={figureDigits(tile.name)} locale={locale} period={period}/>; return <div className="kpi" key={tile.name} data-figure={tile.name}>
  <span className="kpi__label">{t(tile.label)}</span>
  {count==null?<span className="kpi__val kpi__val--none" aria-label={t('unavailable')}>—</span>:<span className="kpi__val num">{tile.money?money(count,tile.currency):count}</span>}
  <span className="kpi__delta">{count==null?t('numbersNoSource'):t('numbersSource',tile.sources.join(language==='ar'?'، ':', '),periodLabel)}</span>
 </div>;})}</FigureRow>;
}

export function NoApp({t,slug}:{t:T,slug:string}) {
 return <div className="wait-empty dash-empty"><b>{t('numbersNoApp')}</b><span>{t('numbersNoAppNote')}</span><Link className="btn btn--secondary btn--sm" href={`/c/${slug}/connections`}><PageIcon name="plug"/>{t('numbersConnect')}</Link></div>;
}

// One row of what waits on the reader. An Agent waiting for the Company's key (#299) names no Card or Conversation, so it
// gives its reason and opens "Waiting on you", where its card says how the wait ends. A mention in a channel (#200) opens
// that channel at its message, and a general channel has no name of its own to store, so the reader draws its word.
export function WaitingRow({t,slug,writer,item,face}:{t:T,slug:string,writer:boolean,item:WaitingItem,face:ReactNode}) {
 const href=(item.kind==='permission'||item.kind==='channel_permission'||item.kind==='channel_mention'||item.kind==='channel_question'||item.kind==='channel_hand')&&chatPlace(slug,item)||(item.card_id!=null?`/c/${slug}/work/board/${item.card_id}`:item.conversation_id?`/c/${slug}/conversations/${item.conversation_id}`:`/c/${slug}/approvals`);
 const detail=item.kind==='approval'?t('numbersWaitingStep',item.body):item.kind==='agent_key'?t('waitingAgentKeyReason'):<bdi>{item.body||item.asked_by}</bdi>;
 return <Link className="panel-row" href={href}>{face}
  <span className="panel-row__text"><bdi className="panel-row__t">{item.title||t('shellGeneralChannel')}</bdi><span className="panel-row__d">{detail}</span></span>
  <span className="panel-row__meta panel-row__meta--wait"><span className="dot dot--waiting" aria-hidden="true"/>{t(writer?'numbersWaitingOnYou':'numbersWaiting')}</span></Link>;
}
