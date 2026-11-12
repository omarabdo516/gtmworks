import { getI18n } from '@/lib/i18n-server';
import { roleAgents } from '@/lib/role-agents';
import { AgentRoleFace } from '@/components/agent-role-face';
import { changeAgentAccess } from './agent-actions';
type Agent={id:string,role:string};
type Grant={agent_id:string,revoked_at:string|null};
// A server component: it ships no client JavaScript, which the route size budget counts.
export default async function AgentAccess({company,slug,agents,grants,message}:{company:string,slug:string,agents:Agent[],grants:Grant[],message?:string}) { const {t}=await getI18n();
 const order=(agent:Agent)=>roleAgents.findIndex(item=>item.key===agent.role);
 return <section className="panel agents-panel">
  <h2>{t('agentAccess')}</h2><p>{t('chooseWhichAgentsMayWorkInThisCompany')}</p>
  {message&&<p className="agent-notice" role="alert">{message}</p>}
  <div className="detail-rows">{agents.length===0?<p className="empty">{t('noAgentsYet')}</p>:[...agents].sort((a,b)=>order(a)-order(b)).map(agent=>{
   const role=roleAgents.find(item=>item.key===agent.role); const name=role?t(role.name):agent.role;
   const granted=grants.some(grant=>grant.agent_id===agent.id && !grant.revoked_at);
   return <form key={agent.id} action={changeAgentAccess} className="detail-row agent-key-row section-title" aria-label={name}>
    <input type="hidden" name="company" value={company}/><input type="hidden" name="slug" value={slug}/><input type="hidden" name="agent" value={agent.id}/><input type="hidden" name="intent" value={granted?'revoke':'grant'}/>
    {role&&<AgentRoleFace agent={role}/>}
    <div className="agent-row-main"><strong dir="auto">{name}</strong><p>{granted?t('hasAccess'):t('noAccess')}</p></div>
    <button className="button" aria-label={granted?t('revokeAccessFrom',name):t('grantAccessTo',name)}>{granted?t('revokeAccess'):t('grantAccess')}</button>
   </form>;})}</div>
 </section>;
}
