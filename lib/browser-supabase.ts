// Loaded when a page needs it (the sign-in link), never with every company page.
export async function browserSupabase() {
  const { createBrowserClient } = await import('@supabase/ssr');
  const response = await fetch('/api/config', { cache: 'no-store' });
  if (!response.ok) throw new Error('Configuration unavailable');
  const { url, anonKey, cookieOptions } = await response.json();
  return createBrowserClient(url, anonKey, {cookieOptions});
}
