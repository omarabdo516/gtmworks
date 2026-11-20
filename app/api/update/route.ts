import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { checkUpdate, updateSource } from '@/lib/updates.mjs';

// Update ready (#442), for a Company's Owner: the newer gtmworks on this install's channel, if there is one, and the day
// the reader joined (app/update-ready.tsx reads it for What's new). One check serves every reader: an answer is kept an
// hour and a failed check five minutes, so GitHub is asked rarely and an offline install does not wait on every page; a
// failure answers no update and shows nothing. A source the install names (GTMWORKS_UPDATE_SOURCE, the browser suite's
// fake) is asked every time, so no answer outlives it.
export const dynamic = 'force-dynamic';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const hour=3600_000, fiveMinutes=300_000;
let kept:{until:number,update:ReturnType<typeof checkUpdate>}|undefined;
function newest() {
 const named=!!process.env.GTMWORKS_UPDATE_SOURCE;
 if(!kept||Date.now()>=kept.until) {
  const checked=checkUpdate({installed:process.env.GTMWORKS_VERSION,source:updateSource(process.env.GTMWORKS_UPDATE_SOURCE)});
  const mine=kept={until:named?0:Date.now()+hour,update:checked.catch(()=>null)};
  checked.catch(()=>{ mine.until=named?0:Date.now()+fiveMinutes; });
 }
 return kept.update;
}
export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'notAllowed'},401);
  const company=request.nextUrl.searchParams.get('company');
  if(typeof company!=='string'||!uuid.test(company)) return reply({error:'invalid'},400);
  if(!await routeAllowed(db,'app/api/update/route.ts','GET',company,user.id)) return reply({error:'notAllowed'},403);
  return reply({joined:user.created_at,update:await newest()});
 } catch { return reply({error:'failed'},502); }
}
