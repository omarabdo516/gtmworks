import type { supabase } from './supabase';
import type { BoardColumn } from './board-columns.mjs';
import { agentFaceStates, type AgentFaceState } from './agent-face-states';
import type { SessionUsage } from './engine.mjs';
import { isModelCause, modelCauseOf, type ModelCause } from './model-causes';
import { replyShown } from './media-tags.mjs';
import { handoverEnding, messageFiles, replyCardColumns, replyCardOf, saidParts, stepsOfReplies, type PermissionChoice, type ReplyCard, type ReplyCardRow, type RunSteps, type SessionTurn } from './conversations';
import { mustRead, ReadFailed } from './read-failed';

type Database=Awaited<ReturnType<typeof supabase>>;
type MemberRole='owner'|'manager'|'contributor'|'viewer';
// A Run that failed for a cause a retry cannot fix is that cause (lib/model-causes.ts): the Company has no model
// connected at all (#428), or its model call was refused for no credit, a refused key or a missing model (#530), which
// the channel says as a Conversation does (#422, #457), instead of that the Agent could not reply.
type MentionState='open'|'answered'|'unanswered'|'stopped'|ModelCause;
// What the Agent wrote before its question or request in the same message (#647) is drawn above the card, as its words.
type ChannelPermission=Extract<ReplyCard,{kind:'permission'}>&{said?:string};
// One Agent a message called (#152): its Run's state, what that Run asked to be allowed (#165), drawn as the Agent's
// turn under the message, and the questions that Run asked (#149), drawn in that same turn; `face` is the Agent's, for
// that turn. A question whose Agent is the main Agent is the chips card (#143) and only the Member whose message it is
// answers it (`chips`).
export type ChannelQuestion=Extract<ReplyCard,{kind:'question'}>&{chips:boolean,said?:string};
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
// not finish (#375) marks its row `failed`, one its person's Stop ended (#478) `stopped`, and one that ended with no reply
// for a cause a retry cannot fix (#428, #530) also says so under its row (`model`: the cause, and whose leg it was).
// A message may carry images (#156), drawn as chips under it for every Member.
// A file of a channel message (#156), or of an Agent's reply there (#708); an image is drawn as a thumbnail.
type ChannelFile={id:number,name:string,image?:true};
type ChannelFace={name:string,face:string};
export type ChannelMessage=
 | {id:number,author:'person',mine:boolean,name:string,role:MemberRole|null,body:string,at:string,files:ChannelFile[],mention:ChannelMention|null,mentions?:ChannelMention[],handDone?:true}
 | {id:number|string,author:'agent',name:string,face:string,body:string,at:string,to?:string,steps?:RunSteps,cards?:ReplyCard[],files?:ChannelFile[],missed?:string[]}
 | {id:number,author:'note',kind:'invite',actor:string,name:string,at:string}
 | {id:number,author:'note',kind:'card',at:string}
 | {id:string,author:'handoff',from:ChannelFace,to:ChannelFace,goal:string,at:string,failed?:true,stopped?:true,model?:{cause:ModelCause,agent:string}};
// One handover of a channel, as its details draw it: both faces, the Agent handed the work, and the job, newest first,
// and that it did not finish (#375) or was stopped (#478) when so.
export type ChannelHandoff={id:number,from:ChannelFace,to:ChannelFace,goal:string,at:string,failed?:true,stopped?:true};
export type ChannelName={kind:'general'}|{kind:'team',name:string};
export type ChannelSummary=ChannelName&{id:string,unread:number};
// One row of a channel's members. An invited person who has not joined is a row too (#207): no person yet, their name made
// from the email, and the email only for the Owner and the Managers (decision 0043; `channel_members` leaves it out for
// everyone else).
type ChannelMember={person:string|null,name:string,role:MemberRole,invitation:string|null,email:string|null};
// `only`: shown to the reader in this channel and hidden from them everywhere else. `state` is the Agent's own state for
// the reader (#699, agent_face_states), a call in this channel included; never whom that work is for or on what.
export type ChannelAgent={id:string,connection_id:string,name:string,speciality:string,main:boolean,only:boolean,state:AgentFaceState};
// The Card a team channel put on the board (#151): its title, the column it stands in now, the line under it, and
// whether it waits (a review stage or its chat's wait). Read only for a Member who sees its Agent, as the board reads it.
type ChannelBoard={card:number,title:string,column:BoardColumn,line:string,waiting:boolean};
export type ChannelRecord={
 channel:{id:string,company:string}&ChannelName,
 members:ChannelMember[],
 agents:ChannelAgent[],
 writer:boolean,
 // The reader adds and removes people and Agents: an Owner or a Manager, in a current team channel.
 manage:boolean,
 // The reader archives and restores it (#675): an Owner or a Manager, in a team channel; never the general one.
 archive?:boolean,
 // An archived channel (#675): who archived it and when. Its Members read it, and nobody writes in it until it is restored.
 archived?:{by:string,at:string},
 // Who does, named to a reader who cannot (a team channel only).
 managers:{name:string,role:'owner'|'manager'}[],
 messages:ChannelMessage[],
 // The channel's handovers (#150), newest first, for the details' "Handoffs" section and its count.
 handoffs:ChannelHandoff[],
 open:boolean,
 // A handover of this channel is still moving, so the channel asks again as it does while a Run is open.
 handover:boolean,
 // The message the reader's Stop ends (#478): their newest with a Run or a handover still open, or any Member's for a
 // Manager or Owner, with the Agent working on it for the stop square's label. Absent when they have nothing to stop.
 stop?:{message:number,agent:string},
 // The choices the reader's role may send on a request of their own (permission_choices, #163).
 may:PermissionChoice[],
 // The channel's Card on the board (#151), when it has one the reader may see; absent otherwise.
 board?:ChannelBoard,
 // A Run or a handover shown failed for a cause a retry cannot fix (#428, #530): the Owner gets the link to
 // Subscription and models, a Member is told to ask the Owner. Absent otherwise.
 modelLine?:{owner:boolean},
};
type StoredMessage={id:number,author:'person'|'agent',person_id:string|null,agent_id:string|null,author_name:string,body:string,reply_to:number|null,reply_ordinal:number|null,hand_card:number|null,created_at:string,missed_files?:string[]|null};
type StoredNote={id:number,kind:'invite'|'card',invitee_name:string|null,actor_name:string,created_at:string};
type StoredRun={message_id:number,ordinal:number|null,agent_id:string|null,kept_agent_id?:string|null,agent_name:string,outcome:string|null};
type StoredPermission={id:number,message_id:number,ordinal:number|null,title:string,content:unknown,state:string,decided_at:string|null,created_at:string,said_before?:string|null};
type StoredFile={id:number,message_id:number,name:string,content_type?:string};
type StoredAgent={id:string,connection_id:string,name:string,speciality:string,main:boolean,here_only:boolean};
type StoredCard=ReplyCardRow&{channel_message_id:number,channel_ordinal:number|null,addressed_to:string|null};
type StoredSession={message_id:number,agent_id:string,profile:string,session:string,reply:number};
// One handover of the channel (#150) as channel_handovers answers it: both Agents and their faces, the job, what the
// target reported, Lead's reply and when each came. Only what the chat draws; never the context or the Engine's runs.
export type StoredHandover={id:number,message:number,from_agent:string,from_name:string,from_connection:string,to_agent:string,to_name:string,
 to_connection:string,goal:string,summary:string|null,reply:string|null,state:string,target_outcome:string|null,created_at:string,answered_at:string|null,closed_at:string|null,stopped?:boolean,model_end?:string|null,model_agent?:string|null};
// The lines each handover adds to the transcript (#150, #476): its row, the asked Agent's answer once it came, and the
// asking Agent's reply once it came. A chain (#477) adds each of its steps the same way, a step handed on having no reply
// of its own: its answer is the Agent's that asked it, whose own answer follows.
const handoverModel=(row:StoredHandover)=>{ const cause=modelCauseOf(row.model_end); return cause?{model:{cause,agent:row.model_agent??row.to_name}}:{}; };
// A handover's words keep no file of their own (#708): a tag in them is named as a file not attached, never shown.
export const handoverLines=(rows:StoredHandover[]):ChannelMessage[]=>rows.flatMap((row):ChannelMessage[]=>[
 {id:`handover-${row.id}`,author:'handoff',from:{name:row.from_name,face:row.from_agent},to:{name:row.to_name,face:row.to_agent},goal:row.goal,at:row.created_at,
  ...handoverEnding(row),...handoverModel(row)},
 ...(row.summary&&row.answered_at?[{id:`handover-${row.id}-answer`,author:'agent' as const,name:row.to_name,face:row.to_agent,...replyShown(row.summary),at:row.answered_at,to:row.from_name}]:[]),
 ...(row.reply&&row.closed_at?[{id:`handover-${row.id}-reply`,author:'agent' as const,name:row.from_name,face:row.from_agent,...replyShown(row.reply),at:row.closed_at}]:[]),
]);
// The lines in the order they were written: a note is drawn where it happened, after a message written at the same
// moment (the sort is stable, and the messages come first), and a handover's row after the reply that made it.
export const inWrittenOrder=(lines:ChannelMessage[]):ChannelMessage[]=>[...lines].sort((a,b)=>a.at<b.at?-1:a.at>b.at?1:0);
// A channel's replies read their Run's steps from the Agent's Hermes session when the channel opens (#346), never kept.
// `profile` is the one the Run was pinned to; the callback reads the session there.
type ReadSession=(agent:string,session:string,profile:string)=>Promise<{turns:SessionTurn[],usage:SessionUsage|null}|null>;
const shownMessages=200;

// A Run its person stopped (#478) is no Run that could not reply: the message says nothing more of it, as a Conversation's.
const stateOf=(outcome:string|null):MentionState=>outcome===null?'open':outcome==='completed'?'answered':outcome==='stopped'?'stopped':modelCauseOf(outcome)??'unanswered';
// A channel row as its name: a team channel's own name, and the general channel (or a team one with no name) its word.
export const channelNameOf=(row:{kind:string,name:string|null}):ChannelName=>row.kind==='team'&&row.name?{kind:'team',name:row.name}:{kind:'general'};
export const channelTitle=(t:(key:string)=>string,channel:ChannelName)=>channel.kind==='team'?channel.name:t('shellGeneralChannel');

// A failed read throws ReadFailed (#776): the sidebar keeps the channels it shows, never an empty list.
export async function channelSidebar(db:Database,company:string):Promise<ChannelSummary[]> {
 const data=mustRead(await db.rpc('channel_sidebar',{c:company}),'channel sidebar');
 return ((data||[]) as {id:string,kind:string,name:string|null,unread:number}[]).map(row=>({...channelNameOf(row),id:row.id,unread:row.unread}));
}

// With `read`, the reader has read every message it returns. Only the open channel asks for that: a page render can be
// a link's prefetch, which nobody saw. `session` reads an Agent's Hermes session for its replies' steps (#148), as a
// Conversation's record does (#346).
// A channel the reader does not see is 'missing'; one whose read failed (any of its reads) is 'failed' (#776), never an
// empty or view-only channel, so the page and the route answer it as an error and the browser keeps what it shows.
export async function channelRecord(db:Database,person:string,company:string,channel:string,read=false,session?:ReadSession):Promise<ChannelRecord|'missing'|'failed'> {
 try { return await readChannel(db,person,company,channel,read,session); }
 catch(error) { if(error instanceof ReadFailed) return 'failed'; throw error; }
}
async function readChannel(db:Database,person:string,company:string,channel:string,read:boolean,session?:ReadSession):Promise<ChannelRecord|'missing'> {
 const found=mustRead(await db.from('channels').select('id,company_id,kind,name,archived_at,archived_by').eq('id',channel).eq('company_id',company).maybeSingle(),'channel');
 if(!found) return 'missing';
 const name=channelNameOf(found);
 // Runs first: a Run closed between the two reads then shows its reply too (both are written in one transaction). A
 // message may have up to three Runs (#152), one per Agent it called, in the order the Agents were named.
 const runs=(mustRead(await db.from('channel_runs').select('message_id,ordinal,agent_id,kept_agent_id,agent_name,outcome').eq('channel_id',channel).order('message_id',{ascending:false}).order('ordinal').limit(shownMessages*3),'channel runs')||[]) as StoredRun[];
 const runsOf=new Map<number,StoredRun[]>();
 for(const run of runs) runsOf.set(run.message_id,[...(runsOf.get(run.message_id)??[]),run]);
 for(const group of runsOf.values()) group.sort((a,b)=>(a.ordinal??1)-(b.ordinal??1));
 const openRuns=mustRead(await db.from('channel_runs').select('message_id,ordinal,agent_id').eq('channel_id',channel).is('outcome',null),'open runs');
 const latest=(mustRead(await db.from('channel_messages').select('id,author,person_id,agent_id,author_name,body,reply_to,reply_ordinal,hand_card,created_at,missed_files').eq('channel_id',channel).order('id',{ascending:false}).limit(shownMessages),'channel messages')||[]) as StoredMessage[];
 // The quiet lines the channel got (#207). Not messages: nobody writes them, they are never called, and they start no
 // Run. Only the ones inside the messages shown are drawn.
 const notes=(mustRead(await db.from('channel_notes').select('id,kind,invitee_name,actor_name,created_at').eq('channel_id',channel).order('id',{ascending:false}).limit(shownMessages),'channel notes')||[]) as StoredNote[];
 const ordered=[...latest].reverse();
 // The images of the messages shown (#156). The table's own policy shows only this channel's to a Member of it.
 const shown=latest.map(message=>message.id);
 const attached=(shown.length?(mustRead(await db.from('channel_attachments').select('id,message_id,name,content_type').in('message_id',shown).order('position'),'channel files')||[]):[]) as StoredFile[];
 const members=mustRead(await db.rpc('channel_members',{ch:channel}),'channel members');
 // A team channel's Agents come with it, also one hidden from the reader elsewhere, so its replies keep their face.
 const agents=mustRead(await db.rpc('channel_agent_list',{ch:channel}),'channel agents');
 // The channel's handovers (#150), newest first: the transcript draws the row, the target's answer and Lead's reply of
 // the ones whose message is shown, and the details draw the count and the last four.
 const handed=mustRead(await db.rpc('channel_handovers',{ch:channel}),'channel handovers');
 // Each Agent's own state (#699): the one state read, as the reader, so only their own state comes back, and only the
 // state is kept below. An Agent's turn behind another's on a message is not working yet (#152), there too.
 const faces=await agentFaceStates(db,company);
 const canWrite=mustRead(await db.rpc('conversation_can_write',{c:company}),'whether the reader writes');
 // Nobody writes in an archived channel (#675): the database refuses a message there too.
 const writer=!!canWrite&&!found.archived_at;
 const manager=mustRead(await db.rpc('can_manage_company',{target:company}),'whether the reader manages');
 const may=mustRead(await db.rpc('permission_choices',{c:company}),'permission choices');
 // What the reader's Stop ends now (#478), on stop_channel_message's own rule.
 const stoppable=mustRead(await db.rpc('channel_stoppable',{ch:channel}),'what Stop ends');
 const stop=((stoppable||[]) as {message:number,agent_name:string|null}[])[0];
 // The channel's Card on the board (#151): the one Card a team channel has, the column it stands in now and its line,
 // read only for a Member who sees its Agent. The general channel has none.
 const board=mustRead(await db.rpc('channel_board_card',{ch:channel}),'channel card');
 const asked=runs.length?(mustRead(await db.from('channel_permissions').select('id,message_id,ordinal,title,content,state,decided_at,created_at,said_before').eq('channel_id',channel).gte('message_id',runs.at(-1)!.message_id).order('id'),'channel requests')||[]) as StoredPermission[]:[];
 // A reply's cards (#136, #137, #139) are kept against the message its Run answers, and a question (#149) against the
 // same message, drawn under it before the reply. Every member of the channel reads them.
 const askedIds=ordered.filter(message=>message.author==='person').map(message=>message.id);
 const cards=askedIds.length?(mustRead(await db.from('reply_cards').select(`${replyCardColumns},channel_message_id,channel_ordinal,addressed_to`).in('channel_message_id',askedIds).order('id'),'channel cards')||[]) as StoredCard[]:[];
 // Each card under the reply of the Agent whose Run showed it (#152): a message may call up to three. A question is its
 // Agent's turn under the message instead, with the chips flag the database kept for the main Agent's own question.
 const cardsOf=new Map<string,ReplyCard[]>();
 const questionsOf=new Map<string,ChannelQuestion[]>();
 for(const row of cards) {
  const card=replyCardOf(row); if(!card) continue;
  const place=`${row.channel_message_id}:${row.channel_ordinal??1}`;
  if(card.kind==='question') questionsOf.set(place,[...(questionsOf.get(place)??[]),{...card,chips:!!row.addressed_to,...saidParts(row)}]);
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
 // Only who is in a team channel can change it (set_channel_person, set_channel_agent), so only they are named: the
 // Owner first, then the Managers. An invited person is no Member yet, and changes nothing.
 const managers=name.kind==='team'?(['owner','manager'] as const).flatMap(role=>people.filter(member=>!member.invitation&&member.role===role&&member.name).map(member=>({name:member.name,role}))):[];
 const newest=latest[0]?.id;
 const oldest=latest.at(-1)?.created_at;
 // One Agent's turn under a message (#152): its Run's state, the questions that Run asked (#149) and the requests it
 // asked (its own, never a sibling's).
 const mentionOf=(run:StoredRun):ChannelMention=>({agent:run.agent_name,
  // A call keeps the Agent it called when that Agent is removed (#702), and so its face.
  face:run.agent_id||run.kept_agent_id||'',state:stateOf(run.outcome),
  questions:questionsOf.get(`${run.message_id}:${run.ordinal??1}`)??[],
  permissions:asked.filter(row=>row.message_id===run.message_id&&(row.ordinal??1)===(run.ordinal??1))
   .flatMap(row=>{ const card=replyCardOf({...row,run_id:'',kind:'permission',answered_at:null,done_at:null}); return card?[{...card,...saidParts(row)}]:[]; }) as ChannelPermission[]});
 const written:[ChannelMessage[],ChannelMessage[]]=[
  ordered.map((message):ChannelMessage=>{
   // An Agent's reply carries the files it handed over and names the ones it could not (#708); no tag is shown.
   if(message.author==='agent') { const files=messageFiles(attached.filter(file=>file.message_id===message.id));
    return {id:message.id,author:'agent',name:message.author_name,face:message.agent_id||'',...replyShown(message.body,message.missed_files),at:message.created_at,
    ...(files.length?{files}:{}),
    ...(stepsOf.has(message.id)?{steps:stepsOf.get(message.id)}:{}),...(message.reply_to!==null&&cardsOf.has(`${message.reply_to}:${message.reply_ordinal??1}`)?{cards:cardsOf.get(`${message.reply_to}:${message.reply_ordinal??1}`)}:{})}; }
   const mentions=(runsOf.get(message.id)??[]).map(mentionOf);
   return {id:message.id,author:'person',mine:message.person_id===person,name:message.author_name,role:people.find(member=>member.person===message.person_id)?.role??null,body:message.body,at:message.created_at,
    files:messageFiles(attached.filter(file=>file.message_id===message.id)),
    mention:mentions[0]??null,mentions,...(message.hand_card?{handDone:true as const}:{})};
  }),
  notes.filter(note=>oldest===undefined||note.created_at>=oldest).map((note):ChannelMessage=>note.kind==='card'
   ? {id:-note.id,author:'note',kind:'card',at:note.created_at}
   : {id:-note.id,author:'note',kind:'invite',actor:note.actor_name,name:note.invitee_name??'',at:note.created_at}),
 ];
 // #150, #476: a handover is a quiet row "{asking Agent} asked {asked Agent}" under the reply that made it, then the
 // asked Agent's answer marked "to {asking Agent}" (an Agent outside the channel too, with its own name and face), then
 // the asking Agent's own reply, all from gtmworks's own record and never from the Engine's helper events
 // (design-reference: the handoff row, `to` on the sender line). Only handovers of the messages shown are drawn, and a
 // completed asked Agent's answer and the asking Agent's reply appear as soon as each comes in.
 const shownIds=new Set(ordered.map(message=>message.id));
 const messages=inWrittenOrder([...written.flat(),...handoverLines(((handed||[]) as StoredHandover[]).filter(row=>shownIds.has(row.message)))]);
 // Only a channel that shows a model failure asks whether the reader owns the Company, for its line's link (#428, #530).
 const modelLine=messages.some(message=>message.author==='handoff'?!!message.model:message.author==='person'&&(message.mentions??[]).some(mention=>isModelCause(mention.state)));
 const owner=modelLine?mustRead(await db.rpc('is_company_owner',{c:company}),'whether the reader owns'):false;
 if(read&&newest!==undefined) await db.rpc('read_channel',{ch:channel,through:newest});
 return {
  channel:{id:found.id,company:found.company_id,...name},
  members:people,
  agents:seen.map(agent=>({id:agent.id,connection_id:agent.connection_id,name:agent.name,speciality:agent.speciality,main:agent.main,only:agent.here_only,
   state:faces.of(agent.id).state})),
  writer,
  manage:!!manager&&name.kind==='team'&&!found.archived_at,
  archive:!!manager&&name.kind==='team',
  ...(found.archived_at?{archived:{at:found.archived_at as string,by:people.find(member=>member.person===found.archived_by)?.name??''}}:{}),
  managers,
  messages,
  handoffs:((handed||[]) as StoredHandover[]).map(row=>({id:row.id,from:{name:row.from_name,face:row.from_agent},to:{name:row.to_name,face:row.to_agent},goal:row.goal,at:row.created_at,
  ...handoverEnding(row)})),
  open:((openRuns||[]) as {agent_id:string|null}[]).length>0,
  handover:((handed||[]) as StoredHandover[]).some(row=>row.state!=='done'&&row.state!=='failed'),
  ...(stop?{stop:{message:stop.message,agent:stop.agent_name??''}}:{}),
  may:(may||[]) as PermissionChoice[],
  ...(board?{board:board as ChannelBoard}:{}),
  ...(modelLine?{modelLine:{owner:owner===true}}:{}),
 };
}

export const firstName=(name:string)=>name.trim().split(/\s+/)[0]||name;
// Whom a channel's composer calls (#154, #700), on its page and in a Card's sheet alike: the channel's own Agents and its
// other Members who have joined, never the reader or an Agent of the Company outside the channel.
export const channelCallable=(record:Pick<ChannelRecord,'members'|'agents'>,reader:string)=>({
 people:record.members.flatMap(member=>member.person&&member.person!==reader?[{id:member.person,name:member.name,role:member.role}]:[]),
 agents:record.agents,
});

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
