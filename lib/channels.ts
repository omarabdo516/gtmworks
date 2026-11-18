import type { supabase } from './supabase';
import { agentStatus, type AgentStatus } from './agent-details.mjs';
import { replyCardOf, type PermissionChoice, type ReplyCard } from './conversations';

type Database=Awaited<ReturnType<typeof supabase>>;
type MemberRole='owner'|'manager'|'contributor'|'viewer';
type MentionState='open'|'answered'|'unanswered';
type ChannelPermission=Extract<ReplyCard,{kind:'permission'}>;
// A message that calls an Agent carries what its Run asked to be allowed (#165), drawn as the Agent's turn under it;
// `face` is the Agent's, for that turn. A note is the one quiet line a channel gets that is not a message (#207): nobody
// writes it, nobody can be mentioned in it, and it starts no Run. Its id is negative, so it is never a message's.
export type ChannelMessage=
 | {id:number,author:'person',mine:boolean,name:string,role:MemberRole|null,body:string,at:string,mention:{agent:string,face:string,state:MentionState,permissions:ChannelPermission[]}|null}
 | {id:number,author:'agent',name:string,face:string,body:string,at:string}
 | {id:number,author:'note',kind:'invite',actor:string,name:string,at:string};
export type ChannelName={kind:'general'}|{kind:'team',name:string};
export type ChannelSummary=ChannelName&{id:string,unread:number};
// One row of a channel's members. An invited person who has not joined is a row too (#207): no person yet, their name made
// from the email, and the email only for the Owner and the Managers (decision 0043; `channel_members` leaves it out for
// everyone else).
type ChannelMember={person:string|null,name:string,role:MemberRole,invitation:string|null,email:string|null};
// `only`: shown to the reader in this channel and hidden from them everywhere else. `state` is the Agent's own state
// (#206), with a Run started by a call in this channel counting as working; never whom that work is for or on what.
export type ChannelAgent={id:string,connection_id:string,name:string,speciality:string,main:boolean,only:boolean,state:AgentStatus};
export type ChannelRecord={
 channel:{id:string,company:string}&ChannelName,
 members:ChannelMember[],
 agents:ChannelAgent[],
 writer:boolean,
 // The reader adds and removes people and Agents: an Owner or a Manager, in a team channel.
 manage:boolean,
 // Who does, named to a reader who cannot (a team channel only).
 managers:{name:string,role:'owner'|'manager'}[],
 messages:ChannelMessage[],
 open:boolean,
 // The choices the reader's role may send on a request of their own (permission_choices, #163).
 may:PermissionChoice[],
};
type StoredMessage={id:number,author:'person'|'agent',person_id:string|null,agent_id:string|null,author_name:string,body:string,created_at:string};
type StoredNote={id:number,kind:'invite',invitee_name:string,actor_name:string,created_at:string};
type StoredRun={message_id:number,agent_id:string|null,agent_name:string,outcome:string|null};
type StoredPermission={id:number,message_id:number,title:string,content:unknown,state:string,decided_at:string|null,created_at:string};
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
 const runs=((await db.from('channel_runs').select('message_id,agent_id,agent_name,outcome').eq('channel_id',channel).order('message_id',{ascending:false}).limit(shownMessages)).data||[]) as StoredRun[];
 const {data:openRuns}=await db.from('channel_runs').select('agent_id').eq('channel_id',channel).is('outcome',null);
 const latest=((await db.from('channel_messages').select('id,author,person_id,agent_id,author_name,body,created_at').eq('channel_id',channel).order('id',{ascending:false}).limit(shownMessages)).data||[]) as StoredMessage[];
 // The quiet lines the channel got (#207). Not messages: nobody writes them, they are never called, and they start no
 // Run. Only the ones inside the messages shown are drawn.
 const notes=((await db.from('channel_notes').select('id,kind,invitee_name,actor_name,created_at').eq('channel_id',channel).order('id',{ascending:false}).limit(shownMessages)).data||[]) as StoredNote[];
 const {data:members}=await db.rpc('channel_members',{ch:channel});
 // A team channel's Agents come with it, also one hidden from the reader elsewhere, so its replies keep their face.
 const {data:agents}=await db.rpc('channel_agent_list',{ch:channel});
 // Each Agent's own state (#206): what waits on the reader, and its open Runs. It runs as the reader, so only their own
 // state comes back, and only the state is kept below.
 const {data:states}=await db.rpc('agent_states',{c:company});
 const {data:writer}=await db.rpc('conversation_can_write',{c:company});
 const {data:manager}=await db.rpc('can_manage_company',{target:company});
 const {data:may}=await db.rpc('permission_choices',{c:company});
 const asked=runs.length?((await db.from('channel_permissions').select('id,message_id,title,content,state,decided_at,created_at').eq('channel_id',channel).gte('message_id',runs.at(-1)!.message_id).order('id')).data||[]) as StoredPermission[]:[];
 const people=(members||[]) as ChannelMember[];
 const seen=(agents||[]) as StoredAgent[];
 // A Run open in this channel counts as its Agent working, in addition to the Runs the Agent's own state sees.
 const working=new Set(((openRuns||[]) as {agent_id:string|null}[]).flatMap(run=>run.agent_id??[]));
 const stateOfAgent=new Map(((states||[]) as {agent:string,running:boolean,waiting_mine:boolean}[]).map(row=>[row.agent,row]));
 // Only who is in a team channel can change it (set_channel_person, set_channel_agent), so only they are named: the
 // Owner first, then the Managers. An invited person is no Member yet, and changes nothing.
 const managers=name.kind==='team'?(['owner','manager'] as const).flatMap(role=>people.filter(member=>!member.invitation&&member.role===role&&member.name).map(member=>({name:member.name,role}))):[];
 const newest=latest[0]?.id;
 const oldest=latest.at(-1)?.created_at;
 const runOf=new Map(runs.map(run=>[run.message_id,run]));
 const written:[ChannelMessage[],ChannelMessage[]]=[
  [...latest].reverse().map((message):ChannelMessage=>{
   if(message.author==='agent') return {id:message.id,author:'agent',name:message.author_name,face:seen.find(agent=>agent.id===message.agent_id)?.connection_id||message.agent_id||message.author_name,body:message.body,at:message.created_at};
   const run=runOf.get(message.id);
   const permissions=asked.filter(row=>row.message_id===message.id).flatMap(row=>replyCardOf({...row,run_id:'',kind:'permission',answered_at:null,done_at:null})??[]) as ChannelPermission[];
   return {id:message.id,author:'person',mine:message.person_id===person,name:message.author_name,role:people.find(member=>member.person===message.person_id)?.role??null,body:message.body,at:message.created_at,
    mention:run?{agent:run.agent_name,face:seen.find(agent=>agent.id===run.agent_id)?.connection_id||run.agent_id||run.agent_name,state:stateOf(run.outcome),permissions}:null};
  }),
  notes.filter(note=>oldest===undefined||note.created_at>=oldest).map((note):ChannelMessage=>({id:-note.id,author:'note',kind:note.kind,actor:note.actor_name,name:note.invitee_name,at:note.created_at})),
 ];
 // The lines in the order they were written: a note is drawn where it happened, after a message written at the same
 // moment (the sort is stable, and the messages come first).
 const messages=written.flat().sort((a,b)=>a.at<b.at?-1:a.at>b.at?1:0);
 if(read&&newest!==undefined) await db.rpc('read_channel',{ch:channel,through:newest});
 return {
  channel:{id:found.id,company:found.company_id,...name},
  members:people,
  agents:seen.map(agent=>{
   const own=stateOfAgent.get(agent.id);
   return {id:agent.id,connection_id:agent.connection_id,name:agent.name,speciality:agent.speciality,main:agent.main,only:agent.here_only,
    state:agentStatus({waitingMine:own?.waiting_mine??false,running:(own?.running??false)||working.has(agent.id)})};
  }),
  writer:!!writer,
  manage:!!manager&&name.kind==='team',
  managers,
  messages,
  open:((openRuns||[]) as {agent_id:string|null}[]).length>0,
  may:(may||[]) as PermissionChoice[],
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
