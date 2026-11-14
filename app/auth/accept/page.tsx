'use client';
import { useI18n } from '@/lib/i18n-client';
import { useEffect, useState } from 'react';
import { browserSupabase } from '@/lib/browser-supabase';
import { safeNext } from '@/lib/navigation';
import SetPasswordForm from '@/app/set-password-form';
// A new Member's invitation (type=invite) asks for their password before opening the Company; someone who already has an
// account and password gets an ordinary sign-in link and goes straight on.
export default function Accept() { const {t}=useI18n();
 const [error,setError]=useState(''); const [next,setNext]=useState('');
 useEffect(()=>{ async function accept() {  const db=await browserSupabase(); const hash=new URLSearchParams(window.location.hash.slice(1)); const access_token=hash.get('access_token'); const refresh_token=hash.get('refresh_token'); if(!access_token||!refresh_token) {setError(t('thisInvitationLinkIsInvalidOrExpired'));return;} const {error}=await db.auth.setSession({access_token,refresh_token}); if(error) {setError(t('couldNotSignIn'));return;} const result=await db.rpc('claim_invitations'); if(result.error) {setError(t('couldNotAcceptTheInvitation'));return;} const destination=safeNext(new URLSearchParams(window.location.search).get('next')); if(hash.get('type')==='invite') setNext(destination); else window.location.replace(destination); } void accept(); },[t]);
 if(next) return <main className="login panel"><h1>{t('setNewPassword')}</h1><p>{t('setNewPasswordDescription')}</p><SetPasswordForm done={next}/></main>;
 return <main className="login panel"><p role="status">{error || t('acceptingInvitation')}</p></main>;
}
