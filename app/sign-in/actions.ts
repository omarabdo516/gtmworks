'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { supabaseConfig } from '@/lib/supabase-config';
import { createClient } from '@supabase/supabase-js';
import { appUrl } from '@/lib/app-origin.mjs';
// The action returns a message key, so the page shows it in the language currently chosen on the page. Password sign-in
// runs in the browser (form.tsx), straight to the auth service through the gateway.
type ResetMessage=''|'checkYourEmailForAResetLink'|'couldNotSendTheLinkTryAgain';
export const sendResetLink=withActionLog('sendResetLink',async function sendResetLink(_state: ResetMessage, form: FormData): Promise<ResetMessage> {
 const email=String(form.get('email')||'').trim();
 // The auth service answers the same for an address with no account, so this page never tells whether one exists.
 // The link carries its own one-time session (implicit flow, like invitations), so it opens in any browser, not only in
 // the one holding a code verifier from this request. Its address comes from APP_ORIGIN, never from request headers.
 const resetAuth=createClient(supabaseConfig.url,supabaseConfig.anonKey,{auth:{flowType:'implicit',persistSession:false,autoRefreshToken:false}});
 const {error}=await resetAuth.auth.resetPasswordForEmail(email,{redirectTo:appUrl('/auth/reset').href});
 if(error) logActionFailure('sendResetLink',{name:error.name,code:error.code,status:error.status,message:error.message.replace(/\S+@\S+/g,'[redacted]')});
 return error ? 'couldNotSendTheLinkTryAgain' : 'checkYourEmailForAResetLink';
});
