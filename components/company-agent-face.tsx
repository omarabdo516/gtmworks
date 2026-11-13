import { AgentFace } from './agent-face';
import type { CompanyAgent } from '@/lib/sidebar.mjs';

// A company's real Agent wears this face in the sidebar's grid, keyed by its Hermes connection as on the Agents page
// and in its chat, so one Agent never looks like two.
export function CompanyAgentFace({agent,size}:{agent:Pick<CompanyAgent,'connection_id'|'name'>,size:number}) {
 return <AgentFace id={agent.connection_id} role="account_manager" name={agent.name} size={size}/>;
}
