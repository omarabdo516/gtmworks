import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { supabaseConfig } from './supabase-config';
// The sole exception to member-scoped product writes: anonymous installation setup.
export function setupAdmin() {
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key) throw new Error('Setup is not configured');
 return createClient(supabaseConfig.url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function setupIsOpen() {
 const {data,error}=await setupAdmin().rpc('setup_is_open');
 if(error) throw new Error('Setup availability failed');
 return data===true;
}
