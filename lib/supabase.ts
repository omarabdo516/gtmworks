import { cache } from 'react';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseConfig } from './supabase-config';

// One client per request (#771): React's cache keeps it for one server render, so a page and the helpers it calls share
// it; a route handler makes one per call, as before.
export const supabase=cache(async function supabase() {
  const jar = await cookies();
  return createServerClient(supabaseConfig.url, supabaseConfig.anonKey, {
    cookieOptions: supabaseConfig.cookieOptions,
    cookies: { getAll: () => jar.getAll(), setAll: (items) => { try { items.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* Server components cannot write cookies. */ } } }
  });
});
// The signed-in person, read once per request (#771): every part of one page asks this, not the auth server again.
export const signedInUser=cache(async()=>(await supabase()).auth.getUser());
