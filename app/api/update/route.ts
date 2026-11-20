import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { checkUpdate, updateSource } from '@/lib/updates.mjs';

// Update ready (#442), for a Company's Owner: the newer gtmworks on this install's channel, if there is one, and the day
// the reader joined (app/update-ready.tsx reads it for What's new). The answer is kept an hour, so GitHub is asked at
// most once an hour per server whoever reads; a failed check is not kept, answers no update, and shows nothing. A source
// the install names (GTMWORKS_UPDATE_SOURCE, the browser suite's fake) is asked every time, so no answer outlives it.
export const dynamic = 'force-dynamic';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
let kept:{at:number,update:ReturnType<typeof checkUpdate>}|undefined;
function newest() {
 const every=process.env.GTMWORKS_UPDATE_SOURCE?0:3600_000;
 if(!kept||Date.now()-kept.at>=every) {
  const update=checkUpdate({installed:process.env.GTMWORKS_VERSION,source:updateSource(process.env.GTMWORKS_UPDATE_SOURCE)});
  const mine=kept={at:Date.now(),update};
  update.catch(()=>{ if(kept===mine) kept=undefined; });
 }
 return kept.update.catch(()=>null);
}
export async function GET(request:NextRequest) {
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return reply({error:'notAllowed'},401);
 const company=request.nextUrl.searchParams.get('company');
 if(typeof company!=='string'||!uuid.test(company)) return reply({error:'invalid'},400);
 if(!await routeAllowed(db,'app/api/update/route.ts','GET',company,user.id)) return reply({error:'notAllowed'},403);
 return reply({joined:user.created_at,update:await newest()});
}
