'use client';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';
import type { ReactNode } from 'react';
import type { AgentStatus } from '@/lib/agent-details.mjs';
import { useLiveRun } from '@/lib/live-runs';
import type { CompanyAgent } from '@/lib/sidebar.mjs';

// An Agent's face with its state dot (design-reference: faceDot). A `live` face, the sidebar's tile, also shows the
// working motion while a Run is open in the Conversation the person reads, and a check for a moment when it ends
// (design-reference: applyLive). The dot keeps its state's class; while the Agent thinks the stylesheet paints it the accent.
export function AgentFaceDot({agent,size,status,lg=false,live=false}:{agent:Pick<CompanyAgent,'id'|'connection_id'|'name'>,size:number,status:AgentStatus,lg?:boolean,live?:boolean}) {
 return <LiveFaceWrap agent={agent} size={size} lg={lg} live={live}><span className={`dot dot--${status}`}/></LiveFaceWrap>;
}

// The marks of an Agent at work around its face and the dot given as children (a tile's, or the details panel's read
// from the server): the face scans, the dots think beside it, the dot sends a ring, and a check shows for a moment once
// the Run ends. Hidden from assistive technology: the status words beside the face say the same. A face that is not
// `live` (Settings, a channel's members) shows its dot and never the working motion.
export function LiveFaceWrap({agent,size,lg=false,live=true,children}:{agent:Pick<CompanyAgent,'id'|'connection_id'|'name'>,size:number,lg?:boolean,live?:boolean,children?:ReactNode}) {
 const run=useLiveRun(live?agent.id:undefined);
 const thinking=run==='thinking';
 return <span className={`face-wrap${lg?' face-wrap--lg':''}${thinking?' is-thinking':''}`} aria-hidden="true">
  <CompanyAgentFace agent={agent} size={size} thinking={thinking}/>{children}
  {thinking&&<span className="think"><i/><i/><i/></span>}
  {run==='done'&&<span className="done-ck"><ShellIcon name="check"/></span>}
 </span>;
}

// A face that scans while its Agent has a Run open in the Conversation this person reads (the chat's title pill).
export function LiveFace({agentId,agent,size}:{agentId:string|undefined,agent:Pick<CompanyAgent,'connection_id'|'name'>,size:number}) {
 return <CompanyAgentFace agent={agent} size={size} thinking={useLiveRun(agentId)==='thinking'}/>;
}
