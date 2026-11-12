import type { supabase } from './supabase';
import type { Step, ApprovalCard } from '@/app/c/[slug]/[[...section]]/approvals';
export async function approvalQueue(db:Awaited<ReturnType<typeof supabase>>,company:string,person:string,role:string) {
 const [stepResult,waitingResult]=await Promise.all([
  db.from('approval_steps').select('*').eq('company_id',company).is('removed_at',null).order('position').order('id'),
  db.from('work_cards').select('*').eq('company_id',company).not('approval_step_id','is',null).order('review_entered_at'),
 ]);
 const steps=(stepResult.data || []) as Step[];
 const cards=(waitingResult.data || []).filter(card=>{
  const step=steps.find(step=>step.id===card.approval_step_id);
  return step && ['owner','manager','reviewer'].includes(role) && (step.person_id===person || (!step.person_id && step.role===role));
 }) as ApprovalCard[];
 return {steps,cards,available:!stepResult.error&&!waitingResult.error};
}
