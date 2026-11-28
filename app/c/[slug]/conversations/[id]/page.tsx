import '@/app/channel.css';
import { notFound, redirect } from 'next/navigation';
import { after } from 'next/server';
import { headers } from 'next/headers';
import { renderKind } from '@/lib/diagnostics.mjs';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import { companyOf, companyReader } from '@/lib/company-reader';
import Page from '@/app/page-frame';
import ConversationView, { ConversationLoaded, ConversationNotRead, EngineLoaded } from './conversation';
import { OpenedHere } from '@/app/sidebar-live';
import { conversationColumns, faceOf, uuid } from '@/lib/conversations';
import { conversationTitle } from '@/lib/conversation-title.mjs';
import { heldSession } from '@/lib/conversation-list';
import { conversationRecord } from '@/lib/conversation-record';
import { conversationSteps, type ConversationSteps } from '@/lib/conversation-steps';
import { agentAppStates } from '@/lib/company-app-items';
import { madeColumns, madeOf } from '@/lib/agent-made';
import { agentDetails } from '@/app/agent-details-server';
import { pickTab } from '@/lib/agent-details.mjs';
import { logOpen, markOpen, startOpen } from '@/lib/chat-open-timing';
import { openOnVisit } from '@/lib/lead-opening.mjs';
import { companyHasModel } from '@/lib/provider-keys.mjs';
import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from '@/lib/supabase-config';

// Only the person who started a conversation can read it; everyone else, in this company or another, gets not found.
// ?tab=<key> opens the Agent's details on that tab.
export default async function ConversationPage({params,searchParams}:{params:Promise<{slug:string,id:string}>,searchParams:Promise<{tab?:string,first?:string,invites?:string}>}) {
 const timing=startOpen(); const {slug,id}=await params; const {tab,first:firstRun,invites}=await searchParams;
 const db=await supabase();
 // The person's own Companies and the Conversation are read beside the sign-in check (RLS reads nothing without one),
 // and the Conversation is then held to the Company in the address.
 const [{t,language},reader,{data:found}]=await Promise.all([getI18n(),companyOf(slug),
  uuid.test(id)?db.from('conversations').select(`${conversationColumns},company_id,archived_at`).eq('id',id).maybeSingle():{data:null}]);
 if(!reader) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/conversations/${id}`)}`);
 const {user,company}=reader;
 if(!company||!uuid.test(id)) notFound();
 const conversation=found?.company_id===company.id?found:null;
 if(!conversation) notFound();
 markOpen('frame',timing);
 // The reader's name and Role go out now, beside the page's own reads (the Company's layout reads the same, lib/company-reader).
 const readerRead=companyReader(slug);
 // Each step's time, written once the response has gone (docs/production-logs.md: chat_opened).
 // Whether it was a person's open, a prefetch or the page drawn again (#762).
 const render=renderKind(await headers(),`/c/${slug}/conversations/${id}`);
 after(()=>logOpen(timing,company.id,id,render));
 // Messages, notes to a person and waiting turns, with who the Agent is working for (lib/conversation-record.ts). The
 // page is drawn without waiting for it; the chat shows its placeholder until it arrives (#172).
 const readRecord=()=>conversationRecord(db,user.id,company.id,conversation,agent=>agentAppStates(company.id,agent));
 let record=readRecord();
 // Awaited only by the transcript: a read of the frame that fails first must not leave its failure unhandled.
 record.then(()=>markOpen('record',timing),()=>{});
 // Each reply's steps and the token use (#766, ADR 0030) go out now beside the record and come down the same response
 // once read, never awaited by the page or the messages: the chat shows them without first waiting for its script and
 // a second request (decision 0042). A read that fails is null, and the replies stay as they are.
 // The Agent's details beside the chat, while it is still attached to the company, and the reader's role. The details'
 // reads go out now with them, not after the frame's reads (decision 0042): they are the page's longest, and the page
 // has loaded only once they are drawn.
 const agentRead=conversation.agent_id?db.from('hermes_agents').select(`id,connection_id,name,speciality,is_default,${madeColumns}`).eq('id',conversation.agent_id).eq('company_id',company.id).maybeSingle():Promise.resolve({data:null});
 const details=conversation.agent_id?agentDetails(db,{company:company.id,agent:conversation.agent_id,name:Promise.resolve(agentRead).then(({data})=>data?.name??''),slug,me:user.id,role:readerRead.then(read=>read?.role||''),tab}).finally(()=>markOpen('details',timing)):null;
 // Handed to the screen only while the Agent is attached; a detached Agent's details are read and dropped.
 details?.catch(()=>{});
 // Until then the chat is named as the sidebar names it (app/shell.tsx): the first line of its first message.
 // The frame's reads go out together: each is one round trip, and on a busy machine a chain of them is what makes the
 // chat slow to open (decision 0042).
 // A first message that still waits for its Run (#764) names the chat as well, with the files sent with it.
 const [{data:stored},{data:waiting},{data:agent},roleRead,{count:storedCount}]=await Promise.all([
  db.from('conversation_messages').select('body,conversation_attachments(name)').eq('conversation_id',id).eq('author','person').order('id').limit(1).maybeSingle(),
  db.from('conversation_queued_turns').select('message,send_key').eq('conversation_id',id).order('queued_at').limit(1).maybeSingle(),
  agentRead,
  // Any Member but a Viewer may write (#287); the database decides, as it does for every send.
  readerRead,
  // The old record's row count: a Conversation it still holds opens as it always has, and the Engine's read (#875) is
  // for one whose messages are the Engine's alone — a Conversation made after this read, as #876 sends them.
  db.from('conversation_messages').select('id',{count:'exact',head:true}).eq('conversation_id',id),
 ]);
 const person=roleRead?.person, role=roleRead?.role||'', writer=!!roleRead?.canWrite;
 // A Conversation whose own record holds nothing and whose Engine session exists reads its messages from the Engine on
 // their own request (#875). One the old record still holds keeps that record until #883 switches it off.
 const engine=!!conversation.hermes_session_id&&storedCount===0&&!waiting;
 const steps=engine?Promise.resolve(null):conversationSteps(db,company.id,conversation).then(read=>read==='notSeen'?null:read,()=>null);
 const waitingFiles=!stored&&waiting?(await db.from('conversation_attachments').select('name').eq('conversation_id',id).eq('send_key',waiting.send_key).order('position').limit(1)).data:null;
 const first=stored??(waiting&&{body:waiting.message,conversation_attachments:waitingFiles??[]});
 markOpen('reads',timing);
 // #434: the Owner's empty Conversation with Lead (first run makes one) is where Lead opens the Company's first
 // Conversation, once the Company has a model (lib/lead-opening.mjs); the record is then read again with its message.
 // Only a Conversation with nothing in it asks, so every other open costs nothing more.
 if(!first&&!conversation.hermes_session_id&&agent?.is_default&&role==='owner') {
  const opened=storedCount===0?await openOnVisit(createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}}),
   {model:companyHasModel(db,{company:company.id}).catch(()=>null),company:company.id,person:user.id,conversation:id,language,owner:person?.name||'',lead:agent.name,companyName:company.name}):null;
  if(opened===id) { record.catch(()=>{}); record=readRecord(); }
 }
 // The Agent's details and the approvals count are handed over unread: the chat and its steps are drawn without waiting
 // for them, and each takes its place when read (decision 0042).
 // The title and the archived mark are the session's own (#881), as the lists' last read of the Engine holds them; a
 // session it holds nothing of yet is named as the old record names it, by its first message.
 const held=conversation.hermes_session_id?heldSession(company.id,conversation.hermes_session_id):null;
 const named=held?.title||held?.preview;
 const sessionTitle=held?.title||(conversation.good_morning_day?null:named);
 const title=sessionTitle||conversationTitle({morningDay:conversation.good_morning_day,body:first?.body as string|undefined,file:(first?.conversation_attachments as {name:string}[]|undefined)?.[0]?.name,agent:conversation.agent_name},t,language);
 const archived=held?held.archived:!!conversation.archived_at;
 return <Page title={t('chats')} agent={conversation.agent_id||undefined}>
  {/* Opening the Conversation wakes its Agent and sees a failure there, for this reader (#699). */}
  <OpenedHere company={company.id} agent={conversation.agent_id} place={{conversation:conversation.id}}/>
  <main className="convo-page h-full"><ConversationView slug={slug} agent={agent?{id:agent.id,connection_id:agent.connection_id,name:agent.name,speciality:agent.speciality,main:agent.is_default,made:madeOf(agent,user.id,slug)}:null} details={agent?details:null} tab={pickTab(tab)} company={company.id} conversation={{id:conversation.id,agent_id:conversation.agent_id,agent_name:conversation.agent_name,face:faceOf(conversation)}} title={title} writer={!!writer} first={firstRun==='alone'||firstRun==='team'?firstRun:undefined} invites={Number.parseInt(invites||'0',10)||0} archived={archived}><Loaded record={record} steps={steps} team={company.work_mode==='team'} engine={engine}/></ConversationView></main>
 </Page>;
}

// The chat once its record is read, streamed in place of the placeholder. A Conversation with an Engine session reads
// its messages from the Engine on their own request (#875); one without reads what the old record holds, as until its
// first send gives it a session. The old record is still read here as that fallback and for the frame's other states;
// #883 switches it off.
async function Loaded({record,steps,team,engine}:{record:ReturnType<typeof conversationRecord>,steps:Promise<ConversationSteps|null>,team:boolean,engine:boolean}) {
 // Everything outside this boundary is drawn by now, so the page's first bytes leave next.
 markOpen('firstByte');
 // A record that could not be read draws its line with "Try again", never an empty Conversation (#768).
 const read=await record.catch(()=>null);
 if(!read) return <ConversationNotRead/>;
 return engine?<EngineLoaded key={read.conversation.id} initial={read} steps={steps} team={team}/>:<ConversationLoaded initial={read} steps={steps} team={team}/>;
}
