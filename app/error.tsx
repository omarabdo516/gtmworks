'use client';
import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n-client';
import { reportClientError } from '@/lib/client-errors';
export default function ErrorPage({error,reset}:{error:Error&{digest?:string},reset:()=>void}) {
 const {t}=useI18n();
 useEffect(()=>{ reportClientError('error-page',error,{digest:error.digest}); },[error]);
 return <main className="panel login"><h1>{t('couldNotLoadPage')}</h1><button onClick={reset}>{t('tryAgain')}</button></main>;
}
