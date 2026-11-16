'use client';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import { agentStatus, type AgentStatus } from '@/lib/agent-details.mjs';
import { useLiveRun } from '@/lib/live-runs';
import type { CompanyAgent } from '@/lib/sidebar.mjs';

// An Agent's face with its state dot (design-reference: faceDot). A `live` face, the sidebar's tile, also shows the
// working motion while a Run is open in the Conversation the person reads, and a check for a moment when it ends
// (design-reference: applyLive). A dot waiting on the reader stays the waiting colour while the Agent works.
export function AgentFaceDot({agent,size,status,lg=false,live=false}:{agent:Pick<CompanyAgent,'id'|'connection_id'|'name'>,size:number,status:AgentStatus,lg?:boolean,live?:boolean}) {
 const run=useLiveRun(live?agent.id:undefined);
 const thinking=run==='thinking';
 const shown=thinking?agentStatus({waitingMine:status==='waiting',running:true}):status;
 return <span className={`face-wrap${lg?' face-wrap--lg':''}${thinking?' is-thinking':''}`} aria-hidden="true">
  <CompanyAgentFace agent={agent} size={size}/><span className={`dot dot--${shown}`}/>
  {thinking&&<span className="think"><i/><i/><i/></span>}
  {run==='done'&&<span className="done-ck"><ShellIcon name="check"/></span>}
 </span>;
}
