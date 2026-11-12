export const LOCAL_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicmVmIjoic3VwYWJhc2UtZGVtbyIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNjQxNzY5MjAwLCJleHAiOjE3OTk1MzUyMDB9.yANOnOrEJx_7adCSjRnnx_hJTsNPkprN2mH-mYqDhdw';

export function checkSettings(env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const names = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET', 'WEBHOOK_ENCRYPTION_KEY', 'APP_ORIGIN'];
  const problems = names.filter(name => !env[name]?.trim()).map(name => `${name} is missing`);
  if (env.NEXT_PUBLIC_SUPABASE_ANON_KEY === LOCAL_ANON_KEY) problems.push('NEXT_PUBLIC_SUPABASE_ANON_KEY must not be the local fallback key');
  if (env.APP_ORIGIN) {
    try {
      const url = new URL(env.APP_ORIGIN);
      const localInstall = env.GTMWORKS_SELF_HOSTED === 'true' && url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
      if ((!localInstall && url.protocol !== 'https:') || url.origin !== env.APP_ORIGIN) throw new Error();
    }
    catch { problems.push('APP_ORIGIN must be an https:// origin'); }
  }
  if (env.NEXT_PUBLIC_SUPABASE_URL) {
    try { const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
    catch { problems.push('NEXT_PUBLIC_SUPABASE_URL must be an HTTP(S) URL'); }
  }
  if (env.WEBHOOK_ENCRYPTION_KEY && (!/^[A-Za-z0-9+/]{43}=$/.test(env.WEBHOOK_ENCRYPTION_KEY) || Buffer.from(env.WEBHOOK_ENCRYPTION_KEY, 'base64').length !== 32)) problems.push('WEBHOOK_ENCRYPTION_KEY must be 32 bytes in base64');
  if (problems.length) throw new Error(`Invalid production settings: ${problems.join('; ')}`);
}
