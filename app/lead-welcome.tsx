'use client';
import { useI18n } from '@/lib/i18n-client';
import { CompanyAgentFace } from '@/components/company-agent-face';

// The main Agent's first words in a new workspace (#9; design-reference: mainEmptyHTML for the first run): its face, its
// name marked Main, one line saying it makes an Agent for any job, and one sentence to try, which fills the composer.
export function LeadWelcome({agent,suggest}:{agent:{name:string,connection_id:string},suggest?:(text:string)=>void}) {
 const {t}=useI18n();
 return <div className="empty-chat empty-chat--agent empty-chat--fresh">
  <div className="empty-chat__faces" aria-hidden="true"><CompanyAgentFace agent={agent} size={64}/></div>
  <h2 className="main-h"><bdi>{agent.name}</bdi><span className="badge main-badge">{t('mainAgent')}</span></h2>
  <p data-lead-line>{t('leadFreshLine',agent.name)}</p>
  {suggest&&<div className="try-one"><span className="try-one__l">{t('leadTrySaying')}</span>
   <button type="button" className="try-one__btn" onClick={()=>suggest(t('leadTryExample'))}>{t('leadTryExample')}</button></div>}
 </div>;
}
