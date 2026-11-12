import { redirect } from 'next/navigation';
import { setupIsOpen } from '@/lib/first-run';
import { supabase } from '@/lib/supabase';
export default async function Index() { const db=await supabase(); const {data:{user}}=await db.auth.getUser(); if(!user) redirect(await setupIsOpen()?'/first-run':'/sign-in'); const {data}=await db.from('companies').select('slug').order('name').limit(1); if(!data?.length) redirect('/no-company'); redirect(`/c/${data[0].slug}/home`); }
