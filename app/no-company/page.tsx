import { getI18n } from '@/lib/i18n-server';
import LanguageSettings from '@/app/language-settings';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
export default async function NoCompany() { const {t}=await getI18n(); const db=await supabase(); const {data:{user}}=await db.auth.getUser(); if(!user) redirect('/sign-in'); return <main className="panel login"><div className="brand">gtm<span>works</span></div><h1>{t('noCompanyYet')}</h1><p>{t('youAreNotAMemberOfAnyCompany')}</p><LanguageSettings/></main>; }
