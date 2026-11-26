import '@/app/board.css';
import '@/app/channel.css';
import '@/app/all-conversations.css';
import { notFound, redirect } from 'next/navigation';
import { getI18n } from '@/lib/i18n-server';
import { companyReader } from '@/lib/company-reader';
import { ShellPage } from '@/app/shell-page';
import { approvalQueue } from '@/lib/approval-queue';
import { conversationCounts, conversationPage, type ConversationTab } from '@/lib/all-conversations';
import AllConversations from './all-conversations';

// All conversations (#673; design-reference-card: renderConvos): every Conversation of the signed-in person in this
// Company and the channels they are in, newest message first, Current or Archived (?tab=archived), a page at a time.
export default async function AllConversationsPage({params,searchParams}:{params:Promise<{slug:string}>,searchParams:Promise<{tab?:string}>}) {
 const {slug}=await params; const {tab:asked}=await searchParams;
 const tab:ConversationTab=asked==='archived'?'archived':'current';
 const [{t,language},reader]=await Promise.all([getI18n(),companyReader(slug)]);
 if(!reader) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/conversations${tab==='archived'?'?tab=archived':''}`)}`);
 const {db,user,company,role}=reader;
 if(!company||!role) notFound();
 const [first,counts,{count:waitingCount}]=await Promise.all([
  conversationPage(db,company.id,{tab},t,language),
  conversationCounts(db,company.id),
  approvalQueue(db,company.id,user.id,role),
 ]);
 return <><ShellPage approvals={waitingCount}/>
  <main className="board-view board-view--page all-convos h-full"><AllConversations key={tab} slug={slug} company={company.id} tab={tab} counts={counts} first={first}/></main>
 </>;
}
