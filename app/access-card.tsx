'use client';
// The main Agent asks whether to request an Agent hidden from its person (#167; design-reference: askMgrHTML,
// answerAgentAskMgr, the ask-mgr case): the ink tile with the team icon, "Ask {first name} for it?" and who chooses which
// agents each person works with, then "No, never mind" and "Ask {first name}". A press is kept by the database once
// (press_agent_access) and the card reads its outcome with the time: what was sent, or that nothing was; each with its
// toast, and the message field takes the focus back. The card never names the hidden Agent: nothing of it reaches the
// page. Someone who may not write sees the wait line instead of the buttons. The card follows the interface's direction.
import { useRef, useState, type ReactNode } from 'react';
import { ShellIcon } from '@/components/shell-icon';
import { useI18n } from '@/lib/i18n-client';
import { ReaderTime } from '@/app/agent-made';
import { toast } from '@/app/toast';
import type { AgentAccessView } from '@/lib/conversations';

// How a press is kept: the state the card now reads and when it was pressed, or the failure to say.
// `available`: the person sees the Agent by now, so nothing was sent.
// A kept press also asks the chat to read its record again (`reread`), so an answer that comes later reaches it.
export type PressAccess=(request:number,ask:boolean)=>Promise<{state:'asked'|'dismissed',at:string}|{state:'available'}|{error:string}>;

// `c` and `cb` are the Conversation's own words (useConversationText), passed by the chat that draws the card.
export function AccessCard({card,fresh,press,c,cb}:{card:AgentAccessView,fresh:boolean,press?:PressAccess,c:(key:string,...values:unknown[])=>string,cb:(key:string,...values:ReactNode[])=>ReactNode[]}) {
 const {t}=useI18n();
 const [pressed,setPressed]=useState<{state:'asked'|'dismissed',at:string,just:boolean}|{state:'available',just:boolean}|null>(null);
 const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const root=useRef<HTMLDivElement>(null); const held=useRef(false);
 // What a press here ended in, else the record's.
 const shown=pressed??('at' in card?{state:card.state==='dismissed'?'dismissed' as const:'asked' as const,at:card.at,just:false}:card.state==='available'?{state:'available' as const,just:false}:null);
 const first=card.named.first||card.named.name; const role=card.named.role==='owner'?t('owner'):t('manager');
 // Today its time, another day its day, as the chat's other cards say when they were answered.
 const when=(at:string)=><ReaderTime at={at} orDay/>;
 const answer=async(ask:boolean)=>{
  if(held.current||!press) return;
  held.current=true; setBusy(true); setError('');
  const result=await press(card.id,ask);
  held.current=false; setBusy(false);
  if('error' in result) { setError(result.error); return; }
  setPressed({...result,just:true});
  if(result.state!=='available') toast(result.state==='asked'?c('accessToastSent',first):c('accessToastNotSent'),{icon:result.state==='asked'?'check':'x'});
  (root.current?.closest('.chat, dialog')??document).querySelector<HTMLTextAreaElement>('.composer__input')?.focus();
 };
 const outcome=shown?.state==='asked'
  ?<div className="card__outcome"><ShellIcon name="check"/><span>{cb('accessSent',first,when(shown.at))}</span></div>
  :shown?.state==='available'?<div className="card__outcome"><ShellIcon name="check"/><span>{c('accessAvailable')}</span></div>
  :shown?.state==='dismissed'?<div className="card__outcome"><ShellIcon name="x"/><span>{c('accessNotSent')}</span></div>
  :!press?<div className="card__outcome"><ShellIcon name="clock"/><span>{cb('accessWaitingFor',first)}</span></div>
  :<>
   <div className="card__actions">
    <button type="button" className="btn btn--secondary" disabled={busy} onClick={()=>void answer(false)}>{c('accessNo')}</button>
    <button type="button" className="btn btn--primary" disabled={busy} aria-busy={busy||undefined} onClick={()=>void answer(true)}>{cb('accessAsk',first)}</button>
   </div>
   {error&&<p className="connect__error" role="alert">{t(error)}</p>}
  </>;
 return <div ref={root} className={`reply-card reply-card--access${shown?' is-resolved':''}${fresh?' card-in':''}${shown?.just?' is-just':''}`} role="group" aria-label={c('accessLabel',first)} data-access={card.id}>
  <div className="card__head"><span className="tool-tile tool-tile--lg tool-tile--ink" aria-hidden="true"><ShellIcon name="team"/></span>
   <div className="card__titles"><span className="card__title">{cb('accessTitle',first)}</span><span className="card__sub">{cb('accessLine',card.named.name||first,role)}</span></div></div>
  {outcome}
 </div>;
}
