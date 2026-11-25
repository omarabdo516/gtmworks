import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { channelSidebar } from '@/lib/channels';
import { agentFaceStates } from '@/lib/agent-face-states';
import { uuid } from '@/lib/conversations';
import type { SidebarNow } from '@/app/sidebar-live';

const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});

// The sidebar's poll (app/sidebar-live): the reader's channels with their unread counts (#24) and the state of each Agent
// they see (#699), both read as the reader, so a hidden Agent has no state and nothing but the state is told.
export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'channelNotFound'},401);
  const company=request.nextUrl.searchParams.get('company');
  if(!company||!uuid.test(company)) return reply({error:'channelFailed'},400);
  if(!await routeAllowed(db,'app/api/sidebar/route.ts','GET',company,user.id)) return reply({error:'channelNotFound'},404);
  const [channels,{states}]=await Promise.all([channelSidebar(db,company),agentFaceStates(db,company)]);
  return reply({channels,agents:states} satisfies SidebarNow);
 } catch { logActionFailure('sidebar',new Error('Sidebar request failed')); return reply({error:'channelFailed'},400); }
}
