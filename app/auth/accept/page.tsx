'use client';
import { useI18n } from '@/lib/i18n-client';
import { useEffect, useState } from 'react';
import { browserSupabase } from '@/lib/browser-supabase';
import { safeNext } from '@/lib/navigation';
export default function Accept() { const {t}=useI18n();
 const [error,setError]=useState('');
 useEffect(()=>{ async function accept() {  const db=await browserSupabase(); const hash=new URLSearchParams(window.location.hash.slice(1)); const access_token=hash.get('access_token'); const refresh_token=hash.get('refresh_token'); if(!access_token||!refresh_token) {setError(t('thisInvitationLinkIsInvalidOrExpired'));return;} const {error}=await db.auth.setSession({access_token,refresh_token}); if(error) {setError(t('couldNotSignIn'));return;} const result=await db.rpc('claim_invitations'); if(result.error) {setError(t('couldNotAcceptTheInvitation'));return;} window.location.replace(safeNext(new URLSearchParams(window.location.search).get('next'))); } void accept(); },[t]);
 return <main className="login panel"><p role="status">{error || t('acceptingInvitation')}</p></main>;
}
