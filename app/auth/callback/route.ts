import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { safeNext } from '@/lib/navigation';
import { appUrl } from '@/lib/app-origin.mjs';
import { logActionFailure } from '@/lib/diagnostics.mjs';
// A sign-in link: the session, then the person's open invitations (claim_invitations). A claim that fails is logged and
// told on the sign-in page (#775), never passed over so the person lands where their invitation did not apply.
export async function GET(req: NextRequest) {
 const code=req.nextUrl.searchParams.get('code');
 if(!code) return NextResponse.redirect(appUrl('/sign-in'));
 const db=await supabase();
 const {error}=await db.auth.exchangeCodeForSession(code);
 if(error) return NextResponse.redirect(appUrl('/sign-in'));
 const claim=await db.rpc('claim_invitations');
 if(claim.error) { logActionFailure('claimInvitations',{code:claim.error.code,message:'the invitations were not claimed'}); return NextResponse.redirect(appUrl('/sign-in?invitation=failed')); }
 return NextResponse.redirect(appUrl(safeNext(req.nextUrl.searchParams.get('next'))));
}
