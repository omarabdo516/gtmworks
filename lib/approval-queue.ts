import { cache } from 'react';
import type { supabase } from './supabase';
// One item of "Waiting on you" (ADR 0013): anything addressed to this person by kind.
// A learning suggestion (#25, kind rule_suggestion: title the rule, body the Agent's name, asked_by who told it) also
// carries the whole rule and the Agent's face. A Member's request for an Agent (#17, kind agent_request: title its name,
// body its job, asked_by the Member) also carries its apps and the message that asked, or null when those could not be
// read, so the Owner never answers a request seen in part.
type RuleSuggestion={rule:string,agent:{id:string,name:string}|null};
type AgentRequest={apps:string[],asked_with:string};
// A proposed change to an Agent's settings (#19, kind agent_change: title the Agent it would change, body what, asked_by
// the Agent that proposed it) also carries the setting, the value after the change, the reason and both Agents' faces,
// or null when those could not be read, so the Owner never approves a change seen in part.
// `approved_value`: an approval whose Engine write was never confirmed, which approving again finishes with that value (#484).
type ChangeProposal={setting:string|null,value:unknown,approved_value?:unknown,reason:string,agent:{id:string,connection_id:string,name:string},by:{id:string,connection_id:string,name:string}};
// A request to open an Agent hidden from a Member (#167, kind agent_access: title the Agent, body its job, asked_by the
// Member) also carries the Agent's face.
// A permission request (#165, kind permission in a Conversation, channel_permission in a channel: title what it asks,
// asked_by its Agent's name) also carries its Agent's face, and a channel's its channel, so it opens there. A channel's
// question or handed step (#149, channel_question and channel_hand) does the same: one item per Member who may write, its
// channel read from the card's message and its Agent's face from that message's Run. A mention in a channel message (#200,
// kind channel_mention) carries its channel and that message, so it opens there at the message.
export type WaitingItem={kind:string,id:number,title:string,body:string,asked_by:string,card_id:number|null,conversation_id:string|null,created_at:string,suggestion?:RuleSuggestion,request?:AgentRequest|null,change?:ChangeProposal|null,agent?:{id:string,name:string}|null,channel_id?:string|null,channel_message_id?:number|null};
// "Waiting on you" is one list (#16), read once per request from waiting_list(company) as the signed-in person, newest
// first. The Cards that wait are the Engine's board's, worked out from the board read in the browser (spec #831, #841,
// useWaitingCards in app/board-read.ts). The old board is switched off (#846): its approvals and the mentions in its
// Cards' notes are no part of the list, and a chat's question, hand or permission request is a row of its own.
// The role is no part of the read's key: the database reads it from the session, so a page may start the read before it
// knows the role (the chat does) and its parts find the same read.
const oldBoard=new Set(['approval','mention']);
export const approvalQueue=(db:Awaited<ReturnType<typeof supabase>>,company:string,person:string,role?:string)=>{ void role; return queue(db,company,person); };
const queue=cache(async(db:Awaited<ReturnType<typeof supabase>>,company:string,person:string)=>{
 void person; // the database reads it from the session
 const listResult=await db.rpc('waiting_list',{c:company});
 const listed=((listResult.data || []) as WaitingItem[]).filter(item=>!oldBoard.has(item.kind));
 const ruleIds=listed.filter(item=>item.kind==='rule_suggestion').map(item=>item.id);
 const requestIds=listed.filter(item=>item.kind==='agent_request').map(item=>item.id);
 const changeIds=listed.filter(item=>item.kind==='agent_change').map(item=>item.id);
 const accessIds=listed.filter(item=>item.kind==='agent_access').map(item=>item.id);
 const chats=[...new Set(listed.filter(item=>item.kind==='permission'&&item.conversation_id).map(item=>item.conversation_id!))];
 const channelIds=listed.filter(item=>item.kind==='channel_permission').map(item=>item.id);
  // A channel's question or handed step (#149) is one item per Member who may write; it opens its channel at the card.
  const channelCardIds=listed.filter(item=>item.kind==='channel_question'||item.kind==='channel_hand').map(item=>item.id);
  // A mention in a channel (#200) carries the message it points at; its channel and name are read from it below.
  const channelMentionIds=listed.filter(item=>item.kind==='channel_mention').map(item=>item.id);
  const [ruleResult,requestResult,chatResult,channelResult,channelCardResult,channelMentionResult,changeResult,accessResult]=await Promise.all([
  ruleIds.length?db.from('waiting_items').select('id,agent_rules(body,hermes_agents(id,name))').in('id',ruleIds):{data:[],error:null},
  requestIds.length?db.from('lead_agent_requests').select('id,apps,asked_with').eq('company_id',company).in('id',requestIds):{data:[],error:null},
  chats.length?db.from('conversations').select('id,agent_id').eq('company_id',company).in('id',chats):{data:[],error:null},
  channelIds.length?db.from('channel_permissions').select('id,channel_id,message_id,ordinal').eq('company_id',company).in('id',channelIds):{data:[],error:null},
  channelCardIds.length?db.from('reply_cards').select('id,channel_message_id,channel_ordinal,channel_messages(channel_id)').eq('company_id',company).in('id',channelCardIds):{data:[],error:null},
  channelMentionIds.length?db.from('waiting_items').select('id,channel_message_id').in('id',channelMentionIds):{data:[],error:null},
  changeIds.length?db.from('agent_change_proposals').select('id,setting,value,approved_value,reason,agent:hermes_agents!agent_id(id,connection_id,name),by:hermes_agents!proposed_by(id,connection_id,name)').eq('company_id',company).in('id',changeIds):{data:[],error:null},
  accessIds.length?db.from('agent_access_requests').select('id,agent:hermes_agents!agent_id(id,name)').eq('company_id',company).in('id',accessIds):{data:[],error:null},
 ]);
 type ChatRow={id:string,agent_id:string}; type ChannelRow={id:number,channel_id:string,message_id:number,ordinal:number|null};
 type ChannelCardRow={id:number,channel_message_id:number,channel_ordinal:number|null,channel_messages:{channel_id:string}|null};
 const chatAgents=new Map(((chatResult.data || []) as ChatRow[]).map(row=>[row.id,row.agent_id]));
 const channelRows=new Map(((channelResult.data || []) as unknown as ChannelRow[]).map(row=>[row.id,row]));
 const channelCards=new Map(((channelCardResult.data || []) as unknown as ChannelCardRow[]).map(row=>[row.id,row]));
 const cardMessageIds=[...new Set([...channelCards.values()].map(row=>row.channel_message_id))];
 // #152: a message may call up to three Agents, each with a Run at its own place. A card names the place of the Run that
 // asked it (`channel_ordinal`), so its Agent is that Run's, never the message's other Agent.
 const {data:cardRuns,error:cardRunError}=cardMessageIds.length?await db.from('channel_runs').select('message_id,ordinal,agent_id').eq('company_id',company).in('message_id',cardMessageIds):{data:[],error:null};
 const cardAgents=new Map(((cardRuns || []) as {message_id:number,ordinal:number|null,agent_id:string|null}[]).map(row=>[`${row.message_id}:${row.ordinal??1}`,row.agent_id]));
 // A request's Run is read the same way, by its message and place: a Member may not read channel_runs.run_id, which the
 // table's own embed would need, so the Agent comes from the columns they may read.
 const permissionMessages=[...new Set([...channelRows.values()].map(row=>row.message_id))];
 const {data:permissionRuns,error:permissionRunError}=permissionMessages.length?await db.from('channel_runs').select('message_id,ordinal,agent_id').eq('company_id',company).in('message_id',permissionMessages):{data:[],error:null};
 const permissionAgents=new Map(((permissionRuns || []) as {message_id:number,ordinal:number|null,agent_id:string|null}[]).map(row=>[`${row.message_id}:${row.ordinal??1}`,row.agent_id]));
 const channelAgentOf=(row:ChannelRow|undefined)=>row?permissionAgents.get(`${row.message_id}:${row.ordinal??1}`)??null:null;
 const askingIds=[...new Set([...chatAgents.values(),...[...channelRows.values()].flatMap(channelAgentOf).flatMap(agent=>agent??[]),...[...cardAgents.values()].flatMap(agent=>agent??[])])];
 const {data:faces,error:faceError}=askingIds.length?await db.from('hermes_agents').select('id,connection_id,name').eq('company_id',company).in('id',askingIds):{data:[],error:null};
 const faceOf=(agent:string|null|undefined)=>((faces || []) as {id:string,connection_id:string,name:string}[]).find(row=>row.id===agent) ?? null;
 type RuleRow={id:number,agent_rules:{body:string,hermes_agents:{id:string,name:string}|null}|null};
 const rules=new Map(((ruleResult.data || []) as unknown as RuleRow[]).map(row=>[row.id,row.agent_rules]));
 const requests=new Map(((requestResult.data || []) as (AgentRequest&{id:number})[]).map(({id,...request})=>[id,request]));
 type ChangeRow={id:number,setting:string|null,value:unknown,approved_value?:unknown,reason:string,agent:ChangeProposal['agent']|null,by:ChangeProposal['by']|null};
 const accessFaces=new Map(((accessResult.data || []) as unknown as {id:number,agent:{id:string,name:string}|null}[]).map(row=>[row.id,row.agent]));
 const changes=new Map(((changeResult.data || []) as unknown as ChangeRow[]).flatMap(({id,agent,by,...change})=>agent&&by?[[id,{...change,agent,by}] as const]:[]));
 const mentioned=new Map(((channelMentionResult.data || []) as {id:number,channel_message_id:number|null}[]).map(row=>[row.id,row.channel_message_id]));
 const mentionedMessageIds=[...new Set([...mentioned.values()].flatMap(id=>id??[]))];
 // A mention in a channel opens it at the message it points at (#200), and names its channel: a team channel its own name,
 // the general one no name at all, so a reader draws the general channel's word in the language it reads.
 const mentionedMessageResult=mentionedMessageIds.length?await db.from('channel_messages').select('id,channel_id').in('id',mentionedMessageIds):{data:[],error:null};
 const mentionedMessages=(mentionedMessageResult.data||[]) as {id:number,channel_id:string}[];
 const mentionedChannels=[...new Set(mentionedMessages.map(row=>row.channel_id))];
 const channelNameResult=mentionedChannels.length?await db.from('channels').select('id,kind,name').eq('company_id',company).in('id',mentionedChannels):{data:[],error:null};
 const channelNames=(channelNameResult.data||[]) as {id:string,kind:string,name:string|null}[];
 const messageChannel=new Map(mentionedMessages.map(row=>[row.id,row.channel_id]));
 const channelName=new Map(channelNames.map(row=>[row.id,row.kind==='team'?row.name??'':'']));
 const items=listed.map(item=>{
  if(item.kind==='agent_request') return {...item,request:requests.get(item.id)??null};
  if(item.kind==='agent_change') return {...item,change:changes.get(item.id)??null};
  if(item.kind==='agent_access') return {...item,agent:accessFaces.get(item.id)??null};
  if(item.kind==='permission') { const face=faceOf(chatAgents.get(item.conversation_id!)); return {...item,agent:face&&{id:face.id,name:face.name}}; }
  if(item.kind==='channel_permission') { const row=channelRows.get(item.id); const face=faceOf(channelAgentOf(row)); return {...item,channel_id:row?.channel_id??null,agent:face&&{id:face.id,name:face.name}}; }
  if(item.kind==='channel_question'||item.kind==='channel_hand') { const row=channelCards.get(item.id); const face=faceOf(row?cardAgents.get(`${row.channel_message_id}:${row.channel_ordinal??1}`):null); return {...item,channel_id:row?.channel_messages?.channel_id??null,agent:face&&{id:face.id,name:face.name}}; }
  if(item.kind==='channel_mention') { const message=mentioned.get(item.id)??null; const channel=message!==null?messageChannel.get(message)??null:null;
   return {...item,channel_message_id:message,channel_id:channel,title:channel!==null?channelName.get(channel)??'':item.title}; }
  const rule=item.kind==='rule_suggestion'&&rules.get(item.id);
  return rule?{...item,suggestion:{rule:rule.body,agent:rule.hermes_agents}}:item;
 });
 return {items,rows:items.length,available:!listResult.error&&!ruleResult.error&&!requestResult.error&&!chatResult.error&&!channelResult.error&&!channelCardResult.error&&!channelMentionResult.error&&!changeResult.error&&!accessResult.error&&!cardRunError&&!permissionRunError&&!faceError&&!mentionedMessageResult.error&&!channelNameResult.error};
});
