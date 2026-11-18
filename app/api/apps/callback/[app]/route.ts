import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { appUrl } from '@/lib/app-origin.mjs';
import { overlayHref } from '@/lib/settings-overlay.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { finishCompanyAppSignIn } from '@/lib/company-apps.mjs';

// The vendor's way back after an Owner signs in to an app (#30). The Engine's own callback sits on its private listener,
// which the browser cannot reach, so gtmworks hands on the answer (code, state, error, iss) for a sign-in this person
// started and then shows the Company's apps; the Engine's page never reaches the browser. The address carries a one-time
// code: it is never logged, and the next page gets no referrer.
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
const go=(path:string)=>NextResponse.redirect(appUrl(path),{status:303,headers});
export async function GET(request:NextRequest,{params}:{params:Promise<{app:string}>}) {
 const {app}=await params;
 let slug:string|null=null, outcome='failed';
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user||!await routeAllowed(db,'app/api/apps/callback/[app]/route.ts','GET',undefined,user.id)) return go('/');
  const search=request.nextUrl.searchParams;
  const answer=Object.fromEntries(['code','state','error','iss'].flatMap(name=>{ const value=search.get(name); return value===null?[]:[[name,value]]; }));
  ({slug,outcome}=await finishCompanyAppSignIn(db,{person:user.id,app,answer}));
 } catch { outcome='failed'; }
 return go(slug?overlayHref(slug,'apps',{app,...(outcome==='failed'?{signin:'failed'}:{})}):'/');
}
