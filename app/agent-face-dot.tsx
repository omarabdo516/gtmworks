'use client';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import type { AgentStatus } from '@/lib/agent-details.mjs';
import { useLiveRun } from '@/lib/live-runs';
import type { CompanyAgent } from '@/lib/sidebar.mjs';

// An Agent's face with its state dot (design-reference: faceDot). A `live` face, the sidebar's tile, also shows the
// working motion while a Run is open in the Conversation the person reads, and a check for a moment when it ends
// (design-reference: applyLive). The dot keeps its state's class; while the Agent thinks the stylesheet paints it the accent.
export function AgentFaceDot({agent,size,status,lg=false,live=false}:{agent:Pick<CompanyAgent,'id'|'connection_id'|'name'>,size:number,status:AgentStatus,lg?:boolean,live?:boolean}) {
 const run=useLiveRun(live?agent.id:undefined);
 const thinking=run==='thinking';
 return <span className={`face-wrap${lg?' face-wrap--lg':''}${thinking?' is-thinking':''}`} aria-hidden="true">
  <CompanyAgentFace agent={agent} size={size}/><span className={`dot dot--${status}`}/>
  {thinking&&<span className="think"><i/><i/><i/></span>}
  {run==='done'&&<span className="done-ck"><ShellIcon name="check"/></span>}
 </span>;
}
