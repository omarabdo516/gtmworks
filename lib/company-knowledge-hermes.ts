import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from './supabase-config';
import { signInTarget } from './company-sign-in.mjs';

// The bundled Engine as the Company knowledge reaches it (#344): the Company's own profile with the install key, for
// a Member only (signInTarget), or null when the Company has none or it cannot be read. Never handed to the browser.
export async function knowledgeHermes(db:SupabaseClient,company:string) {
 const service=createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
 try { return await signInTarget(db,service,company,process.env.WEBHOOK_ENCRYPTION_KEY); } catch { return null; }
}
