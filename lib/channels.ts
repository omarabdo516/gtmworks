import type { supabase } from './supabase';
import { agentStatus, type AgentStatus } from './agent-details.mjs';
import type { SessionUsage } from './engine.mjs';
import { replyCardColumns, replyCardOf, stepsOfReplies, type PermissionChoice, type ReplyCard, type ReplyCardRow, type RunSteps, type SessionTurn } from './conversations';

type Database=Awaited<ReturnType<typeof supabase>>;
type MemberRole='owner'|'manager'|'contributor'|'viewer';
type MentionState='open'|'answered'|'unanswered';
type ChannelPermission=Extract<ReplyCard,{kind:'permission'}>;
// A message that calls an Agent carries what its Run asked to be allowed (#165), drawn as the Agent's turn under it;
// `face` is the Agent's, for that turn. An Agent's reply carries its Run's steps, read live from the Agent's Hermes
// session (#148, #346), and the cards it showed with it (#136, #137). A note is the one quiet line a channel gets that is
// not a message (#207): nobody writes it, nobody can be mentioned in it, and it starts no Run. Its id is negative, so it
// is never a message's.
export type ChannelMessage=
 | {id:number,author:'person',mine:boolean,name:string,role:MemberRole|null,body:string,at:string,mention:{agent:string,face:string,state:MentionState,permissions:ChannelPermission[]}|null}
 | {id:number,author:'agent',name:string,face:string,body:string,at:string,steps?:RunSteps,cards?:ReplyCard[]}
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
type StoredMessage={id:number,author:'person'|'agent',person_id:string|null,agent_id:string|null,author_name:string,body:string,reply_to:number|null,created_at:string};
type StoredNote={id:number,kind:'invite',invitee_name:string,actor_name:string,created_at:string};
type StoredRun={message_id:number,agent_id:string|null,agent_name:string,outcome:string|null};
type StoredPermission={id:number,message_id:number,title:string,content:unknown,state:string,decided_at:string|null,created_at:string};
type StoredAgent={id:string,connection_id:string,name:string,speciality:string,main:boolean,here_only:boolean};
type StoredCard=ReplyCardRow&{channel_message_id:number};
type StoredSession={message_id:number,agent_id:string,profile:string,session:string};
// A channel's replies read their Run's steps from the Agent's Hermes session when the channel opens (#346), never kept.
// `profile` is the one the Run was pinned to; the callback reads the session there.
type ReadSession=(agent:string,session:string,profile:string)=>Promise<{turns:SessionTurn[],usage:SessionUsage|null}|null>;
const shownMessages=200;

const stateOf=(outcome:string|null):MentionState=>outcome===null?'open':outcome==='completed'?'answered':'unanswered';
const nameOf=(row:{kind:string,name:string|null}):ChannelName=>row.kind==='team'&&row.name?{kind:'team',name:row.name}:{kind:'general'};
export const channelTitle=(t:(key:string)=>string,channel:ChannelName)=>channel.kind==='team'?channel.name:t('shellGeneralChannel');

export async function channelSidebar(db:Database,company:string):Promise<ChannelSummary[]> {
 const {data}=await db.rpc('channel_sidebar',{c:company});
 return ((data||[]) as {id:string,kind:string,name:string|null,unread:number}[]).map(row=>({...nameOf(row),id:row.id,unread:row.unread}));
}

// With `read`, the reader has read every message it returns. Only the open channel asks for that: a page render can be
// a link's prefetch, which nobody saw. `session` reads an Agent's Hermes session for its replies' steps (#148), as a
// Conversation's record does (#346).
export async function channelRecord(db:Database,person:string,company:string,channel:string,read=false,session?:ReadSession):Promise<ChannelRecord|null> {
 const {data:found}=await db.from('channels').select('id,company_id,kind,name').eq('id',channel).eq('company_id',company).maybeSingle();
 if(!found) return null;
 const name=nameOf(found);
 // Runs first: a Run closed between the two reads then shows its reply too (both are written in one transaction). Each
 // Run has its own message, so the latest Runs by message cover every Run of the messages shown.
 const runs=((await db.from('channel_runs').select('message_id,agent_id,agent_name,outcome').eq('channel_id',channel).order('message_id',{ascending:false}).limit(shownMessages)).data||[]) as StoredRun[];
 const {data:openRuns}=await db.from('channel_runs').select('agent_id').eq('channel_id',channel).is('outcome',null);
 const latest=((await db.from('channel_messages').select('id,author,person_id,agent_id,author_name,body,reply_to,created_at').eq('channel_id',channel).order('id',{ascending:false}).limit(shownMessages)).data||[]) as StoredMessage[];
 // The quiet lines the channel got (#207). Not messages: nobody writes them, they are never called, and they start no
 // Run. Only the ones inside the messages shown are drawn.
 const notes=((await db.from('channel_notes').select('id,kind,invitee_name,actor_name,created_at').eq('channel_id',channel).order('id',{ascending:false}).limit(shownMessages)).data||[]) as StoredNote[];
 const ordered=[...latest].reverse();
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
 // A reply's cards (#136, #137) are kept against the message its Run answers. Every member of the channel reads them.
 const askedIds=ordered.filter(message=>message.author==='person').map(message=>message.id);
 const cards=askedIds.length?((await db.from('reply_cards').select(`${replyCardColumns},channel_message_id`).in('channel_message_id',askedIds).order('id')).data||[]) as StoredCard[]:[];
 const cardsOf=new Map<number,ReplyCard[]>();
 for(const row of cards) { const card=replyCardOf(row); if(card) cardsOf.set(row.channel_message_id,[...(cardsOf.get(row.channel_message_id)??[]),card]); }
 // A reply's steps are its own Hermes turn (#346): each Agent's session, matched to its replies by time, never kept.
 const stepsOf=new Map<number,RunSteps>();
 const replies=ordered.filter(message=>message.author==='agent'&&message.reply_to!==null);
 if(session&&replies.length) {
  const {data:runsRead}=await db.rpc('channel_run_sessions',{ch:channel,after:askedIds[0]??0});
  const runOfMessage=new Map(((runsRead||[]) as StoredSession[]).map(row=>[row.message_id,row]));
  const groups=new Map<string,{agent:string,profile:string,session:string,replies:StoredMessage[]}>();
  for(const reply of replies) {
   const run=runOfMessage.get(reply.reply_to!); if(!run) continue;
   const key=`${run.agent_id}:${run.session}`;
   const group=groups.get(key)??{agent:run.agent_id,profile:run.profile,session:run.session,replies:[]};
   group.replies.push(reply); groups.set(key,group);
  }
  await Promise.all([...groups.values()].map(async group=>{
   const turns=(await session(group.agent,group.session,group.profile).catch(()=>null))?.turns??null;
   const rows=stepsOfReplies(group.replies.map(reply=>({author:'agent',run_id:String(reply.id),created_at:reply.created_at})),turns);
   for(const row of rows) stepsOf.set(Number(row.run_id),{list:row.steps,seconds:row.seconds});
  }));
 }
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
  ordered.map((message):ChannelMessage=>{
   if(message.author==='agent') return {id:message.id,author:'agent',name:message.author_name,face:seen.find(agent=>agent.id===message.agent_id)?.connection_id||message.agent_id||message.author_name,body:message.body,at:message.created_at,
    ...(stepsOf.has(message.id)?{steps:stepsOf.get(message.id)}:{}),...(message.reply_to!==null&&cardsOf.has(message.reply_to)?{cards:cardsOf.get(message.reply_to)}:{})};
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
