'use client';
import type { CSSProperties, MouseEvent } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { ShellIcon, type ShellIconName } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import type { CardSymbol } from '@/lib/board-columns.mjs';
import type { BoardCard } from '@/app/board-read';

// One shape, one colour and one name for each state (design-reference-card: SYMS); the name is the tooltip and what
// assistive technology reads. "On you" (the hand) marks a Card that waits on the reader (#841).
type SymbolKind=CardSymbol['kind']|'onYou';
const symbols:{[kind in SymbolKind]:{icon?:ShellIconName,tone:'ok'|'wait'|'bad'|'mute'}}={
 working:{tone:'ok'},question:{icon:'ask',tone:'wait'},review:{icon:'needsReview',tone:'wait'},failed:{icon:'alert',tone:'bad'},stopped:{icon:'stop',tone:'mute'},waits:{icon:'hourglass',tone:'mute'},
 // A review's outcome, which only the Card's own read knows (#839): no board Card carries one.
 sentBack:{icon:'sendBack',tone:'mute'},passed:{icon:'passed',tone:'ok'},
 onYou:{icon:'hand',tone:'wait'},
};
const symbolKey={working:'symWorking',question:'symQuestion',review:'symReview',failed:'symFailed',stopped:'symStopped',waits:'symWaits',sentBack:'symSentBack',passed:'symPassed',onYou:'symOnYou'} as const;

/**
 * A Card of the Engine's board as a tile (spec #831, #834; design-reference-card: kcardHTML): its title, which opens it,
 * the symbol of what it is doing, the hand when it waits on the reader (#841), its Assignee's face and its comments. In
 * Waiting on you a Card that waits on someone else names them for assistive technology. `selecting` draws it in select
 * mode (#842), where a press chooses it.
 */
export function BoardCardTile({card,href,open,columnName,flash=false,selecting=null}:{card:BoardCard,href:string,open?:(event:MouseEvent<HTMLAnchorElement>)=>void,
 columnName:(column:string)=>string,flash?:boolean,selecting?:{chosen:boolean,flip:()=>void}|null}) {
 const {t}=useI18n();
 const symbolName=(symbol:CardSymbol|{kind:'onYou'})=>symbol.kind==='waits'&&symbol.count>1?t('symWaitsN',symbol.count):t(symbolKey[symbol.kind]);
 const who=card.agent?.name||card.person?.name||t('boardCardNoOne');
 const comments=card.comments===1?t('boardCardComment'):t('boardCardComments',card.comments);
 const shown:(CardSymbol|{kind:'onYou'})[]=[...card.symbol?[card.symbol]:[],...card.waits?.mine?[{kind:'onYou'} as const]:[]];
 const waitsOn=card.column==='waiting'&&card.waits&&!card.waits.mine?card.waits.person?t('boardWaitingOn',card.waits.person.name.trim().split(/\s+/)[0]||card.waits.person.name):t('boardWaitingLeads'):'';
 const label=[card.title,columnName(card.column),...shown.map(symbolName),waitsOn,t('boardCardAssignee',who),card.comments?comments:''].filter(Boolean).join(' · ');
 return <article className={`kcard card${flash?' is-flash':''}${selecting?' is-sel':''}`} data-card={card.id} data-mine={card.waits?.mine||undefined} aria-label={label}>
  <span className="kt-head">{selecting?<button type="button" className="authored-title kcard__title kcard__pick" dir="auto" aria-pressed={selecting.chosen} onClick={selecting.flip}><strong>{card.title}</strong></button>
   :<a className="kcard__title authored-title" dir="auto" href={href} onClick={open}><strong>{card.title}</strong></a>}
   {shown.length>0&&<span className="kt-syms">{shown.map(symbol=>{ const look=symbols[symbol.kind];
    return <span key={symbol.kind} className={`sym sym--${look.tone}`} data-sym={symbol.kind} role="img" aria-label={symbolName(symbol)} title={symbolName(symbol)}>
     {look.icon?<ShellIcon name={look.icon}/>:<span className="sym__dot"/>}{symbol.kind==='waits'&&symbol.count>1&&<span className="sym__n num" aria-hidden="true">{symbol.count}</span>}</span>; })}</span>}</span>
  <span className="kcard__foot">
   <span className="kt-face" title={who}>{card.agent?<AgentFace agent={card.agent.id} size={20}/>:card.person?<span className="me__av lg-av" style={{'--av':'20px'} as CSSProperties} aria-hidden="true">{Array.from(card.person.name.trim())[0]||'?'}</span>:<span className="cw-noone" style={{'--av':'20px'} as CSSProperties} aria-hidden="true"/>}</span>
   {card.comments>0&&<span className="kt-metas"><span className="kt-m" title={comments}><ShellIcon name="chat"/><span className="num">{card.comments}</span></span></span>}
  </span>
  {selecting&&<span className="kt-check" aria-hidden="true">{selecting.chosen&&<ShellIcon name="check"/>}</span>}
 </article>;
}
