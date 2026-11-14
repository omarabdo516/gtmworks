import { notFound, redirect } from 'next/navigation';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import Shell from '@/app/shell';
import { approvalQueue } from '@/lib/approval-queue';
import { uuid } from '@/lib/conversations';
import AgentChat from './agent-chat';

// Opening an Agent: its empty Conversation (design-reference: emptyChatHTML). Without an id it is the main Agent, Lead.
// The first message starts the Conversation and the page moves to it.
export default async function AgentChatPage({params}:{params:Promise<{slug:string,agent?:string[]}>}) {
 const {t}=await getI18n(); const {slug,agent:parts}=await params;
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/chat${parts?.length?`/${parts.join('/')}`:''}`)}`);
 const {data:companies}=await db.from('companies').select('id,slug,name').order('name'); const company=companies?.find(c=>c.slug===slug);
 if(!company||(parts&&(parts.length!==1||!uuid.test(parts[0])))) notFound();
 const {data:agents}=await db.from('hermes_agents').select('id,connection_id,name,speciality,is_default').eq('company_id',company.id);
 const agent=parts?agents?.find(a=>a.id===parts[0]):agents?.find(a=>a.is_default)||agents?.[0];
 if(parts&&!agent) notFound();
 const {data:person}=await db.from('people').select('name').eq('id',user.id).single();
 const {data:membership}=await db.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).is('removed_at',null).maybeSingle();
 // Any Member but a Viewer may write (#287); the database decides, as it does for every send.
 const {data:writer}=await db.rpc('conversation_can_write',{c:company.id});
 const {items:waitingItems}=await approvalQueue(db,company.id,user.id,membership?.role||'');
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 return <Shell company={company} companies={companies||[]} section="chat" title={t('chats')} personName={person?.name||user.email||''} role={roleNames[membership?.role||'']||''} owner={membership?.role==='owner'} approvalCount={waitingItems.length} agentId={agent?.id}>
  <main className="convo-page h-full"><AgentChat slug={slug} company={company.id} agent={agent?{id:agent.id,connection_id:agent.connection_id,name:agent.name,speciality:agent.speciality,main:agent.is_default}:null} writer={!!writer}/></main>
 </Shell>;
}
