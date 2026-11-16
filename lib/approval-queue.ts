import { cache } from 'react';
import type { supabase } from './supabase';
import type { Step, ApprovalCard } from '@/app/c/[slug]/[[...section]]/approvals';
// One item of "Waiting on you" (ADR 0013): an approval this person holds, or anything else addressed to them by kind.
// A mention (#22) carries the note it opens.
// A learning suggestion (#25, kind rule_suggestion: title the rule, body the Agent's name, asked_by who told it) also
// carries the whole rule and the Agent's face. A Member's request for an Agent (#17, kind agent_request: title its name,
// body its job, asked_by the Member) also carries its apps and the message that asked, or null when those could not be
// read, so the Owner never answers a request seen in part.
type RuleSuggestion={rule:string,agent:{connection_id:string,name:string}|null};
type AgentRequest={apps:string[],asked_with:string};
export type WaitingItem={kind:string,id:number,title:string,body:string,asked_by:string,card_id:number|null,conversation_id:string|null,created_at:string,suggestion?:RuleSuggestion,request?:AgentRequest|null,note_id?:number|null};
// "Waiting on you" is one list (#16), read once per request from waiting_list(company) as the signed-in person: the
// approvals they hold (`cards`, for the card's decision and the counts) and every item, newest first (`items`).
export const approvalQueue=cache(async(db:Awaited<ReturnType<typeof supabase>>,company:string,person:string,role:string)=>{
 void person; void role; // the database reads both from the session
 const [stepResult,listResult]=await Promise.all([
  db.from('approval_steps').select('*').eq('company_id',company).is('removed_at',null).order('position').order('id'),
  db.rpc('waiting_list',{c:company}),
 ]);
 const listed=(listResult.data || []) as WaitingItem[];
 const ids=listed.filter(item=>item.kind==='approval').map(item=>item.id);
 const ruleIds=listed.filter(item=>item.kind==='rule_suggestion').map(item=>item.id);
 const requestIds=listed.filter(item=>item.kind==='agent_request').map(item=>item.id);
 const mentionIds=listed.filter(item=>item.kind==='mention').map(item=>item.id);
 const [cardResult,ruleResult,requestResult,mentionResult]=await Promise.all([
  ids.length?db.from('work_cards').select('*').eq('company_id',company).in('id',ids):{data:[],error:null},
  ruleIds.length?db.from('waiting_items').select('id,agent_rules(body,hermes_agents(connection_id,name))').in('id',ruleIds):{data:[],error:null},
  requestIds.length?db.from('lead_agent_requests').select('id,apps,asked_with').eq('company_id',company).in('id',requestIds):{data:[],error:null},
  mentionIds.length?db.from('waiting_items').select('id,note_id,work_comments(body)').in('id',mentionIds):{data:[],error:null},
 ]);
 const cards=ids.map(id=>(cardResult.data || []).find(card=>card.id===id)).filter(Boolean) as ApprovalCard[];
 type RuleRow={id:number,agent_rules:{body:string,hermes_agents:{connection_id:string,name:string}|null}|null};
 const rules=new Map(((ruleResult.data || []) as unknown as RuleRow[]).map(row=>[row.id,row.agent_rules]));
 const requests=new Map(((requestResult.data || []) as (AgentRequest&{id:number})[]).map(({id,...request})=>[id,request]));
 type MentionRow={id:number,note_id:number|null,work_comments:{body:string}|null};
 // A mention opens its note and shows the note as it now stands (#22).
 const mentions=new Map(((mentionResult.data || []) as unknown as MentionRow[]).map(row=>[row.id,row]));
 const items=listed.map(item=>{
  if(item.kind==='agent_request') return {...item,request:requests.get(item.id)??null};
  const rule=item.kind==='rule_suggestion'&&rules.get(item.id);
  if(rule) return {...item,suggestion:{rule:rule.body,agent:rule.hermes_agents}};
  const mention=item.kind==='mention'?mentions.get(item.id):undefined;
  return mention?{...item,note_id:mention.note_id,body:mention.work_comments?.body??item.body}:item;
 });
 return {steps:(stepResult.data || []) as Step[],cards,items,available:!stepResult.error&&!listResult.error&&!cardResult.error&&!ruleResult.error&&!requestResult.error&&!mentionResult.error};
});
