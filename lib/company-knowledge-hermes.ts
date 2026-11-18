import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signInTarget } from './company-sign-in.mjs';

// The bundled Engine as the Company knowledge reaches it (#344): the Company's own profile with the install key, for
// a Member only (signInTarget), or null when the Company has none or it cannot be read. Never handed to the browser.
export async function knowledgeHermes(db:SupabaseClient,company:string) {
 try { return await signInTarget(db,company); } catch { return null; }
}
