'use client';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { LeadWelcome } from '@/app/lead-welcome';
import { MadeLine } from '@/app/agent-made';
import type { Made } from '@/lib/agent-made';

// Which empty chat an Agent shows its reader (design-reference: emptyChatHTML), decided once on the server (#170).
// `fresh`: the main Agent alone in a new workspace (#9). `main`: the main Agent once there are others, worded for a
// Company worked alone, its Owner, or another Member, who is told which Owners make the Agent. `new`: an Agent this reader
// has not written to yet, with its ready-made role's words or the general ones. `known`: any other.
export type EmptyChat=
 | {state:'fresh'}
 | {state:'main',reader:'alone'|'owner'|'member',owners:string[]}
 | {state:'new',works:'you'|'team',line:string|null,handoff:string|null,example:string,made:Made|null}
 | {state:'known'};

type Agent={name:string,connection_id:string,speciality?:string|null,main?:boolean};

// `suggest` puts a sentence in the composer; a Viewer, who cannot write, gets neither the suggestions nor the sentence
// to try (design-reference: canWrite).
export function AgentEmptyChat({agent,empty,askOf=null,suggest}:{agent:Agent,empty:EmptyChat,askOf?:string[]|null,suggest?:(text:string)=>void}) {
 const {t,language}=useI18n();
 if(empty.state==='fresh') return <LeadWelcome agent={agent} askOf={askOf} suggest={suggest}/>;
 const face=<div className="empty-chat__faces" aria-hidden="true"><CompanyAgentFace agent={agent} size={64}/></div>;
 // design-reference: mainEmptyHTML. Its daily check-in, its handing work to another Agent and the suggestion that
 // promises it wait for those parts (gap rows 7 and 4).
 if(empty.state==='main') {
  const line=empty.reader==='alone'?t('mainLineAlone'):empty.reader==='owner'?t('mainLineOwner'):t('mainLineMember',new Intl.ListFormat(localeFor(language),{type:'disjunction'}).format(empty.owners));
  const suggestions=[[t('suggestArticle'),t('suggestArticleD'),t('suggestArticleText')],
   [empty.reader==='member'?t('suggestAgentMember'):t('suggestAgentOwner'),t('suggestAgentD'),t('suggestAgentText')],
   [t('suggestWaiting'),t('suggestWaitingD'),t('suggestWaitingText')]];
  return <div className="empty-chat empty-chat--agent">
   {face}
   <h2 className="main-h"><bdi>{agent.name}</bdi><span className="badge main-badge">{t('mainAgent')}</span></h2>
   {agent.speciality&&<p className="empty-chat__role" dir="auto">{agent.speciality}</p>}
   <p>{line}</p>
   {suggest&&<div className="suggest">{suggestions.map(([title,second,text])=><button key={title} type="button" onClick={()=>suggest(text)}><b>{title}</b><span>{second}</span></button>)}</div>}
  </div>;
 }
 // design-reference: newAgentEmptyHTML.
 if(empty.state==='new') return <div className="empty-chat empty-chat--agent">
  {face}
  <h2><bdi>{agent.name}</bdi></h2>
  <p className="empty-chat__role">{agent.speciality&&<><bdi>{agent.speciality}</bdi>{' · '}</>}{empty.works==='you'?t('agentWorksWithYou'):t('agentWorksWithTeam')}</p>
  {empty.made&&<MadeLine made={empty.made} where="empty"/>}
  <p>{empty.line||t('agentEmptyChat')}</p>
  {empty.handoff&&<p className="empty-chat__hand"><ShellIcon name="hand"/><span>{empty.handoff}</span></p>}
  {suggest&&<div className="try-one"><span className="try-one__l">{t('agentTryStarting')}</span>
   <button type="button" className="try-one__btn" onClick={()=>suggest(empty.example)}>{empty.example}</button></div>}
 </div>;
 return <div className="empty-chat empty-chat--agent">
  {face}
  <h2 className="main-h"><bdi>{agent.name}</bdi>{agent.main&&<span className="badge main-badge">{t('mainAgent')}</span>}</h2>
  {agent.speciality&&<p className="empty-chat__role" dir="auto">{agent.speciality}</p>}
  <p>{t('agentEmptyChat')}</p>
 </div>;
}
