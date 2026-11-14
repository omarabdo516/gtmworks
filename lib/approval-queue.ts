import { cache } from 'react';
import type { supabase } from './supabase';
import type { Step, ApprovalCard } from '@/app/c/[slug]/[[...section]]/approvals';
// One item of "Waiting on you" (ADR 0013): an approval this person holds, or anything else addressed to them by kind.
export type WaitingItem={kind:string,id:number,title:string,body:string,asked_by:string,card_id:number|null,conversation_id:string|null,created_at:string};
// "Waiting on you" is one list (#16), read once per request from waiting_list(company) as the signed-in person: the
// approvals they hold (`cards`, for the card's decision and the counts) and every item, newest first (`items`).
export const approvalQueue=cache(async(db:Awaited<ReturnType<typeof supabase>>,company:string,person:string,role:string)=>{
 void person; void role; // the database reads both from the session
 const [stepResult,listResult]=await Promise.all([
  db.from('approval_steps').select('*').eq('company_id',company).is('removed_at',null).order('position').order('id'),
  db.rpc('waiting_list',{c:company}),
 ]);
 const items=(listResult.data || []) as WaitingItem[];
 const ids=items.filter(item=>item.kind==='approval').map(item=>item.id);
 const cardResult=ids.length?await db.from('work_cards').select('*').eq('company_id',company).in('id',ids):{data:[],error:null};
 const cards=ids.map(id=>(cardResult.data || []).find(card=>card.id===id)).filter(Boolean) as ApprovalCard[];
 return {steps:(stepResult.data || []) as Step[],cards,items,available:!stepResult.error&&!listResult.error&&!cardResult.error};
});
