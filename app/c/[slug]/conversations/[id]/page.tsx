import '@/app/channel.css';
import { notFound, redirect } from 'next/navigation';
import { after } from 'next/server';
import { headers } from 'next/headers';
import { renderKind } from '@/lib/diagnostics.mjs';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import { companyOf, companyReader } from '@/lib/company-reader';
import Page from '@/app/page-frame';
import ConversationView, { EngineLoaded } from './conversation';
import { OpenedHere } from '@/app/sidebar-live';
import { conversationColumns, faceOf, uuid } from '@/lib/conversations';
import { conversationTitle } from '@/lib/conversation-title.mjs';
import { sessionFor } from '@/lib/conversation-list';
import { conversationFrame } from '@/lib/conversation-frame';
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
  uuid.test(id)?db.from('conversations').select(`${conversationColumns},company_id,archived_at,open_runs,unseen_run,lead_opening`).eq('id',id).maybeSingle():{data:null}]);
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
 // The Agent's details beside the chat, while it is still attached to the company, and the reader's role. The details'
 // reads go out now with them, not after the frame's reads (decision 0042): they are the page's longest, and the page
 // has loaded only once they are drawn.
 const agentRead=conversation.agent_id?db.from('hermes_agents').select(`id,connection_id,name,speciality,is_default,${madeColumns}`).eq('id',conversation.agent_id).eq('company_id',company.id).maybeSingle():Promise.resolve({data:null});
 const details=conversation.agent_id?agentDetails(db,{company:company.id,agent:conversation.agent_id,name:Promise.resolve(agentRead).then(({data})=>data?.name??''),slug,me:user.id,role:readerRead.then(read=>read?.role||''),tab}).finally(()=>markOpen('details',timing)):null;
 // Handed to the screen only while the Agent is attached; a detached Agent's details are read and dropped.
 details?.catch(()=>{});
 // The frame's reads go out together: each is one round trip, and on a busy machine a chain of them is what makes the
 // chat slow to open (decision 0042). The session's own title and archived mark (#881), from the lists' memory, else one
 // bounded read of its Agent's list.
 const [{data:agent},roleRead,held]=await Promise.all([
  agentRead,
  // Any Member but a Viewer may write (#287); the database decides, as it does for every send.
  readerRead,
  sessionFor(db,company.id,conversation.agent_id,conversation.hermes_session_id??null).catch(()=>null),
 ]);
 const person=roleRead?.person, role=roleRead?.role||'', writer=!!roleRead?.canWrite;
 markOpen('reads',timing);
 // #434, #882: the Owner's empty Conversation with the main Agent (first run makes one) is where it opens the Company's
 // first Conversation, once the Company has a model (lib/lead-opening.mjs). The opening is no message: the row is marked,
 // and the transcript draws it in the Owner's language. Only a Conversation with no session yet asks, so every other
 // open costs nothing more.
 if(!conversation.hermes_session_id&&!conversation.lead_opening&&agent?.is_default&&role==='owner')
  await openOnVisit(createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}}),
   {model:companyHasModel(db,{company:company.id}).catch(()=>null),company:company.id,person:user.id,conversation:id,language,owner:person?.name||'',lead:agent.name,companyName:company.name});
 // The Agent's details are handed over unread: the chat is drawn without waiting for them, and they take their place
 // when read (decision 0042). The title and the archived mark are the session's own (#881), as the lists' last read of
 // the Engine holds them; a session it holds nothing of yet is named by its Agent, as the lists name it.
 const sessionTitle=held?.title||(conversation.good_morning_day?null:held?.preview);
 const title=sessionTitle||conversationTitle({morningDay:conversation.good_morning_day,agent:conversation.agent_name},t,language);
 const archived=held?held.archived:!!conversation.archived_at;
 return <Page title={t('chats')} agent={conversation.agent_id||undefined}>
  {/* Opening the Conversation wakes its Agent and sees a failure there, for this reader (#699). */}
  <OpenedHere company={company.id} agent={conversation.agent_id} place={{conversation:conversation.id}}/>
  <main className="convo-page h-full"><ConversationView slug={slug} agent={agent?{id:agent.id,connection_id:agent.connection_id,name:agent.name,speciality:agent.speciality,main:agent.is_default,made:madeOf(agent,user.id,slug)}:null} details={agent?details:null} tab={pickTab(tab)} company={company.id} conversation={{id:conversation.id,agent_id:conversation.agent_id,agent_name:conversation.agent_name,face:faceOf(conversation)}} title={title} titled={!!held?.title} writer={!!writer} first={firstRun==='alone'||firstRun==='team'?firstRun:undefined} invites={Number.parseInt(invites||'0',10)||0} archived={archived}><Loaded frame={conversationFrame(conversation)} team={company.work_mode==='team'} open={!!conversation.open_runs?.length||!!conversation.unseen_run} owner={role==='owner'}/></ConversationView></main>
 </Page>;
}

// The chat, drawn from its frame: its messages are its Engine session's, read on their own request (#875), and `open`
// (#876) says its row holds a Run still working, which the chat follows live from the start. The boundary is kept so the
// page's first bytes leave before the transcript's script.
function Loaded({frame,team,open,owner}:{frame:ReturnType<typeof conversationFrame>,team:boolean,open:boolean,owner:boolean}) {
 // Everything outside this boundary is drawn by now, so the page's first bytes leave next.
 markOpen('firstByte');
 return <EngineLoaded key={frame.conversation.id} initial={frame} team={team} open={open} owner={owner}/>;
}
