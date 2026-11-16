import type { supabase } from './supabase';

type Database=Awaited<ReturnType<typeof supabase>>;
type MemberRole='owner'|'manager'|'contributor'|'viewer';
type MentionState='open'|'answered'|'unanswered';
export type ChannelMessage=
 | {id:number,author:'person',mine:boolean,name:string,role:MemberRole|null,body:string,at:string,mention:{agent:string,state:MentionState}|null}
 | {id:number,author:'agent',name:string,face:string,body:string,at:string};
export type ChannelName={kind:'general'}|{kind:'team',name:string};
export type ChannelSummary=ChannelName&{id:string,unread:number};
// `only`: shown to the reader in this channel and hidden from them everywhere else.
export type ChannelAgent={id:string,connection_id:string,name:string,speciality:string,main:boolean,only:boolean};
export type ChannelRecord={
 channel:{id:string,company:string}&ChannelName,
 members:{person:string,name:string,role:MemberRole}[],
 agents:ChannelAgent[],
 writer:boolean,
 // The reader adds and removes people and Agents: an Owner or a Manager, in a team channel.
 manage:boolean,
 // Who does, named to a reader who cannot (a team channel only).
 managers:{name:string,role:'owner'|'manager'}[],
 messages:ChannelMessage[],
 open:boolean,
};
type StoredMessage={id:number,author:'person'|'agent',person_id:string|null,agent_id:string|null,author_name:string,body:string,created_at:string};
type StoredRun={message_id:number,agent_name:string,outcome:string|null};
type StoredAgent={id:string,connection_id:string,name:string,speciality:string,main:boolean,here_only:boolean};
const shownMessages=200;

const stateOf=(outcome:string|null):MentionState=>outcome===null?'open':outcome==='completed'?'answered':'unanswered';
const nameOf=(row:{kind:string,name:string|null}):ChannelName=>row.kind==='team'&&row.name?{kind:'team',name:row.name}:{kind:'general'};
export const channelTitle=(t:(key:string)=>string,channel:ChannelName)=>channel.kind==='team'?channel.name:t('shellGeneralChannel');

export async function channelSidebar(db:Database,company:string):Promise<ChannelSummary[]> {
 const {data}=await db.rpc('channel_sidebar',{c:company});
 return ((data||[]) as {id:string,kind:string,name:string|null,unread:number}[]).map(row=>({...nameOf(row),id:row.id,unread:row.unread}));
}

// With `read`, the reader has read every message it returns. Only the open channel asks for that: a page render can be
// a link's prefetch, which nobody saw.
export async function channelRecord(db:Database,person:string,company:string,channel:string,read=false):Promise<ChannelRecord|null> {
 const {data:found}=await db.from('channels').select('id,company_id,kind,name').eq('id',channel).eq('company_id',company).maybeSingle();
 if(!found) return null;
 const name=nameOf(found);
 // Runs first: a Run closed between the two reads then shows its reply too (both are written in one transaction). Each
 // Run has its own message, so the latest Runs by message cover every Run of the messages shown.
 const runs=((await db.from('channel_runs').select('message_id,agent_name,outcome').eq('channel_id',channel).order('message_id',{ascending:false}).limit(shownMessages)).data||[]) as StoredRun[];
 const {count:waiting}=await db.from('channel_runs').select('message_id',{count:'exact',head:true}).eq('channel_id',channel).is('outcome',null);
 const latest=((await db.from('channel_messages').select('id,author,person_id,agent_id,author_name,body,created_at').eq('channel_id',channel).order('id',{ascending:false}).limit(shownMessages)).data||[]) as StoredMessage[];
 const {data:members}=await db.rpc('channel_members',{ch:channel});
 // A team channel's Agents come with it, also one hidden from the reader elsewhere, so its replies keep their face.
 const {data:agents}=await db.rpc('channel_agent_list',{ch:channel});
 const {data:writer}=await db.rpc('conversation_can_write',{c:company});
 const {data:manager}=await db.rpc('can_manage_company',{target:company});
 const people=(members||[]) as {person:string,name:string,role:MemberRole}[];
 const seen=(agents||[]) as StoredAgent[];
 // Only who is in a team channel can change it (set_channel_person, set_channel_agent), so only they are named: the
 // Owner first, then the Managers.
 const managers=name.kind==='team'?(['owner','manager'] as const).flatMap(role=>people.filter(member=>member.role===role&&member.name).map(member=>({name:member.name,role}))):[];
 const newest=latest[0]?.id;
 const runOf=new Map(runs.map(run=>[run.message_id,run]));
 const messages=latest.reverse().map((message):ChannelMessage=>{
  if(message.author==='agent') return {id:message.id,author:'agent',name:message.author_name,face:seen.find(agent=>agent.id===message.agent_id)?.connection_id||message.agent_id||message.author_name,body:message.body,at:message.created_at};
  const run=runOf.get(message.id);
  return {id:message.id,author:'person',mine:message.person_id===person,name:message.author_name,role:people.find(member=>member.person===message.person_id)?.role??null,body:message.body,at:message.created_at,mention:run?{agent:run.agent_name,state:stateOf(run.outcome)}:null};
 });
 if(read&&newest!==undefined) await db.rpc('read_channel',{ch:channel,through:newest});
 return {
  channel:{id:found.id,company:found.company_id,...name},
  members:people,
  agents:seen.map(agent=>({id:agent.id,connection_id:agent.connection_id,name:agent.name,speciality:agent.speciality,main:agent.main,only:agent.here_only})),
  writer:!!writer,
  manage:!!manager&&name.kind==='team',
  managers,
  messages,
  open:(waiting??0)>0,
 };
}

export const firstName=(name:string)=>name.trim().split(/\s+/)[0]||name;

export function withMention(body:string,agent:string|null|undefined):{text:string,mention:boolean}[] {
 if(!agent) return [{text:body,mention:false}];
 const at=body.toLowerCase().indexOf(`@${agent.toLowerCase()}`);
 if(at<0) return [{text:body,mention:false}];
 const end=at+agent.length+1;
 return [{text:body.slice(0,at),mention:false},{text:body.slice(at,end),mention:true},{text:body.slice(end),mention:false}].filter(part=>part.text);
}
