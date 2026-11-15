import type { supabase } from './supabase';

type Database=Awaited<ReturnType<typeof supabase>>;
type MemberRole='owner'|'manager'|'contributor'|'viewer';
// What a message that called an Agent shows under it: the Agent is replying, answered, or could not reply.
type MentionState='open'|'answered'|'unanswered';
export type ChannelMessage=
 | {id:number,author:'person',mine:boolean,name:string,role:MemberRole|null,body:string,at:string,mention:{agent:string,state:MentionState}|null}
 | {id:number,author:'agent',name:string,face:string,body:string,at:string};
type ChannelAgent={id:string,connection_id:string,name:string,speciality:string,main:boolean};
export type ChannelRecord={
 channel:{id:string,company:string},
 members:{person:string,name:string,role:MemberRole}[],
 // The Agents the reader sees, the main one first: the ones they can call here.
 agents:ChannelAgent[],
 writer:boolean,
 messages:ChannelMessage[],
 // A mention still waits for its reply: the page asks again soon.
 open:boolean,
};
type StoredMessage={id:number,author:'person'|'agent',person_id:string|null,agent_id:string|null,author_name:string,body:string,created_at:string};
type StoredRun={message_id:number,agent_name:string,outcome:string|null};
const shownMessages=200;

const stateOf=(outcome:string|null):MentionState=>outcome===null?'open':outcome==='completed'?'answered':'unanswered';

// The channel as the reader may see it (RLS: only a member of it reads anything), or null when they are not in it. The
// page and its poll draw from this one record. Which Agent a message called is the database's own reading of it (its
// Run row); the page only marks that name. A reply by an Agent the reader does not see is still shown, as every member
// sees the channel; its face is then drawn from the Agent's id.
export async function channelRecord(db:Database,person:string,company:string,channel:string):Promise<ChannelRecord|null> {
 const {data:found}=await db.from('channels').select('id,company_id').eq('id',channel).eq('company_id',company).maybeSingle();
 if(!found) return null;
 // Runs first: a Run closed between the two reads then shows its reply too (both are written in one transaction).
 const runs=((await db.from('channel_runs').select('message_id,agent_name,outcome').eq('channel_id',channel)).data||[]) as StoredRun[];
 const latest=((await db.from('channel_messages').select('id,author,person_id,agent_id,author_name,body,created_at').eq('channel_id',channel).order('id',{ascending:false}).limit(shownMessages)).data||[]) as StoredMessage[];
 const {data:members}=await db.rpc('channel_members',{ch:channel});
 const {data:agents}=await db.from('hermes_agents').select('id,connection_id,name,speciality,is_default').eq('company_id',company).order('is_default',{ascending:false}).order('name');
 const {data:writer}=await db.rpc('conversation_can_write',{c:company});
 const people=(members||[]) as {person:string,name:string,role:MemberRole}[];
 const seen=(agents||[]) as {id:string,connection_id:string,name:string,speciality:string,is_default:boolean}[];
 const runOf=new Map(runs.map(run=>[run.message_id,run]));
 const messages=latest.reverse().map((message):ChannelMessage=>{
  if(message.author==='agent') return {id:message.id,author:'agent',name:message.author_name,face:seen.find(agent=>agent.id===message.agent_id)?.connection_id||message.agent_id||message.author_name,body:message.body,at:message.created_at};
  const run=runOf.get(message.id);
  return {id:message.id,author:'person',mine:message.person_id===person,name:message.author_name,role:people.find(member=>member.person===message.person_id)?.role??null,body:message.body,at:message.created_at,mention:run?{agent:run.agent_name,state:stateOf(run.outcome)}:null};
 });
 return {
  channel:{id:found.id,company:found.company_id},
  members:people,
  agents:seen.map(agent=>({id:agent.id,connection_id:agent.connection_id,name:agent.name,speciality:agent.speciality,main:agent.is_default})),
  writer:!!writer,
  messages,
  open:runs.some(run=>run.outcome===null),
 };
}

// The writer's first name, as the channel names a member beside their message.
export const firstName=(name:string)=>name.trim().split(/\s+/)[0]||name;

// The message split around the Agent it called, so the page marks that name: the first "@<name>", in any case.
export function withMention(body:string,agent:string|null|undefined):{text:string,mention:boolean}[] {
 if(!agent) return [{text:body,mention:false}];
 const at=body.toLowerCase().indexOf(`@${agent.toLowerCase()}`);
 if(at<0) return [{text:body,mention:false}];
 const end=at+agent.length+1;
 return [{text:body.slice(0,at),mention:false},{text:body.slice(at,end),mention:true},{text:body.slice(end),mention:false}].filter(part=>part.text);
}
