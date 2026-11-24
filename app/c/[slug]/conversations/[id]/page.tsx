import '@/app/channel.css';
import { notFound, redirect } from 'next/navigation';
import { after } from 'next/server';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import Shell, { sidebarReads } from '@/app/shell';
import { approvalQueue } from '@/lib/approval-queue';
import ConversationView, { ConversationLoaded } from './conversation';
import { OpenedHere } from '@/app/sidebar-live';
import { conversationColumns, faceOf, uuid } from '@/lib/conversations';
import { conversationTitle } from '@/lib/conversation-title.mjs';
import { conversationRecord, tiedCard } from '@/lib/conversation-record';
import { agentAppStates, agentSessionTurns } from '@/lib/company-app-items';
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
 const [{t,language},{data:{user}},{data:companies},{data:found}]=await Promise.all([getI18n(),db.auth.getUser(),
  db.from('companies').select('id,slug,name,work_mode').order('name'),
  uuid.test(id)?db.from('conversations').select(`${conversationColumns},company_id,archived_at`).eq('id',id).maybeSingle():{data:null}]);
 if(!user) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/conversations/${id}`)}`);
 const company=companies?.find(c=>c.slug===slug);
 if(!company||!uuid.test(id)) notFound();
 const conversation=found?.company_id===company.id?found:null;
 if(!conversation) notFound();
 markOpen('frame',timing);
 // The sidebar's reads and what waits on this person go out now, beside the page's own: the Shell and the Agent's details
 // find them on their way (app/shell.tsx, lib/approval-queue.ts).
 sidebarReads(company.id).catch(()=>{});
 const waitingCount=approvalQueue(db,company.id,user.id).then(({count})=>count);
 // Each step's time, written once the response has gone (docs/production-logs.md: chat_opened).
 after(()=>logOpen(timing,company.id,id));
 // Messages, notes to a person and waiting turns, with who the Agent is working for (lib/conversation-record.ts). The
 // page is drawn without waiting for it; the chat shows its placeholder until it arrives (#172).
 const readRecord=()=>conversationRecord(db,user.id,company.id,conversation,agent=>agentAppStates(company.id,agent),(agent,session)=>agentSessionTurns(company.id,agent,session).finally(()=>markOpen('session',timing)));
 let record=readRecord();
 // Awaited only by the transcript: a read of the frame that fails first must not leave its failure unhandled.
 record.then(()=>markOpen('record',timing),()=>{});
 // Its Card on the board, in the corner from the start (design-reference: renderChat's corner pill): read beside the
 // frame's other reads, and handled the same way until the frame awaits it.
 const tiedRead=tiedCard(db,company.id,id);
 tiedRead.catch(()=>{});
 // The Agent's details beside the chat, while it is still attached to the company, and the reader's role. The details'
 // reads go out now with them, not after the frame's reads (decision 0042): they are the page's longest, and the page
 // has loaded only once they are drawn.
 const agentRead=conversation.agent_id?db.from('hermes_agents').select(`id,connection_id,name,speciality,is_default,${madeColumns}`).eq('id',conversation.agent_id).eq('company_id',company.id).maybeSingle():Promise.resolve({data:null});
 const membershipRead=db.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).is('removed_at',null).maybeSingle();
 const details=conversation.agent_id?agentDetails(db,{company:company.id,agent:conversation.agent_id,name:Promise.resolve(agentRead).then(({data})=>data?.name??''),slug,me:user.id,role:Promise.resolve(membershipRead).then(({data})=>data?.role||''),tab}).finally(()=>markOpen('details',timing)):null;
 // Handed to the screen only while the Agent is attached; a detached Agent's details are read and dropped.
 details?.catch(()=>{});
 // Until then the chat is named as the sidebar names it (app/shell.tsx): the first line of its first message.
 // The frame's reads go out together: each is one round trip, and on a busy machine a chain of them is what makes the
 // chat slow to open (decision 0042).
 const [{data:first},{data:agent},{data:person},{data:membership},{data:writer}]=await Promise.all([
  db.from('conversation_messages').select('body,conversation_attachments(name)').eq('conversation_id',id).eq('author','person').order('id').limit(1).maybeSingle(),
  agentRead,
  db.from('people').select('name').eq('id',user.id).single(),
  membershipRead,
  // Any Member but a Viewer may write (#287); the database decides, as it does for every send.
  db.rpc('conversation_can_write',{c:company.id}),
 ]);
 markOpen('reads',timing);
 // #434: the Owner's empty Conversation with Lead (first run makes one) is where Lead opens the Company's first
 // Conversation, once the Company has a model (lib/lead-opening.mjs); the record is then read again with its message.
 // Only a Conversation with nothing in it asks, so every other open costs nothing more.
 if(!first&&agent?.is_default&&membership?.role==='owner') {
  const {count}=await db.from('conversation_messages').select('id',{count:'exact',head:true}).eq('conversation_id',id);
  const opened=count===0?await openOnVisit(createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}}),
   {model:companyHasModel(db,{company:company.id}).catch(()=>null),company:company.id,person:user.id,conversation:id,language,owner:person?.name||'',lead:agent.name,companyName:company.name}):null;
  if(opened===id) { record.catch(()=>{}); record=readRecord(); }
 }
 // The Agent's details and the approvals count are handed over unread: the chat and its steps are drawn without waiting
 // for them, and each takes its place when read (decision 0042).
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 const title=conversationTitle({morningDay:conversation.good_morning_day,body:first?.body as string|undefined,file:(first?.conversation_attachments as {name:string}[]|undefined)?.[0]?.name,agent:conversation.agent_name},t,language);
 const tied=await tiedRead;
 return <Shell company={company} companies={companies||[]} personId={user.id} section="conversations" title={title} personName={person?.name||user.email||''} role={roleNames[membership?.role||'']||''} owner={membership?.role==='owner'} approvalCount={waitingCount} agentId={conversation.agent_id||undefined} conversationId={id}>
  {/* Opening the Conversation wakes its Agent and sees a failure there, for this reader (#699). */}
  <OpenedHere company={company.id} agent={conversation.agent_id} place={{conversation:conversation.id}}/>
  <main className="convo-page h-full"><ConversationView slug={slug} agent={agent?{id:agent.id,connection_id:agent.connection_id,name:agent.name,speciality:agent.speciality,main:agent.is_default,made:madeOf(agent,user.id,slug)}:null} details={agent?details:null} tab={pickTab(tab)} company={company.id} conversation={{id:conversation.id,agent_id:conversation.agent_id,agent_name:conversation.agent_name,face:faceOf(conversation)}} title={title} writer={!!writer} board={tied&&{card:tied.card,column:tied.column}} first={firstRun==='alone'||firstRun==='team'?firstRun:undefined} invites={Number.parseInt(invites||'0',10)||0} archived={!!conversation.archived_at}><Loaded record={record} team={company.work_mode==='team'}/></ConversationView></main>
 </Shell>;
}

// The chat once its record is read, streamed in place of the placeholder.
async function Loaded({record,team}:{record:ReturnType<typeof conversationRecord>,team:boolean}) {
 // Everything outside this boundary is drawn by now, so the page's first bytes leave next.
 markOpen('firstByte');
 return <ConversationLoaded initial={await record} team={team}/>;
}
