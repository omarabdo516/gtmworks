import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseConfig } from './lib/supabase-config';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const client = createServerClient(supabaseConfig.url, supabaseConfig.anonKey, {
    cookieOptions: supabaseConfig.cookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Refresh before server components read the session, and persist rotated tokens.
  await client.auth.getUser();
  return response;
}

export const config = {
  matcher: ['/((?!api/health|api/config|api/client-errors|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
