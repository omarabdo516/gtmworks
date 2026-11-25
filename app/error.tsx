'use client';
import { startTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n-client';
import { reportClientError } from '@/lib/client-errors';
export default function ErrorPage({error,reset}:{error:Error&{digest?:string},reset:()=>void}) {
 const {t}=useI18n(); const router=useRouter();
 // A page whose read failed (lib/read-failed.ts, #777) is read again from the server: Try again asks for it afresh.
 const again=()=>startTransition(()=>{ router.refresh(); reset(); });
 useEffect(()=>{ reportClientError('error-page',error,{digest:error.digest}); },[error]);
 return <main className="panel login"><h1>{t('couldNotLoadPage')}</h1><button onClick={again}>{t('tryAgain')}</button></main>;
}
