'use client';
import { messages } from '@/lib/i18n.mjs';
import { useI18n } from '@/lib/i18n-client';
import { useActionState } from 'react';
import { Button } from '@/components/paperclip/ui/button';
import { Input } from '@/components/paperclip/ui/input';
import { signIn } from './actions';
export default function Form({next,message:initialMessage}:{next:string,message?:string}) { const {t}=useI18n(); const [message, action, pending]=useActionState(signIn,initialMessage==='sent'?t('checkYourEmailForASigninLink'):initialMessage==='failed'?t('couldNotSendTheLinkTryAgain'):''); const messageKey=(['couldNotSendTheLinkTryAgain','checkYourEmailForASigninLink'] as const).find(key=>messages.en[key]===message||messages.ar[key]===message); return <form action={action} className="mt-6 space-y-4"><input type="hidden" name="next" value={next}/><label className="block text-xs text-muted-foreground">{t('email')}<Input dir="auto" className="field" type="email" name="email" required /></label><Button className="w-full" disabled={pending}>{t('sendSigninLink')}</Button>{message && <p role="status">{messageKey?t(messageKey):message}</p>}</form>; }
