import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { channelSidebar } from '@/lib/channels';
import { agentFaceStates } from '@/lib/agent-face-states';
import { uuid } from '@/lib/conversations';
import type { SidebarNow } from '@/app/sidebar-live';
import { screenHands } from '@/lib/agent-screen.mjs';
import { ReadFailed } from '@/lib/read-failed';

const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});

// The sidebar's poll (app/sidebar-live): the reader's channels with their unread counts (#24) and the state of each Agent
// they see (#699), both read as the reader, so a hidden Agent has no state and nothing but the state is told; and the steps
// handed to the reader on an Agent's Screen in their own Conversations (#714).
export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'channelNotFound'},401);
  const company=request.nextUrl.searchParams.get('company');
  if(!company||!uuid.test(company)) return reply({error:'channelFailed'},400);
  if(!await routeAllowed(db,'app/api/sidebar/route.ts','GET',company,user.id)) return reply({error:'channelNotFound'},404);
  const [channels,{states},handed]=await Promise.all([channelSidebar(db,company),agentFaceStates(db,company),screenHands(db,company)]);
  return reply({channels,agents:states,handed} satisfies SidebarNow);
 } catch(error) {
  // A read that failed answers an error (#776): the sidebar keeps the Conversations and channels it shows.
  if(error instanceof ReadFailed) return reply({error:'channelNotRead'},503);
  logActionFailure('sidebar',new Error('Sidebar request failed')); return reply({error:'channelFailed'},400);
 }
}
