import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';

// Update now (#443, ADR 0020). Both run as the signed-in person: install_update answers an Owner of any Company with the
// state the updater on the host writes, and nobody else; request_install_update records an Owner's request while the
// install owner leaves the button on. The request carries nothing: the updater chooses the version, never this route.
const reply=(body:object|null,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET() {
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user||!await routeAllowed(db,'app/api/install-update/route.ts','GET',undefined,user.id)) return reply(null,401);
 const {data,error}=await db.rpc('install_update');
 return error?reply(null,503):reply(data??null);
}
export async function POST(request:NextRequest) {
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user||!await routeAllowed(db,'app/api/install-update/route.ts','POST',undefined,user.id)) return reply({error:'updateNotAllowed'},401);
 if(crossSiteWrite(request.headers)) return reply({error:'updateNotAllowed'},403);
 const {data,error}=await db.rpc('request_install_update');
 if(error) return error.code==='42501'?reply({error:error.message==='updateButtonOff'?'updateButtonOff':'updateNotAllowed'},403):reply({error:'updateRequestFailed'},503);
 return reply({state:data});
}
