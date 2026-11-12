import { agentIdentities } from '@/lib/agent-identities';
import { getI18n } from '@/lib/i18n-server';
import { roleAgents } from '@/lib/role-agents';
import { AgentFace } from './agent-face';

export async function AgentRoleFace({agent,size=20}:{agent:typeof roleAgents[number],size?:number}) {
 const identity=(await agentIdentities()).find(identity=>identity.role===agent.key);
 const {t}=await getI18n();
 return identity?<AgentFace id={identity.id} role={identity.role} name={identity.name||t(agent.name)} size={size}/>:null;
}
