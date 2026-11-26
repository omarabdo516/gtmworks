import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import { routePermission } from '@/lib/route-permissions.mjs';
import { channelSidebar } from '@/lib/channels';
import { agentFaceStates } from '@/lib/agent-face-states';
import { uuid } from '@/lib/conversations';
import type { SidebarNow } from '@/app/sidebar-live';
import { readScreenHands } from '@/lib/agent-screen.mjs';
import { ReadFailed } from '@/lib/read-failed';
import { chatsOf, recentChats } from '@/lib/sidebar-chats';
import { approvalQueue } from '@/lib/approval-queue';
import { getI18n } from '@/lib/i18n-server';

const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});

// The sidebar's poll (app/sidebar-live): the reader's channels with their unread counts (#24) and the state of each Agent
// they see (#699), both read as the reader, so a hidden Agent has no state and nothing but the state is told; the steps
// handed to the reader on an Agent's Screen in their own Conversations (#714); and, since the Shell is drawn once by the
// Company's layout (#789), the reader's recent chats (null when that read failed) and how many things wait on them.
export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'channelNotFound'},401);
  const company=request.nextUrl.searchParams.get('company');
  if(!company||!uuid.test(company)) return reply({error:'channelFailed'},400);
  // A poll for another reader than the one signed in now (another tab changed the account) gets nothing: their page
  // keeps what it shows until it is drawn again for the reader who is signed in.
  const person=request.nextUrl.searchParams.get('person');
  if(person!==null&&person!==user.id) return reply({error:'readerChanged'},409);
  // A membership read that failed is an error, not "not found" (#776, #777).
  const allowed=await routePermission(db,'app/api/sidebar/route.ts','GET',company,user.id);
  if(allowed==='failed') return reply({error:'channelNotRead'},503);
  if(allowed==='refused') return reply({error:'channelNotFound'},404);
  const [channels,faces,handed,chats,waiting,{t,language}]=await Promise.all([channelSidebar(db,company),agentFaceStates(db,company),readScreenHands(db,company),
   recentChats(db,company),approvalQueue(db,company,user.id).then(({count})=>count,()=>undefined),getI18n()]);
  // Any of the three that could not be read is an error: the sidebar keeps what it shows, never idle faces or no steps.
  // Chats or a count that could not be read are left out, and the sidebar keeps the ones it shows.
  if(!faces.available||!handed) return reply({error:'channelNotRead'},503);
  return reply({channels,agents:faces.states,handed,chats:chats&&chatsOf(chats,t,language),approvals:waiting} satisfies SidebarNow);
 } catch(error) {
  // A read that failed answers an error (#776): the sidebar keeps the Conversations and channels it shows.
  if(error instanceof ReadFailed) return reply({error:'channelNotRead'},503);
  logActionFailure('sidebar',new Error('Sidebar request failed')); return reply({error:'channelFailed'},400);
 }
}
