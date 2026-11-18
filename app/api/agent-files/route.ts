import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { agentLibrary } from '@/lib/agent-files.mjs';

// The Library of an Agent (#194): one folder of its own Engine profile's work folder, each entry with its name, whether
// it is a folder, its size and its time. The Owner and Managers read it, checked here on the server (the permission
// table) and again by the database; a Contributor or a Viewer is refused. The Agent is named by its id only and the
// database says which profile is its (company_app_agents), so a hidden Agent and another Company's Agent are not found.
// No answer carries an Engine address or a path on its disk, and nothing of the request or the Engine is logged.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'agentLibraryNotAllowed'},401);
  const company=request.nextUrl.searchParams.get('company');
  const agent=request.nextUrl.searchParams.get('agent');
  const folder=request.nextUrl.searchParams.get('folder')??'';
  if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)) return reply({error:'agentLibraryInvalid'},400);
  if(!await routeAllowed(db,'app/api/agent-files/route.ts','GET',company,user.id)) return reply({error:'agentLibraryNotAllowed'},403);
  const read=await agentLibrary(db,{company,agent,folder});
  if(read.state==='found') return reply({folder,entries:read.entries});
  if(read.state==='invalid') return reply({error:'agentLibraryInvalid'},400);
  if(read.state==='missing') return reply({error:'agentLibraryMissing'},404);
  return reply({error:'agentLibraryUnreadable'},read.state==='refused'?502:503);
 } catch { return reply({error:'agentLibraryFailed'},500); }
}
