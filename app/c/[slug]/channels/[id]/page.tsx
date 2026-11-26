import '../../../../channel.css';
import { notFound, redirect } from 'next/navigation';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import { companyReader } from '@/lib/company-reader';
import Page from '@/app/page-frame';
import { channelSessionTurns } from '@/lib/company-app-items';
import { uuid } from '@/lib/conversations';
import { channelRecord } from '@/lib/channels';
import ChannelView from './channel';
import { ReadFailed } from '@/lib/read-failed';

export default async function ChannelPage({params}:{params:Promise<{slug:string,id:string}>}) {
 const {t}=await getI18n(); const {slug,id}=await params;
 const db=await supabase(); const reader=await companyReader(slug);
 if(!reader) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/channels/${id}`)}`);
 const {user,company}=reader;
 if(!company||!uuid.test(id)) notFound();
 const record=await channelRecord(db,user.id,company.id,id,false,(_agent,session,profile)=>channelSessionTurns(company.id,profile,session));
 if(record==='missing') notFound();
 // A channel that could not be read is the error page with Try again and an error status (#776), never an empty channel.
 if(record==='failed') throw new ReadFailed('channel');
 return <Page title={t('chats')}>
  <main className="convo-page h-full"><ChannelView person={user.id} slug={slug} initial={record}/></main>
 </Page>;
}
