import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { headers } from 'next/headers';
import { settingsRenderKind } from '@/lib/diagnostics.mjs';
import { logSettingsOpen, markSettingsOpen, startSettingsOpen } from '@/lib/settings-open-timing';
import { signedInUser, supabase } from '@/lib/supabase';
import SettingsOverlay from './settings-overlay';
import { OnSettingsAddress } from './settings-address';
import { companyLooks } from '@/lib/agent-looks';
import { LooksProvider } from '@/lib/agent-looks-client';
import { changeAgentLook, resetAgentLook } from './agent-look-actions';

export type SettingsQuery = Parameters<typeof SettingsOverlay>[0]['query'];

// Settings as a layer of the Company's pages (#612; app/c/[slug]/@settings): the overlay over whatever page the person
// was on, read with their own session. A Company they cannot read draws nothing here: the page says it was not found.
// It is drawn beside the page, outside its Shell, so it reads the Company's looks for its own faces once (#697).
export default async function SettingsLayer({slug,query}:{slug:string,query:SettingsQuery}) {
 const timing=startSettingsOpen();
 const db=await supabase(); const {data:{user}}=await signedInUser();
 // Signed out (a session that ran out while a page stayed open, a link): sign in, then back to these Settings with their
 // own state (section, agent, period) kept.
 if(!user) { const kept=new URLSearchParams(Object.entries({section:query.section,agent:query.agent,period:query.period}).filter((entry):entry is [string,string]=>typeof entry[1]==='string')).toString();
  redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/settings${kept?`?${kept}`:''}`)}`); }
 const {data:company}=await db.from('companies').select('id,slug,name,work_mode').eq('slug',slug).maybeSingle();
 if(!company) return null;
 const [{data:person},{data:membership},looks]=await Promise.all([
  db.from('people').select('name').eq('id',user.id).single(),
  db.from('members').select('role').eq('company_id',company.id).eq('person_id',user.id).is('removed_at',null).maybeSingle(),
  companyLooks(db,company.id),
 ]);
 markSettingsOpen('frame');
 // Each step's time, written once the response has gone (docs/production-logs.md: settings_opened).
 const render=settingsRenderKind(await headers(),slug,query);
 after(()=>logSettingsOpen(timing,company.id,render));
 return <OnSettingsAddress slug={slug}><LooksProvider looks={looks} change={membership?.role==='owner'?{company:company.id,slug,save:changeAgentLook,reset:resetAgentLook}:null}><SettingsOverlay slug={slug} company={company} userId={user.id} role={membership?.role || ''} personName={person?.name || user.email || ''} workMode={company.work_mode} query={query}/></LooksProvider></OnSettingsAddress>;
}
