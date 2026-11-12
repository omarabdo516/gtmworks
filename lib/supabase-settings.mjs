import { LOCAL_ANON_KEY } from './settings.mjs';

export function supabaseSettings(env = process.env) {
 return {
  url: env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
  anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY || LOCAL_ANON_KEY,
  ...(env.GTMWORKS_SELF_HOSTED === 'true' ? {cookieOptions:{name:'sb-gtmworks-auth-token'}} : {}),
 };
}
