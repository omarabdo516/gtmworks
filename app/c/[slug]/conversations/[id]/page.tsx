import { notFound, redirect } from 'next/navigation';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import Shell from '@/app/shell';
import { approvalQueue } from '@/lib/approval-queue';
import ConversationView from './conversation';
import { conversationColumns, faceOf, latestEnded, messageColumns, shown, titleOf, totalOf, usageColumns, uuid, waiting, type RunUsage } from '@/lib/conversations';

// Only the person who started a conversation can read it; everyone else, in this company or another, gets not found.
export default async function ConversationPage({params}:{params:Promise<{slug:string,id:string}>}) {
 const {t}=await getI18n(); const {slug,id}=await params;
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/conversations/${id}`)}`);
 const {data:companies}=await db.from('companies').select('id,slug,name').order('name'); const company=companies?.find(c=>c.slug===slug);
 if(!company||!uuid.test(id)) notFound();
 const {data:conversation}=await db.from('conversations').select(conversationColumns).eq('id',id).eq('company_id',company.id).maybeSingle();
 if(!conversation) notFound();
 // Usage first: a run the worker closes between the two reads then shows its reply too (one transaction writes both).
 const usage=((await db.from('conversation_usage').select(usageColumns).eq('conversation_id',id)).data||[]) as RunUsage[];
 const {data:rows}=await db.from('conversation_messages').select(messageColumns).eq('conversation_id',id).order('id');
 const {data:person}=await db.from('people').select('name').eq('id',user.id).single();
 const {data:membership}=await db.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).is('removed_at',null).maybeSingle();
 // Any Member but a Viewer may write (#287); the database decides, as it does for every send.
 const {data:writer}=await db.rpc('conversation_can_write',{c:company.id});
 const {cards}=await approvalQueue(db,company.id,user.id,membership?.role||'');
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 const messages=shown(rows||[],usage); const title=titleOf(messages,conversation.agent_name);
 return <Shell company={company} companies={companies||[]} section="conversations" title={title} personName={person?.name||user.email||''} role={roleNames[membership?.role||'']||''} owner={membership?.role==='owner'} approvalCount={cards.length} agentId={conversation.agent_id||undefined} conversationId={id}>
  <main className="convo-page h-full"><ConversationView company={company.id} conversation={{id,agent_name:conversation.agent_name,face:faceOf(conversation)}} initial={messages} usage={totalOf(usage)} failed={latestEnded(rows||[],usage)} pending={waiting(rows||[],usage).length>0} writer={!!writer}/></main>
 </Shell>;
}
