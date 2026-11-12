import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { appUrl } from '@/lib/app-origin.mjs';
// Where a "Forgot password?" email link lands. It takes no destination: a working link opens only the set-password page.
// The auth service makes the link work once and for 24 hours; a used or expired one arrives here without a code.
export async function GET(req: NextRequest) {
 const code=req.nextUrl.searchParams.get('code');
 if(code) {
  const {error}=await (await supabase()).auth.exchangeCodeForSession(code);
  if(!error) return NextResponse.redirect(appUrl('/reset-password'));
 }
 return NextResponse.redirect(appUrl('/forgot-password?link=invalid'));
}
