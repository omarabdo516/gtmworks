import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import SettingsLayer, { type SettingsQuery } from '@/app/settings-layer';

// Settings reached at their own address (a link, a reload, a sign-in that returns here), over the Company's frame
// (app/c/[slug]/default.tsx). Signing in returns here with the overlay's own state (section, agent, period) kept.
export default async function SettingsAtAddress({params,searchParams}:{params:Promise<{slug:string}>,searchParams:Promise<SettingsQuery>}) {
 const {slug}=await params; const query=await searchParams;
 const {data:{user}}=await (await supabase()).auth.getUser();
 if(!user) { const kept=new URLSearchParams(Object.entries({section:query.section,agent:query.agent,period:query.period}).filter((entry):entry is [string,string]=>typeof entry[1]==='string')).toString();
  redirect(`/sign-in?next=${encodeURIComponent(`/c/${slug}/settings${kept?`?${kept}`:''}`)}`); }
 return <SettingsLayer slug={slug} query={query}/>;
}
