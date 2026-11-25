import '@/app/board.css';
import '@/app/channel.css';
import '@/app/all-conversations.css';
import { notFound, redirect } from 'next/navigation';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import Shell, { sidebarReads } from '@/app/shell';
import { approvalQueue } from '@/lib/approval-queue';
import { conversationCounts, conversationPage, type ConversationTab } from '@/lib/all-conversations';
import AllConversations from './all-conversations';
import { mustRead } from '@/lib/read-failed';

// All conversations (#673; design-reference-card: renderConvos): every Conversation of the signed-in person in this
// Company and the channels they are in, newest message first, Current or Archived (?tab=archived), a page at a time.
export default async function AllConversationsPage({params,searchParams}:{params:Promise<{slug:string}>,searchParams:Promise<{tab?:string}>}) {
 const {slug}=await params; const {tab:asked}=await searchParams;
 const tab:ConversationTab=asked==='archived'?'archived':'current';
 const db=await supabase();
 const [{t,language},{data:{user}},companiesRead]=await Promise.all([getI18n(),db.auth.getUser(),db.from('companies').select('id,slug,name').order('name')]);
 const companies=mustRead(companiesRead,'companies');
 if(!user) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/conversations${tab==='archived'?'?tab=archived':''}`)}`);
 const company=companies?.find(c=>c.slug===slug);
 if(!company) notFound();
 sidebarReads(company.id).catch(()=>{});
 const [{data:person},membershipRead,first,counts]=await Promise.all([
  db.from('people').select('name').eq('id',user.id).single(),
  db.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).is('removed_at',null).maybeSingle(),
  conversationPage(db,company.id,{tab},t,language),
  conversationCounts(db,company.id),
 ]);
 const membership=mustRead(membershipRead,'membership');
 if(!membership) notFound();
 const {count:waitingCount}=await approvalQueue(db,company.id,user.id,membership.role);
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 return <Shell company={company} companies={companies||[]} personId={user.id} section="all-conversations" title={t('allConversations')} personName={person?.name||user.email||''} role={roleNames[membership.role]||''} owner={membership.role==='owner'} approvalCount={waitingCount}>
  <main className="board-view board-view--page all-convos h-full"><AllConversations key={tab} slug={slug} company={company.id} tab={tab} counts={counts} first={first}/></main>
 </Shell>;
}
