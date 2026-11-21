'use client';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { ShellIcon } from '@/components/shell-icon';

type Face={connection_id:string,name:string};

// A job one Agent handed another (#317 in a Conversation, #150 in a channel; design-reference: the handoff row,
// `.handoff`): a quiet line with both faces and an arrow pointing the way the interface reads, "Handed to {Agent}", and
// the job. A handover whose target's leg or Lead's follow-up ran out of time ends failed (#375), and the row then says
// the job did not finish, so the person is never left waiting on a reply that will not come. It is drawn from
// gtmworks's own record of the handover, never from the Engine's helper events, and it has nothing to press. A
// Conversation draws it inside Lead's turn (`p`); a channel draws it between turns (`li`).
export function HandedRow({as:Row='li',from,to,title,goal,failed,className}:{as?:'li'|'p',from:Face,to:Face,title:ReactNode,goal:string,failed:string|null,className?:string}) {
 const {language}=useI18n();
 return <Row className={className?`handed ${className}`:'handed'} role="note" data-handover {...(failed?{'data-failed':''}:{})}>
  <span className="handed__faces"><CompanyAgentFace agent={from} size={18}/><ShellIcon name={language==='ar'?'arrow':'arrowLtr'} className="handed__arrow"/><CompanyAgentFace agent={to} size={18}/></span>
  <span className="handed__t">{title}</span>
  {goal&&<span className="handed__d"><bdi>{goal}</bdi></span>}
  {failed&&<span className="handed__failed">{failed}</span>}
 </Row>;
}
