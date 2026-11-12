import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseConfig } from './supabase-config';

export async function supabase() {
  const jar = await cookies();
  return createServerClient(supabaseConfig.url, supabaseConfig.anonKey, {
    cookieOptions: supabaseConfig.cookieOptions,
    cookies: { getAll: () => jar.getAll(), setAll: (items) => { try { items.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* Server components cannot write cookies. */ } } }
  });
}
