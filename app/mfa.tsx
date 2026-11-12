'use client';
import { useI18n } from '@/lib/i18n-client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { reportClientError } from '@/lib/client-errors';
// The Supabase browser client is large: it loads only when a person starts or verifies the authenticator.
const browserSupabase=async()=>(await import('@/lib/browser-supabase')).browserSupabase();
export default function Mfa({enrolled}:{enrolled:boolean}) { const {t}=useI18n();
 const [secret,setSecret]=useState(''); const [factor,setFactor]=useState(''); const [qr,setQr]=useState(''); const [code,setCode]=useState(''); const [error,setError]=useState(''); const router=useRouter();
 async function start() { try { const db=await browserSupabase(); const {data,error}=await db.auth.mfa.enroll({factorType:'totp',friendlyName:'Authenticator'}); if(error) {reportClientError('two-step',error,{stage:'enroll'}); setError(t('couldNotSetUpTheAuthenticatorTryAgain'));} else {setError('');setFactor(data.id);setQr(data.totp.qr_code);setSecret(data.totp.secret);} } catch(error) { reportClientError('two-step',error,{stage:'enroll'}); setError(t('couldNotSetUpTheAuthenticatorTryAgain')); } }
 // Verify is several requests in a row; the stage says which one failed or stopped answering, and a step that never answers
 // ends in a message after 20 seconds instead of leaving the button looking dead.
 async function verify(e:React.FormEvent) { e.preventDefault(); const stage={current:'start'}; const watchdog=setTimeout(()=>{ reportClientError('two-step',new Error('Verify did not finish in 20 seconds'),{stage:stage.current}); setError(t('couldNotStartVerification')); },20000);
  try { await check(stage); } catch(error) { reportClientError('two-step',error,{stage:stage.current}); setError(t('couldNotStartVerification')); } finally { clearTimeout(watchdog); } }
 async function check(stage:{current:string}) { stage.current='load'; const db=await browserSupabase(); let id=factor; if(!id) {stage.current='list'; const {data,error}=await db.auth.mfa.listFactors(); if(error) reportClientError('two-step',error,{stage:'list'}); id=data?.totp[0]?.id || ''; } stage.current='challenge'; const {data,error}=await db.auth.mfa.challenge({factorId:id}); if(error || !data) {reportClientError('two-step',error || new Error('No challenge was returned'),{stage:'challenge'}); setError(t('couldNotStartVerification'));return;} stage.current='verify'; const result=await db.auth.mfa.verify({factorId:id,challengeId:data.id,code:code.replace(/\s+/g,'')}); if(result.error) {reportClientError('two-step',result.error,{stage:'verify'}); setError(t('incorrectCodeTryAgain'));} else {stage.current='reload'; router.refresh(); window.location.reload();} }
 return <section className="panel"><h2>{t('twoStepVerification')}</h2><p>{t('useAnAuthenticatorToProtectAccessToAll')}</p>{!enrolled&&!factor&&<button onClick={start}>{t('setUpAuthenticator')}</button>}{qr&&<div><p>{t('setupKey')}{' '}<code dir="ltr">{secret}</code></p><img src={qr} alt={t('authenticatorSetupCode')} width="200" height="200"/></div>}{(enrolled||factor)&&<form onSubmit={verify}><label>{t('verificationCode')}<input dir="auto" className="field" value={code} onChange={e=>setCode(e.target.value)} inputMode="numeric" required /></label><button>{t('verify')}</button></form>}{error&&<p role="alert">{error}</p>}</section>;
}
