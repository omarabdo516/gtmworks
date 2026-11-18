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
// has not written to yet, with its ready-made role's words or the general ones. `known`: any other Agent but the main
// one, which is always `fresh` or `main`: its picker offers every Agent this reader sees, and `example` is its own first
// sentence (#171). A Viewer reads the Member's wording, as the reference does (it words by isOwner alone); with no
// Owner's name to give, the request goes to "the Owner".
export type EmptyChat=
 | {state:'fresh'}
 | {state:'main',reader:'alone'|'owner'|'member',owners:string[]}
 | {state:'new',works:'you'|'team',line:string|null,handoff:string|null,example:string,made:Made|null}
 | {state:'known',example:string|null};

type Agent={id?:string,name:string,connection_id:string,speciality?:string|null,main?:boolean};

// One Agent the reader sees, as the picker draws it (design-reference: visibleAgents): an identity and a face, no data.
type PickerAgent={id:string,connection_id:string,name:string};
export type AgentPicker={agents:PickerAgent[],onPick:(id:string)=>void,disabled?:boolean,chipRef?:(chip:HTMLButtonElement|null)=>void};

// `suggest` puts a sentence in the composer; a Viewer, who cannot write, gets neither the suggestions nor the sentence
// to try (design-reference: canWrite). `picker` is how this reader moves to another Agent from a known empty chat: the
// pressed chip takes the focus back once the page has followed (#171; design-reference: pick-new-agent).
export function AgentEmptyChat({agent,empty,askOf=null,suggest,picker}:{agent:Agent,empty:EmptyChat,askOf?:string[]|null,suggest?:(text:string)=>void,picker?:AgentPicker}) {
 const {t,language}=useI18n();
 if(empty.state==='fresh') return <LeadWelcome agent={agent} askOf={askOf} suggest={suggest}/>;
 const face=<div className="empty-chat__faces" aria-hidden="true"><CompanyAgentFace agent={agent} size={64}/></div>;
 // design-reference: mainEmptyHTML. Its daily check-in, its handing work to another Agent and the suggestion that
 // promises it wait for those parts (gap rows 7 and 4).
 if(empty.state==='main') {
  const line=empty.reader==='alone'?t('mainLineAlone'):empty.reader==='owner'?t('mainLineOwner'):empty.owners.length?t('mainLineMember',new Intl.ListFormat(localeFor(language),{type:'disjunction'}).format(empty.owners)):t('mainLineMemberAnyOwner');
  const suggestions=[[t('suggestArticle'),t('suggestArticleD'),t('suggestArticleText')],
   [empty.reader==='member'?t('suggestAgentMember'):t('suggestAgentOwner'),t('suggestAgentD'),t('suggestAgentText')],
   [t('suggestWaiting'),t('suggestWaitingD'),t('suggestWaitingText')]];
  return <div className="empty-chat empty-chat--agent">
   {face}
   <h2 className="main-h" tabIndex={-1}><bdi>{agent.name}</bdi><span className="badge main-badge">{t('mainAgent')}</span></h2>
   {agent.speciality&&<p className="empty-chat__role" dir="auto">{agent.speciality}</p>}
   <p>{line}</p>
   {suggest&&<div className="suggest">{suggestions.map(([title,second,text])=><button key={title} type="button" onClick={()=>suggest(text)}><b>{title}</b><span>{second}</span></button>)}</div>}
  </div>;
 }
 // design-reference: newAgentEmptyHTML.
 if(empty.state==='new') return <div className="empty-chat empty-chat--agent">
  {face}
  <h2 tabIndex={-1}><bdi>{agent.name}</bdi></h2>
  <p className="empty-chat__role">{agent.speciality&&<><bdi>{agent.speciality}</bdi>{' · '}</>}{empty.works==='you'?t('agentWorksWithYou'):t('agentWorksWithTeam')}</p>
  {empty.made&&<MadeLine made={empty.made} where="empty"/>}
  <p>{empty.line||t('agentEmptyChat')}</p>
  {empty.handoff&&<p className="empty-chat__hand"><ShellIcon name="hand"/><span>{empty.handoff}</span></p>}
  {suggest&&<div className="try-one"><span className="try-one__l">{t('agentTryStarting')}</span>
   <button type="button" className="try-one__btn" onClick={()=>suggest(empty.example)}>{empty.example}</button></div>}
 </div>;
 // design-reference: emptyChatHTML's general pair, for every Agent: a suggestion fills the composer as "title: second
 // line" and sends nothing (design-reference: the `suggest` click case). The second one starts from the Agent's own first
 // sentence, or says what to write when it has none.
 const general=[[t('suggestTellMe'),t('suggestTellMeD')],[t('suggestFirstJob'),empty.example??t('suggestFirstJobD')]];
 return <div className="empty-chat">
  <div className="empty-chat__faces" aria-hidden="true">{picker?picker.agents.map(other=><CompanyAgentFace key={other.id} agent={other} size={40}/>):<CompanyAgentFace agent={agent} size={64}/>}</div>
  <h2 tabIndex={-1}>{t('emptyChatHeading')}</h2>
  <p>{t('emptyChatPickLead')} <bdi>@</bdi> {t('emptyChatPickTail')}</p>
  {picker&&<div className="agent-picker" role="group" aria-label={t('agentPickerLabel')}>
   {picker.agents.map(other=><button key={other.id} type="button" className="chip" aria-pressed={other.id===agent.id} aria-disabled={picker.disabled?true:undefined} onClick={()=>{ if(!picker.disabled) picker.onPick(other.id); }} ref={other.id===agent.id?picker.chipRef:undefined}>
    <span className="chip__face" aria-hidden="true"><CompanyAgentFace agent={other} size={22}/></span><bdi>{other.name}</bdi></button>)}
  </div>}
  {suggest&&<div className="suggest">{general.map(([title,second])=><button key={title} type="button" onClick={()=>suggest(`${title}: ${second}`)}><b>{title}</b><span>{second}</span></button>)}</div>}
 </div>;
}
