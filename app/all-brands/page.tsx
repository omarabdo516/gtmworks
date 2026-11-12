import { getI18n } from '@/lib/i18n-server';
import Link from '@/lib/link';
import { notFound,redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Shell from '@/app/shell';
import Mfa from '@/app/mfa';
import { approvalQueue } from '@/lib/approval-queue';
function memberCount(count:number, t: import('@/lib/i18n.mjs').I18n['t']) { if(count===0) return t('noMembers'); if(count===1) return t('oneMember'); if(count===2) return t('twoMembers'); if(count%100>=3&&count%100<=10) return t('fewMembers', count); return t('manyMembers', count); }
export default async function AllBrands() { const {t}=await getI18n();
 const db=await supabase(); const {data:{user}}=await db.auth.getUser(); if(!user) redirect('/sign-in?next=%2Fall-brands');
 const {data:person}=await db.from('people').select('name,agency_owner').eq('id',user.id).single(); if(!person?.agency_owner) notFound();
 const {data:aal}=await db.auth.mfa.getAuthenticatorAssuranceLevel(); const {data:factors}=await db.auth.mfa.listFactors();
 const {data:available}=await db.from('companies').select('id,slug,name').order('name'); const current=available?.find(c=>c.slug==='rs-learning') || available?.[0];
 const {data:membership}=current?await db.from('members').select('role,companies!inner(slug)').eq('person_id',user.id).is('removed_at',null).eq('companies.slug',current.slug).maybeSingle():{data:null};
 const queue=current?await approvalQueue(db,current.id,user.id,membership?.role || ''):null;
 const roleNames:Record<string,string>={owner:t('owner'),manager:t('manager'),contributor:t('contributor'),reviewer:t('reviewer'),viewer:t('viewer')};
 const {data:companies}=aal?.currentLevel==='aal2'?await db.from('companies').select('id,slug,name,members(count)').order('name'):{data:[]};
 return <Shell company={current} companies={available || []} section="all-brands" title={t('allCompanies')} personName={person.name} approvalCount={queue?.cards.length || 0} role={roleNames[membership?.role || ''] || t('agencyOwner')} agency><main className="content"><div className="heading"><div><h1>{t('allCompanies')}</h1><p>{t('anOverviewOfCompaniesForTheOwner')}</p></div></div>{aal?.currentLevel!=='aal2'?<Mfa enrolled={!!factors?.totp.length}/>:<div className="cards-grid">{companies?.map(c=><Link className="panel company-card" key={c.id} href={`/c/${c.slug}/home`}><h2 dir="auto">{c.name}</h2><div className="detail-row"><strong>{t('members')}</strong><span>{memberCount(c.members[0]?.count || 0,t)}</span></div><span className="link">{t('openCompany')}</span></Link>)}</div>}</main></Shell>;
}
