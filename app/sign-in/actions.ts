'use server';
import { withActionLog, logActionFailure } from '@/lib/diagnostics.mjs';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { createClient } from '@supabase/supabase-js';
import { safeNext } from '@/lib/navigation';
import { appUrl } from '@/lib/app-origin.mjs';
// Both actions return a message key, so the page shows it in the language currently chosen on the page.
// The password goes only to the auth service: it is never logged (withActionLog logs only a company id and slug) or returned.
type SignInMessage=''|'wrongEmailOrPassword'|'tooManySignInAttempts';
export const signIn=withActionLog('signIn',async function signIn(_state: SignInMessage, form: FormData): Promise<SignInMessage> {
 const email=String(form.get('email')||'').trim(); const password=String(form.get('password')||''); const next=safeNext(String(form.get('next')||''));
 const db=await supabase(); const {error}=await db.auth.signInWithPassword({email,password});
 if(error) {
  // The auth service's own rate limit answers 429. A wrong password and an unknown email get the same message.
  if(error.status===429 || error.code==='over_request_rate_limit') return 'tooManySignInAttempts';
  if(error.code!=='invalid_credentials') logActionFailure('signIn',{name:error.name,code:error.code,status:error.status,message:error.message.replace(/\S+@\S+/g,'[redacted]')});
  return 'wrongEmailOrPassword';
 }
 // A path, not a URL: the browser resolves it against the address it is on, behind a proxy too.
 redirect(next);
});

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
