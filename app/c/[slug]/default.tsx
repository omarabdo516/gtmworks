import { notFound } from 'next/navigation';
import { getI18n } from '@/lib/i18n-server';
import { supabase } from '@/lib/supabase';
import { sections } from '@/lib/navigation';
import Shell from '@/app/shell';

// Settings at their own address (#612): the Company's frame, inert, under the overlay the `settings` slot draws over it
// (app/c/[slug]/@settings/settings). It is the page slot's default, not a page: a page here would be fetched again at its
// Settings address on every refresh, and that address now opens the overlay over a page, not this frame. Signed out, it
// draws nothing; the slot sends the person to sign in.
export default async function SettingsFrame({params}:{params:Promise<{slug:string}>}) {
 const {t}=await getI18n(); const {slug}=await params;
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return null;
 const {data:companies}=await db.from('companies').select('id,slug,name,work_mode').order('name'); const company=companies?.find(c=>c.slug===slug);
 if(!company) notFound();
 const [{data:person},{data:membership}]=await Promise.all([
  db.from('people').select('name').eq('id',user.id).single(),
  db.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).is('removed_at',null).maybeSingle(),
 ]);
 const roleName=(({owner:t('owner'),manager:t('manager'),contributor:t('contributor'),viewer:t('viewer')}) as Record<string,string>)[String(membership?.role || '')]||'';
 return <div className="contents" inert><Shell company={company} companies={companies || []} personId={user.id} section="settings" title={t(sections.settings)} personName={person?.name || user.email || ''} role={roleName} owner={membership?.role==='owner'}><main className="content"/></Shell></div>;
}
