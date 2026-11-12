import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { safeNext } from '@/lib/navigation';
import { appUrl } from '@/lib/app-origin.mjs';
export async function GET(req: NextRequest) { const code=req.nextUrl.searchParams.get('code'); if(code) { const db=await supabase(); const {error}=await db.auth.exchangeCodeForSession(code); if(!error) { await db.rpc('claim_invitations'); return NextResponse.redirect(appUrl(safeNext(req.nextUrl.searchParams.get('next')))); } } return NextResponse.redirect(appUrl('/sign-in')); }
