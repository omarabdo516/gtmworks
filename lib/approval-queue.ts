import { cache } from 'react';
import type { supabase } from './supabase';
import type { Step, ApprovalCard } from '@/app/c/[slug]/[[...section]]/approvals';
import { boardCardColumns, visibleApprovals, waitingCount } from './board-columns.mjs';
// One item of "Waiting on you" (ADR 0013): an approval this person holds, or anything else addressed to them by kind.
// A mention (#22) carries the note it opens.
// A learning suggestion (#25, kind rule_suggestion: title the rule, body the Agent's name, asked_by who told it) also
// carries the whole rule and the Agent's face. A Member's request for an Agent (#17, kind agent_request: title its name,
// body its job, asked_by the Member) also carries its apps and the message that asked, or null when those could not be
// read, so the Owner never answers a request seen in part.
type RuleSuggestion={rule:string,agent:{connection_id:string,name:string}|null};
type AgentRequest={apps:string[],asked_with:string};
// A permission request (#165, kind permission in a Conversation, channel_permission in a channel: title what it asks,
// asked_by its Agent's name) also carries its Agent's face, and a channel's its channel, so it opens there. A channel's
// question or handed step (#149, channel_question and channel_hand) does the same: one item per Member who may write, its
// channel read from the card's message and its Agent's face from that message's Run.
export type WaitingItem={kind:string,id:number,title:string,body:string,asked_by:string,card_id:number|null,conversation_id:string|null,created_at:string,suggestion?:RuleSuggestion,request?:AgentRequest|null,note_id?:number|null,agent?:{connection_id:string,name:string}|null,channel_id?:string|null};
// "Waiting on you" is one list (#16), read once per request from waiting_list(company) as the signed-in person: the
// approvals they hold (`cards`, for the card's decision), those the board shows them (`visible`: none of an Agent hidden
// from them, #190), every item but a hidden Agent's approvals, newest first (`items`), so no count names a Card the
// board leaves out, and how many things wait (`count`), a Card once with its approval and its chat's question or hand
// (#146).
// The role is no part of the read's key: the database reads it from the session, so a page may start the read before it
// knows the role (the chat does) and its parts find the same read.
export const approvalQueue=(db:Awaited<ReturnType<typeof supabase>>,company:string,person:string,role?:string)=>{ void role; return queue(db,company,person); };
const queue=cache(async(db:Awaited<ReturnType<typeof supabase>>,company:string,person:string)=>{
 void person; // the database reads it from the session
 const [stepResult,listResult]=await Promise.all([
  db.from('approval_steps').select('*').eq('company_id',company).is('removed_at',null).order('position').order('id'),
  db.rpc('waiting_list',{c:company}),
 ]);
 const listed=(listResult.data || []) as WaitingItem[];
 const ids=listed.filter(item=>item.kind==='approval').map(item=>item.id);
 const ruleIds=listed.filter(item=>item.kind==='rule_suggestion').map(item=>item.id);
 const requestIds=listed.filter(item=>item.kind==='agent_request').map(item=>item.id);
 const mentionIds=listed.filter(item=>item.kind==='mention').map(item=>item.id);
 const chats=[...new Set(listed.filter(item=>item.kind==='permission'&&item.conversation_id).map(item=>item.conversation_id!))];
 const channelIds=listed.filter(item=>item.kind==='channel_permission').map(item=>item.id);
 // A channel's question or handed step (#149) is one item per Member who may write; it opens its channel at the card.
 const channelCardIds=listed.filter(item=>item.kind==='channel_question'||item.kind==='channel_hand').map(item=>item.id);
 const [cardResult,agentResult,ruleResult,requestResult,mentionResult,chatResult,channelResult,channelCardResult]=await Promise.all([
  ids.length?db.from('work_cards').select(boardCardColumns).eq('company_id',company).in('id',ids):{data:[],error:null},
  ids.length?db.from('hermes_agents').select('id').eq('company_id',company):{data:[],error:null},
  ruleIds.length?db.from('waiting_items').select('id,agent_rules(body,hermes_agents(connection_id,name))').in('id',ruleIds):{data:[],error:null},
  requestIds.length?db.from('lead_agent_requests').select('id,apps,asked_with').eq('company_id',company).in('id',requestIds):{data:[],error:null},
  mentionIds.length?db.from('waiting_items').select('id,note_id,work_comments(body)').in('id',mentionIds):{data:[],error:null},
  chats.length?db.from('conversations').select('id,agent_id').eq('company_id',company).in('id',chats):{data:[],error:null},
  channelIds.length?db.from('channel_permissions').select('id,channel_id,channel_runs(agent_id)').eq('company_id',company).in('id',channelIds):{data:[],error:null},
  channelCardIds.length?db.from('reply_cards').select('id,channel_message_id,channel_messages(channel_id)').eq('company_id',company).in('id',channelCardIds):{data:[],error:null},
 ]);
 type ChatRow={id:string,agent_id:string}; type ChannelRow={id:number,channel_id:string,channel_runs:{agent_id:string|null}|null};
 type ChannelCardRow={id:number,channel_message_id:number,channel_messages:{channel_id:string}|null};
 const chatAgents=new Map(((chatResult.data || []) as ChatRow[]).map(row=>[row.id,row.agent_id]));
 const channelRows=new Map(((channelResult.data || []) as unknown as ChannelRow[]).map(row=>[row.id,row]));
 const channelCards=new Map(((channelCardResult.data || []) as unknown as ChannelCardRow[]).map(row=>[row.id,row]));
 const cardMessageIds=[...new Set([...channelCards.values()].map(row=>row.channel_message_id))];
 const {data:cardRuns,error:cardRunError}=cardMessageIds.length?await db.from('channel_runs').select('message_id,agent_id').eq('company_id',company).in('message_id',cardMessageIds):{data:[],error:null};
 const cardAgents=new Map(((cardRuns || []) as {message_id:number,agent_id:string|null}[]).map(row=>[row.message_id,row.agent_id]));
 const askingIds=[...new Set([...chatAgents.values(),...[...channelRows.values()].flatMap(row=>row.channel_runs?.agent_id??[]),...[...cardAgents.values()].flatMap(agent=>agent??[])])];
 const {data:faces,error:faceError}=askingIds.length?await db.from('hermes_agents').select('id,connection_id,name').eq('company_id',company).in('id',askingIds):{data:[],error:null};
 const faceOf=(agent:string|null|undefined)=>((faces || []) as {id:string,connection_id:string,name:string}[]).find(row=>row.id===agent) ?? null;
 const cards=ids.map(id=>(cardResult.data || []).find(card=>card.id===id)).filter(Boolean) as (ApprovalCard&{agent_id:string|null})[];
 const visible=visibleApprovals(cards,listed,new Set(((agentResult.data || []) as {id:string}[]).map(agent=>agent.id)));
 type RuleRow={id:number,agent_rules:{body:string,hermes_agents:{connection_id:string,name:string}|null}|null};
 const rules=new Map(((ruleResult.data || []) as unknown as RuleRow[]).map(row=>[row.id,row.agent_rules]));
 const requests=new Map(((requestResult.data || []) as (AgentRequest&{id:number})[]).map(({id,...request})=>[id,request]));
 type MentionRow={id:number,note_id:number|null,work_comments:{body:string}|null};
 // A mention opens its note and shows the note as it now stands (#22).
 const mentions=new Map(((mentionResult.data || []) as unknown as MentionRow[]).map(row=>[row.id,row]));
 const items=visible.items.map(item=>{
  if(item.kind==='agent_request') return {...item,request:requests.get(item.id)??null};
  if(item.kind==='permission') { const face=faceOf(chatAgents.get(item.conversation_id!)); return {...item,agent:face&&{connection_id:face.connection_id,name:face.name}}; }
  if(item.kind==='channel_permission') { const row=channelRows.get(item.id); const face=faceOf(row?.channel_runs?.agent_id); return {...item,channel_id:row?.channel_id??null,agent:face&&{connection_id:face.connection_id,name:face.name}}; }
  if(item.kind==='channel_question'||item.kind==='channel_hand') { const row=channelCards.get(item.id); const face=faceOf(row?cardAgents.get(row.channel_message_id):null); return {...item,channel_id:row?.channel_messages?.channel_id??null,agent:face&&{connection_id:face.connection_id,name:face.name}}; }
  const rule=item.kind==='rule_suggestion'&&rules.get(item.id);
  if(rule) return {...item,suggestion:{rule:rule.body,agent:rule.hermes_agents}};
  const mention=item.kind==='mention'?mentions.get(item.id):undefined;
  return mention?{...item,note_id:mention.note_id,body:mention.work_comments?.body??item.body}:item;
 });
 return {steps:(stepResult.data || []) as Step[],cards,visible:visible.cards,items,count:waitingCount(visible.items),available:!stepResult.error&&!listResult.error&&!cardResult.error&&!agentResult.error&&!ruleResult.error&&!requestResult.error&&!mentionResult.error&&!chatResult.error&&!channelResult.error&&!channelCardResult.error&&!cardRunError&&!faceError};
});
