import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { safeNext } from '@/lib/navigation';
import { appUrl } from '@/lib/app-origin.mjs';
// A sign-in link: the code becomes the person's session, then the next page opens. Email invitations are gone (#953), so
// nothing is claimed here; a link that carries no code returns to the sign-in page.
export async function GET(req: NextRequest) {
 const code=req.nextUrl.searchParams.get('code');
 if(!code) return NextResponse.redirect(appUrl('/sign-in'));
 const db=await supabase();
 const {error}=await db.auth.exchangeCodeForSession(code);
 if(error) return NextResponse.redirect(appUrl('/sign-in'));
 return NextResponse.redirect(appUrl(safeNext(req.nextUrl.searchParams.get('next'))));
}
