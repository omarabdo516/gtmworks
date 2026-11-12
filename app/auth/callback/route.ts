import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { safeNext } from '@/lib/navigation';
// Next dev builds req.url from its own hostname (localhost), not the Host the browser used; redirect on the browser's host so the session cookies stay on the same origin.
function onRequestHost(req: NextRequest, path: string) { const host=req.headers.get('x-forwarded-host') ?? req.headers.get('host'); const proto=req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':',''); return new URL(path, host ? `${proto}://${host}` : req.url); }
export async function GET(req: NextRequest) { const code=req.nextUrl.searchParams.get('code'); if(code) { const db=await supabase(); const {error}=await db.auth.exchangeCodeForSession(code); if(!error) { await db.rpc('claim_invitations'); return NextResponse.redirect(onRequestHost(req, safeNext(req.nextUrl.searchParams.get('next')))); } } return NextResponse.redirect(onRequestHost(req, '/sign-in')); }
