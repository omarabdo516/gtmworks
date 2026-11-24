'use client';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { AgentFace } from '@/components/agent-face';
import { ShellIcon } from '@/components/shell-icon';

type Face={id:string,name:string};

// A job one Agent handed another (#317 in a Conversation, #150 in a channel; design-reference: the handoff row,
// `.handoff`): a quiet line with both faces and an arrow pointing the way the interface reads, "Handed to {Agent}", and
// the job. A handover whose target's leg or Lead's follow-up ran out of time ends failed (#375), and the row then says
// the job did not finish, so the person is never left waiting on a reply that will not come. It is drawn from
// gtmworks's own record of the handover, never from the Engine's helper events, and it has nothing to press. A
// Conversation draws it inside Lead's turn (`p`); a channel draws it between turns (`li`). A step its person's Stop ended
// (#478) says "Stopped" there instead, quietly: the person asked for it, so it is no failure. `ending` is how the row ended
// short (lib/conversations.ts handoverEnding), `said` the words for each ending in the place's own catalogue.
export type HandedEnding={stopped?:true,failed?:true};
export function HandedRow({as:Row='li',from,to,title,goal,ending,said,className}:{as?:'li'|'p',from:Face,to:Face,title:ReactNode,goal:string,ending:HandedEnding,said:{stopped:string,failed:string},className?:string}) {
 const {language}=useI18n();
 const end=ending.stopped?'stopped':ending.failed?'failed':null;
 return <Row className={className?`handed ${className}`:'handed'} role="note" data-handover {...(end?{[`data-${end}`]:''}:{})}>
  <span className="handed__faces"><AgentFace agent={from.id} name={from.name} size={18}/><ShellIcon name={language==='ar'?'arrow':'arrowLtr'} className="handed__arrow"/><AgentFace agent={to.id} name={to.name} size={18}/></span>
  <span className="handed__t">{title}</span>
  {goal&&<span className="handed__d"><bdi>{goal}</bdi></span>}
  {end&&<span className={end==='stopped'?'handed__failed is-stopped':'handed__failed'}>{said[end]}</span>}
 </Row>;
}
