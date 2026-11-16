import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from '@/lib/supabase-config';
import { appUrl } from '@/lib/app-origin.mjs';

// The invitation email, sent after the caller's invitation row was written (that write checked their permission).
// Production has sign-ups off, so a sign-in link is never sent to an address with no account; the server's own key
// invites it instead. Someone who already has an account gets an ordinary sign-in link.
export async function sendInvitationMail(email:string,slug:string) {
 const emailRedirectTo=appUrl(`/auth/accept?next=${encodeURIComponent(`/c/${slug}/settings/members`)}`).href;
 const admin=createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY || '',{auth:{persistSession:false,autoRefreshToken:false}});
 let {error}=await admin.auth.admin.inviteUserByEmail(email,{redirectTo:emailRedirectTo});
 if(error && (error.code==='email_exists' || /already (been )?registered/i.test(error.message))) {
  const invitationAuth=createClient(supabaseConfig.url,supabaseConfig.anonKey,{auth:{flowType:'implicit',persistSession:false}});
  ({error}=await invitationAuth.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo}}));
 }
 return error;
}
