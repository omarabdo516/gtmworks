import { notFound, redirect } from 'next/navigation';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import Shell from '@/app/shell';
import { approvalQueue } from '@/lib/approval-queue';
import ConversationView, { ConversationLoaded } from './conversation';
import { conversationColumns, faceOf, uuid } from '@/lib/conversations';
import { conversationRecord, tiedCard } from '@/lib/conversation-record';
import { agentAppStates } from '@/lib/company-app-items';
import { madeColumns, madeOf } from '@/lib/agent-made';
import { agentDetails } from '@/app/agent-details-server';

// Only the person who started a conversation can read it; everyone else, in this company or another, gets not found.
// ?tab=<key> opens the Agent's details on that tab.
export default async function ConversationPage({params,searchParams}:{params:Promise<{slug:string,id:string}>,searchParams:Promise<{tab?:string}>}) {
 const {t}=await getI18n(); const {slug,id}=await params; const {tab}=await searchParams;
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/conversations/${id}`)}`);
 const {data:companies}=await db.from('companies').select('id,slug,name,work_mode').order('name'); const company=companies?.find(c=>c.slug===slug);
 if(!company||!uuid.test(id)) notFound();
 const {data:conversation}=await db.from('conversations').select(conversationColumns).eq('id',id).eq('company_id',company.id).maybeSingle();
 if(!conversation) notFound();
 // Messages, notes to a person and waiting turns, with who the Agent is working for (lib/conversation-record.ts). The
 // page is drawn without waiting for it; the chat shows its placeholder until it arrives (#172).
 const record=conversationRecord(db,user.id,company.id,conversation,agent=>agentAppStates(company.id,agent));
 // Awaited only by the transcript: a read of the frame that fails first must not leave its failure unhandled.
 record.catch(()=>{});
 // Its Card on the board, in the corner from the start (design-reference: renderChat's corner pill): read beside the
 // frame's other reads, and handled the same way until the frame awaits it.
 const tiedRead=tiedCard(db,company.id,id);
 tiedRead.catch(()=>{});
 // Until then the chat is named as the sidebar names it (app/shell.tsx): the first line of its first message.
 const {data:first}=await db.from('conversation_messages').select('body').eq('conversation_id',id).eq('author','person').order('id').limit(1).maybeSingle();
 // The Agent's details beside the chat, while it is still attached to the company.
 const {data:agent}=conversation.agent_id?await db.from('hermes_agents').select(`id,connection_id,name,speciality,is_default,${madeColumns}`).eq('id',conversation.agent_id).eq('company_id',company.id).maybeSingle():{data:null};
 const {data:person}=await db.from('people').select('name').eq('id',user.id).single();
 const {data:membership}=await db.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).is('removed_at',null).maybeSingle();
 // Any Member but a Viewer may write (#287); the database decides, as it does for every send.
 const {data:writer}=await db.rpc('conversation_can_write',{c:company.id});
 const {count:waitingCount}=await approvalQueue(db,company.id,user.id,membership?.role||'');
 const details=agent?await agentDetails(db,{company:company.id,agent:agent.id,name:agent.name,slug,me:user.id,role:membership?.role||'',tab}):null;
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 const title=(first?.body as string|undefined)?.split('\n')[0]||conversation.agent_name;
 const tied=await tiedRead;
 return <Shell company={company} companies={companies||[]} personId={user.id} section="conversations" title={title} personName={person?.name||user.email||''} role={roleNames[membership?.role||'']||''} owner={membership?.role==='owner'} approvalCount={waitingCount} agentId={conversation.agent_id||undefined} conversationId={id}>
  <main className="convo-page h-full"><ConversationView slug={slug} agent={agent?{id:agent.id,connection_id:agent.connection_id,name:agent.name,speciality:agent.speciality,main:agent.is_default,made:madeOf(agent,user.id,slug)}:null} details={details} company={company.id} conversation={{id:conversation.id,agent_id:conversation.agent_id,agent_name:conversation.agent_name,face:faceOf(conversation)}} title={title} writer={!!writer} board={tied&&{card:tied.card,column:tied.column}}><Loaded record={record} team={company.work_mode==='team'}/></ConversationView></main>
 </Shell>;
}

// The chat once its record is read, streamed in place of the placeholder.
async function Loaded({record,team}:{record:ReturnType<typeof conversationRecord>,team:boolean}) {
 return <ConversationLoaded initial={await record} team={team}/>;
}
