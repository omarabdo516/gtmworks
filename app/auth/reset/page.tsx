'use client';
import { useI18n } from '@/lib/i18n-client';
import { useEffect } from 'react';
import { browserSupabase } from '@/lib/browser-supabase';
// Where a "Forgot password?" email link lands. The link carries its own one-time session (type=recovery), so it works in
// any browser, not only the one that asked for it. It takes no destination: a working link opens only the set-password
// page. The auth service makes the link work once and for 24 hours; a used or expired one arrives without a session.
export default function Reset() { const {t}=useI18n();
 useEffect(()=>{ async function reset() { const hash=new URLSearchParams(window.location.hash.slice(1)); const access_token=hash.get('access_token'), refresh_token=hash.get('refresh_token'); if(!access_token||!refresh_token||hash.get('type')!=='recovery') {window.location.replace('/forgot-password?link=invalid');return;} const {error}=await (await browserSupabase()).auth.setSession({access_token,refresh_token}); window.location.replace(error?'/forgot-password?link=invalid':'/reset-password'); } void reset(); },[]);
 return <main className="login panel"><p role="status">{t('setNewPassword')}</p></main>;
}
