import type { supabase } from './supabase';
import type { BoardColumn } from './board-columns.mjs';
import { agentStatus, type AgentStatus } from './agent-details.mjs';
import type { SessionUsage } from './engine.mjs';
import { handoverUnfinished, replyCardColumns, replyCardOf, stepsOfReplies, type PermissionChoice, type ReplyCard, type ReplyCardRow, type RunSteps, type SessionTurn } from './conversations';

type Database=Awaited<ReturnType<typeof supabase>>;
type MemberRole='owner'|'manager'|'contributor'|'viewer';
// `noModel`: its Run failed because the Company has no model connected at all (#428), which the channel says as a
// Conversation does (#422), instead of that the Agent could not reply.
type MentionState='open'|'answered'|'unanswered'|'noModel';
type ChannelPermission=Extract<ReplyCard,{kind:'permission'}>;
// One Agent a message called (#152): its Run's state, what that Run asked to be allowed (#165), drawn as the Agent's
// turn under the message, and the questions that Run asked (#149), drawn in that same turn; `face` is the Agent's, for
// that turn. A question whose Agent is the main Agent is the chips card (#143) and only the Member whose message it is
// answers it (`chips`).
export type ChannelQuestion=Extract<ReplyCard,{kind:'question'}>&{chips:boolean};
export type ChannelMention={agent:string,face:string,state:MentionState,permissions:ChannelPermission[],questions:ChannelQuestion[]};
// A message that calls an Agent carries what its Run asked to be allowed (#165), drawn as the Agent's turn under it;
// `face` is the Agent's, for that turn. A message may call up to three Agents (#152): `mentions` is each of them in the
// order named, and `mention` the first, which a channel with one Agent called is. An Agent's reply carries its Run's
// steps, read live from the Agent's Hermes session (#148, #346), and the cards it showed with it (#136, #137, #139). A
// note is the one quiet line a channel gets that is not a message (#207, #151): nobody writes it, nobody can be mentioned in it, and it
// starts no Run. Its id is negative, so it is never a message's. The quiet message "Done it" writes to ask an Agent to
// pick up (#149) is `handDone`: nothing draws a bubble of it, and the card shows the press instead.
// A handover in the channel (#150) is a quiet row between turns, with its own id: the two Agents and their faces, the
// other Agent's answer marked `to` the Agent that handed it over, and then that Agent's own reply. A handover that did
// not finish (#375) marks its row `failed`, and one that ended with no reply because the Company has no model connected
// (#428) also says so under its row (`noModel`).
// A message may carry images (#156), drawn as chips under it for every Member.
type ChannelFile={id:number,name:string};
type ChannelFace={name:string,face:string};
export type ChannelMessage=
 | {id:number,author:'person',mine:boolean,name:string,role:MemberRole|null,body:string,at:string,files:ChannelFile[],mention:ChannelMention|null,mentions?:ChannelMention[],handDone?:true}
 | {id:number|string,author:'agent',name:string,face:string,body:string,at:string,to?:string,steps?:RunSteps,cards?:ReplyCard[]}
 | {id:number,author:'note',kind:'invite',actor:string,name:string,at:string}
 | {id:number,author:'note',kind:'card',at:string}
 | {id:string,author:'handoff',from:ChannelFace,to:ChannelFace,goal:string,at:string,failed?:true,noModel?:true};
// One handover of a channel, as its details draw it: both faces, the Agent handed the work, and the job, newest first,
// and that it did not finish when so (#375).
export type ChannelHandoff={id:number,from:ChannelFace,to:ChannelFace,goal:string,at:string,failed?:true};
export type ChannelName={kind:'general'}|{kind:'team',name:string};
export type ChannelSummary=ChannelName&{id:string,unread:number};
// One row of a channel's members. An invited person who has not joined is a row too (#207): no person yet, their name made
// from the email, and the email only for the Owner and the Managers (decision 0043; `channel_members` leaves it out for
// everyone else).
type ChannelMember={person:string|null,name:string,role:MemberRole,invitation:string|null,email:string|null};
// `only`: shown to the reader in this channel and hidden from them everywhere else. `state` is the Agent's own state
// (#206), with a Run started by a call in this channel counting as working; never whom that work is for or on what.
export type ChannelAgent={id:string,connection_id:string,name:string,speciality:string,main:boolean,only:boolean,state:AgentStatus};
// The Card a team channel put on the board (#151): its title, the column it stands in now, the line under it, and
// whether it waits (a review stage or its chat's wait). Read only for a Member who sees its Agent, as the board reads it.
type ChannelBoard={card:number,title:string,column:BoardColumn,line:string,waiting:boolean};
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
 // The channel's handovers (#150), newest first, for the details' "Handoffs" section and its count.
 handoffs:ChannelHandoff[],
 open:boolean,
 // A handover of this channel is still moving, so the channel asks again as it does while a Run is open.
 handover:boolean,
 // The choices the reader's role may send on a request of their own (permission_choices, #163).
 may:PermissionChoice[],
 // The channel's Card on the board (#151), when it has one the reader may see; absent otherwise.
 board?:ChannelBoard,
 // A Run or a handover shown failed because the Company has no model connected (#428): the Owner gets the link to
 // Subscription and models, a Member is told to ask the Owner. Absent otherwise.
 noModel?:{owner:boolean},
};
type StoredMessage={id:number,author:'person'|'agent',person_id:string|null,agent_id:string|null,author_name:string,body:string,reply_to:number|null,reply_ordinal:number|null,hand_card:number|null,created_at:string};
type StoredNote={id:number,kind:'invite'|'card',invitee_name:string|null,actor_name:string,created_at:string};
type StoredRun={message_id:number,ordinal:number|null,agent_id:string|null,agent_name:string,outcome:string|null};
type StoredPermission={id:number,message_id:number,ordinal:number|null,title:string,content:unknown,state:string,decided_at:string|null,created_at:string};
type StoredFile={id:number,message_id:number,name:string};
type StoredAgent={id:string,connection_id:string,name:string,speciality:string,main:boolean,here_only:boolean};
type StoredCard=ReplyCardRow&{channel_message_id:number,channel_ordinal:number|null,addressed_to:string|null};
type StoredSession={message_id:number,agent_id:string,profile:string,session:string,reply:number};
// One handover of the channel (#150) as channel_handovers answers it: both Agents and their faces, the job, what the
// target reported, Lead's reply and when each came. Only what the chat draws; never the context or the Engine's runs.
type StoredHandover={id:number,message:number,from_agent:string,from_name:string,from_connection:string,to_agent:string,to_name:string,
 to_connection:string,goal:string,summary:string|null,reply:string|null,state:string,target_outcome:string|null,created_at:string,answered_at:string|null,closed_at:string|null,no_model?:boolean};
// A channel's replies read their Run's steps from the Agent's Hermes session when the channel opens (#346), never kept.
// `profile` is the one the Run was pinned to; the callback reads the session there.
type ReadSession=(agent:string,session:string,profile:string)=>Promise<{turns:SessionTurn[],usage:SessionUsage|null}|null>;
const shownMessages=200;

const stateOf=(outcome:string|null):MentionState=>outcome===null?'open':outcome==='completed'?'answered':outcome==='no_model'?'noModel':'unanswered';
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
 // Runs first: a Run closed between the two reads then shows its reply too (both are written in one transaction). A
 // message may have up to three Runs (#152), one per Agent it called, in the order the Agents were named.
 const runs=((await db.from('channel_runs').select('message_id,ordinal,agent_id,agent_name,outcome').eq('channel_id',channel).order('message_id',{ascending:false}).order('ordinal').limit(shownMessages*3)).data||[]) as StoredRun[];
 const runsOf=new Map<number,StoredRun[]>();
 for(const run of runs) runsOf.set(run.message_id,[...(runsOf.get(run.message_id)??[]),run]);
 for(const group of runsOf.values()) group.sort((a,b)=>(a.ordinal??1)-(b.ordinal??1));
 const {data:openRuns}=await db.from('channel_runs').select('message_id,ordinal,agent_id').eq('channel_id',channel).is('outcome',null);
 const latest=((await db.from('channel_messages').select('id,author,person_id,agent_id,author_name,body,reply_to,reply_ordinal,hand_card,created_at').eq('channel_id',channel).order('id',{ascending:false}).limit(shownMessages)).data||[]) as StoredMessage[];
 // The quiet lines the channel got (#207). Not messages: nobody writes them, they are never called, and they start no
 // Run. Only the ones inside the messages shown are drawn.
 const notes=((await db.from('channel_notes').select('id,kind,invitee_name,actor_name,created_at').eq('channel_id',channel).order('id',{ascending:false}).limit(shownMessages)).data||[]) as StoredNote[];
 const ordered=[...latest].reverse();
 // The images of the messages shown (#156). The table's own policy shows only this channel's to a Member of it.
 const shown=latest.map(message=>message.id);
 const attached=(shown.length?((await db.from('channel_attachments').select('id,message_id,name').in('message_id',shown).order('position')).data||[]):[]) as StoredFile[];
 const {data:members}=await db.rpc('channel_members',{ch:channel});
 // A team channel's Agents come with it, also one hidden from the reader elsewhere, so its replies keep their face.
 const {data:agents}=await db.rpc('channel_agent_list',{ch:channel});
 // The channel's handovers (#150), newest first: the transcript draws the row, the target's answer and Lead's reply of
 // the ones whose message is shown, and the details draw the count and the last four.
 const {data:handed}=await db.rpc('channel_handovers',{ch:channel});
 // Each Agent's own state (#206): what waits on the reader, and its open Runs. It runs as the reader, so only their own
 // state comes back, and only the state is kept below.
 const {data:states}=await db.rpc('agent_states',{c:company});
 const {data:writer}=await db.rpc('conversation_can_write',{c:company});
 const {data:manager}=await db.rpc('can_manage_company',{target:company});
 const {data:may}=await db.rpc('permission_choices',{c:company});
 // The channel's Card on the board (#151): the one Card a team channel has, the column it stands in now and its line,
 // read only for a Member who sees its Agent. The general channel has none.
 const {data:board}=await db.rpc('channel_board_card',{ch:channel});
 const asked=runs.length?((await db.from('channel_permissions').select('id,message_id,ordinal,title,content,state,decided_at,created_at').eq('channel_id',channel).gte('message_id',runs.at(-1)!.message_id).order('id')).data||[]) as StoredPermission[]:[];
 // A reply's cards (#136, #137, #139) are kept against the message its Run answers, and a question (#149) against the
 // same message, drawn under it before the reply. Every member of the channel reads them.
 const askedIds=ordered.filter(message=>message.author==='person').map(message=>message.id);
 const cards=askedIds.length?((await db.from('reply_cards').select(`${replyCardColumns},channel_message_id,channel_ordinal,addressed_to`).in('channel_message_id',askedIds).order('id')).data||[]) as StoredCard[]:[];
 // Each card under the reply of the Agent whose Run showed it (#152): a message may call up to three. A question is its
 // Agent's turn under the message instead, with the chips flag the database kept for the main Agent's own question.
 const cardsOf=new Map<string,ReplyCard[]>();
 const questionsOf=new Map<string,ChannelQuestion[]>();
 for(const row of cards) {
  const card=replyCardOf(row); if(!card) continue;
  const place=`${row.channel_message_id}:${row.channel_ordinal??1}`;
  if(card.kind==='question') questionsOf.set(place,[...(questionsOf.get(place)??[]),{...card,chips:!!row.addressed_to}]);
  else cardsOf.set(place,[...(cardsOf.get(place)??[]),card]);
 }
 // A reply's steps are its own Hermes turn (#346): each Agent's session, matched to its replies by time, never kept.
 const stepsOf=new Map<number,RunSteps>();
 const replies=ordered.filter(message=>message.author==='agent'&&message.reply_to!==null);
 if(session&&replies.length) {
  // The page asks from the oldest message shown, so its own reply's Run is included: `after` is a message id, exclusive.
  const {data:runsRead}=await db.rpc('channel_run_sessions',{ch:channel,after:(latest.at(-1)?.id??1)-1});
  const runOfReply=new Map(((runsRead||[]) as StoredSession[]).map(row=>[row.reply,row]));
  const groups=new Map<string,{agent:string,profile:string,session:string,replies:StoredMessage[]}>();
  for(const reply of replies) {
   const run=runOfReply.get(reply.id); if(!run) continue;
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
 // A Run open in this channel counts as its Agent working, in addition to the Runs the Agent's own state sees. Runs go
 // one after another (#152), so only the Run being worked on now works: the lowest open place of each message. A second
 // or third Agent still waiting its turn is idle, never "Working".
 const open=((openRuns||[]) as {message_id:number,ordinal:number|null,agent_id:string|null}[]);
 const firstPlace=new Map<number,number>();
 for(const run of open) { const place=run.ordinal??1; firstPlace.set(run.message_id,Math.min(firstPlace.get(run.message_id)??place,place)); }
 const working=new Set(open.filter(run=>(run.ordinal??1)===firstPlace.get(run.message_id)).flatMap(run=>run.agent_id??[]));
 const stateOfAgent=new Map(((states||[]) as {agent:string,running:boolean,waiting_mine:boolean}[]).map(row=>[row.agent,row]));
 // Only who is in a team channel can change it (set_channel_person, set_channel_agent), so only they are named: the
 // Owner first, then the Managers. An invited person is no Member yet, and changes nothing.
 const managers=name.kind==='team'?(['owner','manager'] as const).flatMap(role=>people.filter(member=>!member.invitation&&member.role===role&&member.name).map(member=>({name:member.name,role}))):[];
 const newest=latest[0]?.id;
 const oldest=latest.at(-1)?.created_at;
 // One Agent's turn under a message (#152): its Run's state, the questions that Run asked (#149) and the requests it
 // asked (its own, never a sibling's).
 const mentionOf=(run:StoredRun):ChannelMention=>({agent:run.agent_name,
  face:seen.find(agent=>agent.id===run.agent_id)?.connection_id||run.agent_id||run.agent_name,state:stateOf(run.outcome),
  questions:questionsOf.get(`${run.message_id}:${run.ordinal??1}`)??[],
  permissions:asked.filter(row=>row.message_id===run.message_id&&(row.ordinal??1)===(run.ordinal??1))
   .flatMap(row=>replyCardOf({...row,run_id:'',kind:'permission',answered_at:null,done_at:null})??[]) as ChannelPermission[]});
 const written:[ChannelMessage[],ChannelMessage[]]=[
  ordered.map((message):ChannelMessage=>{
   if(message.author==='agent') return {id:message.id,author:'agent',name:message.author_name,face:seen.find(agent=>agent.id===message.agent_id)?.connection_id||message.agent_id||message.author_name,body:message.body,at:message.created_at,
    ...(stepsOf.has(message.id)?{steps:stepsOf.get(message.id)}:{}),...(message.reply_to!==null&&cardsOf.has(`${message.reply_to}:${message.reply_ordinal??1}`)?{cards:cardsOf.get(`${message.reply_to}:${message.reply_ordinal??1}`)}:{})};
   const mentions=(runsOf.get(message.id)??[]).map(mentionOf);
   return {id:message.id,author:'person',mine:message.person_id===person,name:message.author_name,role:people.find(member=>member.person===message.person_id)?.role??null,body:message.body,at:message.created_at,
    files:attached.filter(file=>file.message_id===message.id).map(file=>({id:file.id,name:file.name})),
    mention:mentions[0]??null,mentions,...(message.hand_card?{handDone:true as const}:{})};
  }),
  notes.filter(note=>oldest===undefined||note.created_at>=oldest).map((note):ChannelMessage=>note.kind==='card'
   ? {id:-note.id,author:'note',kind:'card',at:note.created_at}
   : {id:-note.id,author:'note',kind:'invite',actor:note.actor_name,name:note.invitee_name??'',at:note.created_at}),
 ];
 // #150: a handover is a quiet row under the reply that made it, then the other Agent's answer marked "to <Lead>", then
 // Lead's own reply, all from gtmworks's own record and never from the Engine's helper events (design-reference: the
 // handoff row, `to` on the sender line). Only handovers of the messages shown are drawn, and a completed target's
 // answer and Lead's reply appear as soon as each comes in.
 const shownIds=new Set(ordered.map(message=>message.id));
 const handoverMessages=((handed||[]) as StoredHandover[]).filter(row=>shownIds.has(row.message)).flatMap((row):ChannelMessage[]=>[
  {id:`handover-${row.id}`,author:'handoff',from:{name:row.from_name,face:row.from_connection},to:{name:row.to_name,face:row.to_connection},goal:row.goal,at:row.created_at,
   ...(handoverUnfinished(row)?{failed:true as const}:{}),...(row.no_model?{noModel:true as const}:{})},
  ...(row.summary&&row.answered_at?[{id:`handover-${row.id}-answer`,author:'agent' as const,name:row.to_name,face:row.to_connection,body:row.summary,at:row.answered_at,to:row.from_name}]:[]),
  ...(row.reply&&row.closed_at?[{id:`handover-${row.id}-reply`,author:'agent' as const,name:row.from_name,face:row.from_connection,body:row.reply,at:row.closed_at}]:[]),
 ]);
 // The lines in the order they were written: a note is drawn where it happened, after a message written at the same
 // moment (the sort is stable, and the messages come first), and a handover's row after the reply that made it.
 const messages=[...written.flat(),...handoverMessages].sort((a,b)=>a.at<b.at?-1:a.at>b.at?1:0);
 // Only a channel that shows a no-model failure asks whether the reader owns the Company, for its line's link (#428).
 const noModel=messages.some(message=>message.author==='handoff'?message.noModel===true:message.author==='person'&&(message.mentions??[]).some(mention=>mention.state==='noModel'));
 const {data:owner}=noModel?await db.rpc('is_company_owner',{c:company}):{data:false};
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
  handoffs:((handed||[]) as StoredHandover[]).map(row=>({id:row.id,from:{name:row.from_name,face:row.from_connection},to:{name:row.to_name,face:row.to_connection},goal:row.goal,at:row.created_at,
  ...(handoverUnfinished(row)?{failed:true as const}:{})})),
  open:((openRuns||[]) as {agent_id:string|null}[]).length>0,
  handover:((handed||[]) as StoredHandover[]).some(row=>row.state!=='done'&&row.state!=='failed'),
  may:(may||[]) as PermissionChoice[],
  ...(board?{board:board as ChannelBoard}:{}),
  ...(noModel?{noModel:{owner:owner===true}}:{}),
 };
}

export const firstName=(name:string)=>name.trim().split(/\s+/)[0]||name;

// Marks every Agent name the message called (#152), the longest name first so "@Lead Writer" is one mark and not "@Lead"
// followed by " Writer": the same rule the database's mention_at reads. A name between spaces, punctuation or the ends is
// a call; one inside a longer word or an address is not.
export function withMention(body:string,agents:string[]|string|null|undefined):{text:string,mention:boolean}[] {
 const names=(Array.isArray(agents)?agents:[agents]).flatMap(name=>typeof name==='string'&&name.trim()?[name.trim()]:[]);
 if(!names.length) return [{text:body,mention:false}];
 const escaped=[...names].sort((a,b)=>b.length-a.length).map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 const pattern=new RegExp(`(^|[\\s\\p{P}])@(${escaped.join('|')})(?=$|[\\s\\p{P}])`,'giu');
 const parts:{text:string,mention:boolean}[]=[]; let end=0;
 for(const match of body.matchAll(pattern)) {
  const at=(match.index??0)+match[1].length; const text=match[0].slice(match[1].length);
  if(at>end) parts.push({text:body.slice(end,at),mention:false});
  parts.push({text,mention:true});
  end=at+text.length;
 }
 if(end<body.length) parts.push({text:body.slice(end),mention:false});
 return parts.filter(part=>part.text);
}
