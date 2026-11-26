'use client';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { AgentFace } from '@/components/agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { ReaderTime } from './agent-made';
import { chatPlace } from '@/lib/board-columns.mjs';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { morningTitle } from '@/lib/good-morning-title.mjs';
import { clockLabel } from '@/lib/routine-schedule.mjs';
import type { MorningCard as Card, MorningItem } from '@/lib/good-morning-card';

// The morning's card under the main Agent's greeting (#183; design-reference: checkinHTML, .ckcard): its title with one
// line summing it up, "Waiting on you" with the reader's own items (a Viewer reads "Waiting on the team"), "Ran
// overnight" with the Routine results of the Agents they see, "Handed to you" with the steps handed to them (#139), and
// the foot: when it arrives, or that it is off, with "Change the time" for the Owner and the Managers.
// Each row opens where its item is decided: its Card, its Conversation at its card, its channel or the Inbox; a result
// opens the reader's chat with its Agent.
const placeOf=(slug:string,item:MorningItem)=>chatPlace(slug,item)??(item.card_id!=null?`/c/${slug}/work/board/${item.card_id}${item.note_id?`#note-${item.note_id}`:''}`:`/c/${slug}/approvals`);
const initialOf=(name:string)=>Array.from(name.trim())[0]||'؟';

function ItemRow({slug,item,on}:{slug:string,item:MorningItem,on:'forward'|'back'}) {
 const mention=item.kind==='mention'||item.kind==='channel_mention';
 const title=mention?item.asked_by:item.title;
 const line=mention?item.body:[item.asked_by,item.body].filter(Boolean).join(' · ');
 return <Link className="panel-row" href={placeOf(slug,item)} data-kind={item.kind}>
  {item.agent?<span aria-hidden="true"><AgentFace agent={item.agent.id} size={24}/></span>:<span className="avatar ck-av" aria-hidden="true">{initialOf(item.asked_by||item.title)}</span>}
  <span className="panel-row__text"><span className="panel-row__t" dir="auto">{title}</span>
   {line&&<span className="panel-row__d"><bdi dir="auto">{line}</bdi></span>}</span>
  <span className="panel-row__meta"><ShellIcon name={on}/></span></Link>;
}

export function MorningCard({slug,card}:{slug:string,card:Card}) {
 const {t,language}=useI18n();
 const writer=!card.viewer;
 // A row's chevron points the way on: left in Arabic, right in English (design-reference: FLIP).
 const on=language==='ar'?'forward':'back';
 const waiting=card.waiting.length, night=card.overnight.length, handed=card.handed.length;
 const waitLine=!waiting?t('goodMorningWaitNone'):!writer?t('goodMorningWaitTeam',waiting):waiting===1?t('goodMorningWaitOne'):waiting===2?t('goodMorningWaitTwo'):t('goodMorningWaitMany',waiting);
 const handLine=!handed?null:writer?(handed===1?t('goodMorningHandedYou'):t('goodMorningHandedYouMany',handed)):(handed===1?t('goodMorningHandedTeam'):t('goodMorningHandedTeamMany',handed));
 const sub=[waitLine,t('goodMorningRanCount',night),...(handLine?[handLine]:[])].join(' · ');
 const foot=!card.foot?null:card.foot.on?t('goodMorningFootOn',card.foot.custom??clockLabel(t,...card.foot.time.split(':').map(Number) as [number,number])):t('goodMorningFootOff');
 return <div className="reply-card ckcard" role="group" aria-label={t('goodMorningCardLabel')}>
  <div className="card__head"><span className="tool-tile tool-tile--lg tool-tile--ink" aria-hidden="true"><ShellIcon name="sun"/></span>
   <div className="card__titles"><span className="card__title">{morningTitle(t,language,card.day)}</span><span className="card__sub">{sub}</span></div></div>
  <section className="ck-sec" aria-labelledby="ck-h-wait"><h3 className="ck-label" id="ck-h-wait">{waiting>0&&<span className="dot dot--waiting" aria-hidden="true"/>}
   <span className={waiting?'ck-label--wait':''}>{writer?t('goodMorningWaitingYou'):t('goodMorningWaitingTeam')}</span>{waiting>0&&<> <span className="num ck-label--wait">{waiting}</span></>}</h3>
   {waiting?<div className="ck-list">{card.waiting.map(item=><ItemRow key={`${item.kind}:${item.id}`} slug={slug} item={item} on={on}/>)}</div>
    :<p className="ck-empty"><ShellIcon name="check"/><span>{t('goodMorningEmpty')}</span></p>}</section>
  {night>0&&<section className="ck-sec" aria-labelledby="ck-h-night"><h3 className="ck-label" id="ck-h-night">{t('goodMorningRan')} <span className="num">{night}</span></h3>
   <div className="ck-list">{card.overnight.map(row=><Link key={row.id} className="panel-row" href={`/c/${slug}/chat/${row.agent.id}`} data-kind="overnight">
    <span aria-hidden="true"><AgentFace agent={row.agent.id} size={24}/></span>
    <span className="panel-row__text"><span className="panel-row__t" dir="auto">{row.line}</span><span className="panel-row__d"><bdi>{row.agent.name}</bdi> · <ReaderTime at={row.at} className="num" hour="numeric"/> · <bdi dir="auto">{row.routine}</bdi></span></span>
    <span className="panel-row__meta"><ShellIcon name={on}/></span></Link>)}</div></section>}
  {handed>0&&<section className="ck-sec" aria-labelledby="ck-h-hand"><h3 className="ck-label" id="ck-h-hand"><span className="badge ck-badge"><ShellIcon name="hand"/>{t('goodMorningHanded')}</span></h3>
   <div className="ck-list">{card.handed.map(item=><ItemRow key={`${item.kind}:${item.id}`} slug={slug} item={item} on={on}/>)}</div></section>}
  {foot&&<div className="ck-foot"><span>{foot}</span>{card.manage&&card.main&&<Link className="link-btn" href={overlayHref(slug,'agents',{agent:card.main,focus:'time'})}>{t('goodMorningChangeTime')}</Link>}</div>}
 </div>;
}
