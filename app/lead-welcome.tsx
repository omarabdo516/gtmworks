'use client';
import { useI18n } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import { AgentFace } from '@/components/agent-face';

// The main Agent's first words in a new workspace (#9; design-reference: mainEmptyHTML for the first run): its face, its
// name marked Main, one line saying it makes an Agent for any job, and one sentence to try, which fills the composer.
// `askOf`: the Owners a Manager or a Contributor asks for an Agent instead (#17); with none to name, "the Owner".
export function LeadWelcome({agent,suggest,askOf=null}:{agent:{id?:string,name:string},suggest?:(text:string)=>void,askOf?:string[]|null}) {
 const {t,language}=useI18n();
 return <div className="empty-chat empty-chat--agent empty-chat--fresh">
  <div className="empty-chat__faces" aria-hidden="true"><AgentFace agent={agent.id} size={96} live/></div>
  <h2 className="main-h"><bdi>{agent.name}</bdi><span className="badge main-badge">{t('mainAgent')}</span></h2>
  <p data-lead-line>{!askOf?t('leadFreshLine',agent.name):askOf.length?t('leadFreshLineMember',agent.name,new Intl.ListFormat(localeFor(language),{type:'disjunction'}).format(askOf)):t('leadFreshLineMemberAnyOwner',agent.name)}</p>
  {suggest&&<div className="try-one"><span className="try-one__l">{t('leadTrySaying')}</span>
   <button type="button" className="try-one__btn" onClick={()=>suggest(t('leadTryExample'))}>{t('leadTryExample')}</button></div>}
 </div>;
}
