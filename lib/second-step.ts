import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from '@/lib/supabase-config';

// A password link never goes around the second step (Omar, #954): for an account with a verified authenticator, the
// code typed on the link's page is checked by the auth service itself before the link is spent. The server opens a
// session for the account that lives only in this check (an admin-made sign-in link no email carries), asks the auth
// service to verify the code against the account's own authenticator, and ends that session whatever the answer. The
// factor's secret never leaves the auth service. Answers 'verified', 'refused' (a wrong or used code) or 'failed'.
export async function verifySecondStep(admin:SupabaseClient,email:string,code:string):Promise<'verified'|'refused'|'failed'> {
 if(!/^\d{6}$/.test(code)) return 'refused';
 const {data:link,error:linkError}=await admin.auth.admin.generateLink({type:'magiclink',email});
 const token=link?.properties?.hashed_token;
 if(linkError||!token) return 'failed';
 const check=createClient(supabaseConfig.url,supabaseConfig.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {error:opened}=await check.auth.verifyOtp({token_hash:token,type:'magiclink'});
 if(opened) return 'failed';
 try {
  const {data:factors,error:listed}=await check.auth.mfa.listFactors();
  const factor=factors?.totp.find(item=>item.status==='verified');
  if(listed||!factor) return 'failed';
  const {error}=await check.auth.mfa.challengeAndVerify({factorId:factor.id,code});
  return error?'refused':'verified';
 } finally {
  await check.auth.signOut({scope:'local'});
 }
}
