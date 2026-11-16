import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { channelSidebar } from '@/lib/channels';
import { uuid } from '@/lib/conversations';

const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});

export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'channelNotFound'},401);
  const company=request.nextUrl.searchParams.get('company');
  if(!company||!uuid.test(company)) return reply({error:'channelFailed'},400);
  if(!await routeAllowed(db,'app/api/channel-list/route.ts','GET',company,user.id)) return reply({error:'channelNotFound'},404);
  return reply(await channelSidebar(db,company));
 } catch { logActionFailure('channelList',new Error('Channel list request failed')); return reply({error:'channelFailed'},400); }
}
