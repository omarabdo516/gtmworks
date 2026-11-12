'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { reportClientError } from '@/lib/client-errors';

// A request that fails inside a button leaves nothing on the page, so the button seems to do nothing. Two cases become a
// visible message: a server action request that cannot be sent or is answered with an error (Next.js only logs that to
// the console), and a promise rejection nobody handled.
export function FailureNotice() { const {t}=useI18n();
 const [failed,setFailed]=useState(false);
 useEffect(()=>{
  const show=()=>setFailed(true);
  const original=window.fetch;
  window.fetch=async (input,init)=>{
   const action=new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).has('next-action');
   try { const response=await original.call(window,input,init); if(action && response.status>=400) { reportClientError('server-action',`A server action was answered with status ${response.status}`); show(); } return response; }
   catch(error) { if(action) { reportClientError('server-action',error); show(); } throw error; }
  };
  window.addEventListener('unhandledrejection',show);
  return ()=>{ window.fetch=original; window.removeEventListener('unhandledrejection',show); };
 },[]);
 return failed ? <div role="alert" className="rejection-notice failure-notice"><span>{t('somethingWentWrongCheckYourConnectionAndTryAgain')}</span>{' '}<button type="button" onClick={()=>setFailed(false)}>{t('close')}</button></div> : null;
}
