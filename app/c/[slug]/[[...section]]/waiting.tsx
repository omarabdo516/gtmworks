'use client';
import { useI18n } from '@/lib/i18n-client';
import { useFlagToast } from '@/app/use-flag-toast';
import type { WaitingItem } from '@/lib/approval-queue';
import Board from './board';
import type { WaitingPeople } from './waiting-rows';

// "Waiting on you" (/approvals; ADR 0013, spec #831, #846): the Company's Engine board opened on its first column, which
// holds the reader's own list. A decision made where a row waits comes back here: a failure in words above the board, and
// a decided lesson in a toast that names its Agent, shown once (#169).
export default function Waiting({company,writer,reviewer,me,items,people,message,ruleDecision}:{company:string,writer:boolean,reviewer:boolean,me:string,items:WaitingItem[],people:WaitingPeople,message?:string,ruleDecision?:{approve:boolean,agent:string}}) {
 const {t}=useI18n();
 useFlagToast(['decided','item'],ruleDecision?t(ruleDecision.approve?'waitingRuleDecidedTeamWide':'waitingRuleDecidedDeclined',ruleDecision.agent):null,ruleDecision?.approve?'check':'x');
 return <>
  {message&&<p role="alert" className="work-error">{message}</p>}
  <Board company={company} slug={people.slug} writer={writer} reviewer={reviewer} me={me} own={{items,people}}/>
 </>;
}
