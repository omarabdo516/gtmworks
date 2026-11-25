import '../../../../channel.css';
import { notFound, redirect } from 'next/navigation';
import { getI18n } from '@/lib/i18n-server';
import { signedInUser, supabase } from '@/lib/supabase';
import Shell from '@/app/shell';
import { approvalQueue } from '@/lib/approval-queue';
import { channelSessionTurns } from '@/lib/company-app-items';
import { uuid } from '@/lib/conversations';
import { channelRecord, channelTitle } from '@/lib/channels';
import ChannelView from './channel';

export default async function ChannelPage({params}:{params:Promise<{slug:string,id:string}>}) {
 const {t}=await getI18n(); const {slug,id}=await params;
 const db=await supabase(); const {data:{user}}=await signedInUser();
 if(!user) redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/channels/${id}`)}`);
 const {data:companies}=await db.from('companies').select('id,slug,name').order('name'); const company=companies?.find(c=>c.slug===slug);
 if(!company||!uuid.test(id)) notFound();
 const record=await channelRecord(db,user.id,company.id,id,false,(_agent,session,profile)=>channelSessionTurns(company.id,profile,session));
 if(!record) notFound();
 const {data:person}=await db.from('people').select('name').eq('id',user.id).single();
 const {data:membership}=await db.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).is('removed_at',null).maybeSingle();
 const {count:waitingCount}=await approvalQueue(db,company.id,user.id,membership?.role||'');
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')};
 return <Shell company={company} companies={companies||[]} personId={user.id} section="channels" title={channelTitle(t,record.channel)} personName={person?.name||user.email||''} role={roleNames[membership?.role||'']||''} owner={membership?.role==='owner'} approvalCount={waitingCount} channelId={id}>
  <main className="convo-page h-full"><ChannelView person={user.id} slug={slug} initial={record}/></main>
 </Shell>;
}
