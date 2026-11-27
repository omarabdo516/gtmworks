'use client';
import type { AnchorHTMLAttributes, CSSProperties, MouseEvent } from 'react';
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

type Selecting={chosen:boolean,flip:()=>void}|null;
type LinkProps=Omit<AnchorHTMLAttributes<HTMLAnchorElement>,'className'|'dir'|'href'|'onClick'|'children'>;

/**
 * What a Card of the Engine's board says of itself for assistive technology (design-reference-card: kcardHTML's aria):
 * its title, its column, its symbols with the hand when it waits on the reader (#841), whom it waits on in Waiting on
 * you when that is someone else, its Assignee and its comments.
 */
export function useCardLabel(columnName:(column:string)=>string) {
 const {t}=useI18n();
 return (card:BoardCard)=>{
  const who=card.agent?.name||card.person?.name||t('boardCardNoOne');
  const comments=card.comments===1?t('boardCardComment'):t('boardCardComments',card.comments);
  const waitsOn=card.column==='waiting'&&card.waits&&!card.waits.mine?card.waits.person?t('boardWaitingOn',card.waits.person.name.trim().split(/\s+/)[0]||card.waits.person.name):t('boardWaitingLeads'):'';
  return [card.title,columnName(card.column),...symbolsOf(card).map(symbol=>symbolName(t,symbol)),waitsOn,t('boardCardAssignee',who),card.comments?comments:''].filter(Boolean).join(' · ');
 };
}
const symbolsOf=(card:BoardCard):(CardSymbol|{kind:'onYou'})[]=>[...card.symbol?[card.symbol]:[],...card.waits?.mine?[{kind:'onYou'} as const]:[]];
const symbolName=(t:(key:string,...values:unknown[])=>string,symbol:CardSymbol|{kind:'onYou'})=>symbol.kind==='waits'&&symbol.count>1?t('symWaitsN',symbol.count):t(symbolKey[symbol.kind]);

/**
 * What a tile of the Engine's board draws inside it (spec #831, #834; design-reference-card: kcardHTML): its title, which
 * opens it, the symbol of what it is doing and the hand when it waits on the reader (#841), its Assignee's face and its
 * comments. `selecting` draws it in select mode (#842), where a press chooses it; `link` adds to the title's link what
 * the board's drag and keyboard moves need (#837).
 */
export function BoardCardBody({card,href,open,selecting=null,link}:{card:BoardCard,href:string,open?:(event:MouseEvent<HTMLAnchorElement>)=>void,selecting?:Selecting,link?:LinkProps}) {
 const {t}=useI18n();
 const who=card.agent?.name||card.person?.name||t('boardCardNoOne');
 const comments=card.comments===1?t('boardCardComment'):t('boardCardComments',card.comments);
 const shown=symbolsOf(card);
 return <>
  <span className="kt-head">{selecting?<button type="button" className="authored-title kcard__title kcard__pick" dir="auto" aria-pressed={selecting.chosen} onClick={selecting.flip}><strong>{card.title}</strong></button>
   :<a {...link} className="kcard__title authored-title" dir="auto" href={href} onClick={open}><strong>{card.title}</strong></a>}
   {shown.length>0&&<span className="kt-syms">{shown.map(symbol=>{ const look=symbols[symbol.kind]; const name=symbolName(t,symbol);
    return <span key={symbol.kind} className={`sym sym--${look.tone}`} data-sym={symbol.kind} role="img" aria-label={name} title={name}>
     {look.icon?<ShellIcon name={look.icon}/>:<span className="sym__dot"/>}{symbol.kind==='waits'&&symbol.count>1&&<span className="sym__n num" aria-hidden="true">{symbol.count}</span>}</span>; })}</span>}</span>
  <span className="kcard__foot">
   <span className="kt-face" title={who}>{card.agent?<AgentFace agent={card.agent.id} size={20}/>:card.person?<span className="me__av lg-av" style={{'--av':'20px'} as CSSProperties} aria-hidden="true">{Array.from(card.person.name.trim())[0]||'?'}</span>:<span className="cw-noone" style={{'--av':'20px'} as CSSProperties} aria-hidden="true"/>}</span>
   {card.comments>0&&<span className="kt-metas"><span className="kt-m" title={comments}><ShellIcon name="chat"/><span className="num">{card.comments}</span></span></span>}
  </span>
  {selecting&&<span className="kt-check" aria-hidden="true">{selecting.chosen&&<ShellIcon name="check"/>}</span>}
 </>;
}

/** A Card of the Engine's board as a tile of its own, outside the board's columns: in Waiting on you (#841). */
export function BoardCardTile({card,href,columnName}:{card:BoardCard,href:string,columnName:(column:string)=>string}) {
 const label=useCardLabel(columnName);
 return <article className="kcard card" data-card={card.id} data-mine={card.waits?.mine||undefined} aria-label={label(card)}><BoardCardBody card={card} href={href}/></article>;
}
