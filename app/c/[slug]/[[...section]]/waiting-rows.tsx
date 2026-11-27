'use client';
import { Fragment, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import Link from '@/lib/link';
import { BoardIcon } from '@/components/board-icon';
import { ShellIcon } from '@/components/shell-icon';
import { AgentFace } from '@/components/agent-face';
import { workDate as date } from '@/lib/work-date.mjs';
import { chatPlace } from '@/lib/board-columns.mjs';
import { withMention } from '@/lib/channels';
import type { WaitingItem } from '@/lib/approval-queue';
import type { BoardCard } from '@/app/board-read';
import { BoardCardTile } from '@/app/board-card';
import { answerAgentAccess, decideAgentRule } from './skill-actions';
import { OwnerRequestCard } from './agent-request-card';
import { ChangeBoardCard } from './agent-change-card';
import { AgentKeyWaitCard } from './agent-key-wait-card';

// The reader's own Waiting on you (ADR 0013, spec #831, #846): the column the Inbox opens the Engine's board on. Every
// mention of the reader first, under "Mentions of you" with its count; then what needs their reply: the Cards of the
// Company's Engine board that wait on them (worked out from the board read in the browser, #841), each opening over the
// board, then their other rows, newest first, as waiting_list returns them. A row that is decided where it waits (a
// lesson, an Agent request, a key, a request to open an Agent, a change proposal) carries its own buttons; any other opens
// its chat or channel.
export type WaitingPeople={slug:string,company:string,lead:string,alone:boolean,myNames:string[]};

export function WaitingRows({items,cards,columnName,people}:{items:WaitingItem[],cards:BoardCard[],columnName:(column:string)=>string,people:WaitingPeople}) {
 const {t}=useI18n();
 const row=useRowView(people);
 const mentions=items.filter(item=>item.kind==='mention'||item.kind==='channel_mention');
 const replies=items.filter(item=>!mentions.includes(item));
 const board=`/c/${people.slug}/work/board`;
 return <>
  {mentions.length>0&&<div className="mn-group" role="group" aria-labelledby="mn-h-own"><h3 className="mn-h" id="mn-h-own"><BoardIcon name="at"/><span>{t('waitingMentions')}</span> <span className="num">{mentions.length}</span></h3>{mentions.map(row)}{replies.length+cards.length>0&&<div className="mn-sep" role="separator"/>}</div>}
  {cards.map(card=><BoardCardTile key={`card:${card.id}`} card={card} href={`${board}?card=${encodeURIComponent(card.id)}`} columnName={columnName}/>)}
  {replies.map(row)}
 </>;
}

function useRowView({slug,company,lead,alone,myNames}:WaitingPeople) {
 const {t,language}=useI18n();
 const named=(key:string,name:string)=>{ const [before,after]=t(key,'\u0000').split('\u0000'); return <>{before}<bdi>{name}</bdi>{after}</>; };
 const named2=(key:string,first:string,second:string)=>{ const [before,middle,after]=t(key,'\u0000','\u0001').split(/[\u0000\u0001]/); return <>{before}<bdi>{first}</bdi>{middle}<bdi>{second}</bdi>{after}</>; };
 const hidden=<><input type="hidden" name="company" value={company}/><input type="hidden" name="slug" value={slug}/></>;
 const when=(item:WaitingItem)=><span className="mcard__time num">{date(item.created_at,language,{month:'short'})}</span>;
 // A learning suggestion (#25; design-reference: lnRowHTML) is decided where it waits: the rule, its Agent, who told it,
 // and Decline or Make it team-wide.
 const ruleView=(item:WaitingItem)=><div key={`${item.kind}:${item.id}`} className="mcard mcard--rule" data-kind={item.kind} role="group" aria-label={t('waitingRuleLabel',item.body,item.asked_by)}>
  <span className="mcard__top"><span className="od-fill mcard__who"><b>{t('waitingRuleKind')}</b></span>{when(item)}</span>
  <span className="mcard__q" dir="auto">{item.suggestion?.rule??item.title}</span>
  <span className="ln-meta"><span className="ln-who">{item.suggestion?.agent&&<span aria-hidden="true"><AgentFace agent={item.suggestion.agent.id} size={16}/></span>}<bdi>{item.body}</bdi></span><span aria-hidden="true">·</span><span>{named('waitingRuleToldBy',item.asked_by)}</span><span className="badge badge--wait"><span className="dot dot--waiting" aria-hidden="true"/>{t('waitingRuleBadge')}</span></span>
  <form action={decideAgentRule} className="ln-acts">{hidden}<input type="hidden" name="item" value={item.id}/>
   <button className="btn btn--secondary btn--sm" name="intent" value="reject">{t('waitingRuleDecline')}</button>
   <button className="btn btn--primary btn--sm" name="intent" value="approve">{t('waitingRuleApprove')}</button></form>
 </div>;
 // A Member's request for an Agent hidden from them (#167): who asks for which Agent, with its face and job, and No or
 // Open it for them. Opening is #15's switch for that Member and that Agent.
 const accessView=(item:WaitingItem)=>{ const first=item.asked_by.trim().split(/\s+/)[0]||item.asked_by;
  return <div key={`${item.kind}:${item.id}`} className="mcard mcard--rule" data-kind={item.kind} role="group" aria-label={t('waitingAccessLabel',item.asked_by,item.title)}>
  <span className="mcard__top"><span className="od-fill mcard__who"><b>{t('waitingAccessKind')}</b></span>{when(item)}</span>
  <span className="mcard__q" dir="auto">{named2('waitingAccessAsks',item.asked_by,item.title)}</span>
  <span className="ln-meta"><span className="ln-who">{item.agent&&<span aria-hidden="true"><AgentFace agent={item.agent.id} size={16}/></span>}<bdi>{item.title}</bdi></span>{item.body&&<><span aria-hidden="true">·</span><bdi>{item.body}</bdi></>}<span className="badge badge--wait"><span className="dot dot--waiting" aria-hidden="true"/>{t('boardWaitingYou')}</span></span>
  <form action={answerAgentAccess} className="ln-acts">{hidden}<input type="hidden" name="request" value={item.id}/>
   <button className="btn btn--secondary btn--sm" name="intent" value="no">{t('waitingAccessNo')}</button>
   <button className="btn btn--primary btn--sm" name="intent" value="open">{named('waitingAccessOpen',first)}</button></form>
 </div>; };
 const decidedHere:Record<string,(item:WaitingItem)=>ReactNode>={
  rule_suggestion:ruleView,
  agent_request:item=><OwnerRequestCard key={`${item.kind}:${item.id}`} slug={slug} company={company} lead={lead} item={item}/>,
  agent_key:item=><AgentKeyWaitCard key={`${item.kind}:${item.id}`} item={item} slug={slug}/>,
  agent_access:accessView,
  agent_change:item=><ChangeBoardCard key={`${item.kind}:${item.id}`} slug={slug} company={company} item={item} alone={alone}/>,
 };
 // A Member mentioned in a channel (#200) is named by the writer and opens the channel at that message, with the message
 // cut to three lines and the reader's own name marked, as the channel draws every Member's name.
 const marked=(body:string)=>withMention(body,myNames).map((part,index)=>part.mention?<bdi key={index} className="mention">{part.text}</bdi>:<Fragment key={index}>{part.text}</Fragment>);
 const inChannel=(item:WaitingItem)=>item.kind==='channel_mention';
 // A step an Agent handed over (#140) is tagged before its title and opens the Conversation at its card; a permission
 // request (#165) names its Agent with its face and opens the Conversation, or the channel, at its card. A channel's
 // question or handed step (#149) does the same, in its channel. A row of no chat opens nothing.
 return function WaitingRow(item:WaitingItem) {
  if(Object.hasOwn(decidedHere,item.kind)) return decidedHere[item.kind](item);
  const body=<>
   <span className="mcard__top">{inChannel(item)&&<span className="avatar mcard__av" aria-hidden="true">{Array.from(item.asked_by.trim())[0]||'؟'}</span>}<span className="od-fill mcard__who">{item.kind==='question'||item.kind==='channel_question'?<b>{item.asked_by?t('waitingQuestionFrom',item.asked_by):t('waitingQuestion')}</b>:inChannel(item)?<><b dir="auto">{item.asked_by}</b> {named('waitingMentionInChannel',`#${!item.title||item.title==='general'?t('shellGeneralChannel'):item.title}`)}</>:item.agent?<span className="ln-who"><span aria-hidden="true"><AgentFace agent={item.agent.id} size={16}/></span><b dir="auto">{item.asked_by}</b></span>:<b dir="auto">{item.asked_by}</b>}</span>{when(item)}</span>
   {(item.kind==='hand'||item.kind==='channel_hand')&&<span className="wtag wtag--hand"><ShellIcon name="hand"/>{t('handBadge')}</span>}
   <span className="mcard__q od-clamp-3" dir="auto">{inChannel(item)?marked(item.body):<>{item.title}{item.body&&<> {item.body}</>}</>}</span>
  </>;
  const place=chatPlace(slug,item);
  return place?<Link key={`${item.kind}:${item.id}`} className="mcard" data-kind={item.kind} href={place}>{body}</Link>
   :<div key={`${item.kind}:${item.id}`} className="mcard" data-kind={item.kind}>{body}</div>;
 };
}
