import '../../../../channel.css';
import { notFound, redirect } from 'next/navigation';
import { companyReader } from '@/lib/company-reader';
import { ShellPage } from '@/app/shell-page';
import { approvalQueue } from '@/lib/approval-queue';
import { channelSessionTurns } from '@/lib/company-app-items';
import { uuid } from '@/lib/conversations';
import { channelRecord } from '@/lib/channels';
import ChannelView from './channel';
import { ReadFailed } from '@/lib/read-failed';

export default async function ChannelPage({params}:{params:Promise<{slug:string,id:string}>}) {
 const {slug,id}=await params;
 const reader=await companyReader(slug);
 if(!reader) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/channels/${id}`)}`);
 const {db,user,company,role}=reader;
 if(!company||!uuid.test(id)) notFound();
 const record=await channelRecord(db,user.id,company.id,id,false,(_agent,session,profile)=>channelSessionTurns(company.id,profile,session));
 if(record==='missing') notFound();
 // A channel that could not be read is the error page with Try again and an error status (#776), never an empty channel.
 if(record==='failed') throw new ReadFailed('channel');
 const {count:waitingCount}=await approvalQueue(db,company.id,user.id,role);
 return <><ShellPage approvals={waitingCount}/>
  <main className="convo-page h-full"><ChannelView person={user.id} slug={slug} initial={record}/></main>
 </>;
}
