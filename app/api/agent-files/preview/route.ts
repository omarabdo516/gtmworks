import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { agentFilePreview } from '@/lib/agent-files.mjs';

// One file of an Agent's Library, read for the preview dialog (#195): the first part of a text file with its type, its
// whole size and whether more follows, and for a picture its type alone — the dialog draws it through the download route.
// The same people as the Library open it, checked here on the server (the permission table) and again by the database:
// a Contributor and a Viewer are refused. The Agent is named by its id only and the database says which profile is its
// (company_app_agents), so a hidden Agent and another Company's Agent are not found. The root is one of the Library's two
// (#353), refused here when it is neither; the folder and the name pass #194's path guard before the Engine is asked:
// `..`, an absolute path, a name outside the root and a link out of it are refused. The answer carries the file's name
// and type only — never an Engine address or a path on its disk.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'agentLibraryNotAllowed'},401);
  const company=request.nextUrl.searchParams.get('company');
  const agent=request.nextUrl.searchParams.get('agent');
  const folder=request.nextUrl.searchParams.get('folder')??'';
  const name=request.nextUrl.searchParams.get('name')??'';
  const root=request.nextUrl.searchParams.get('root')??'work';
  if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)) return reply({error:'agentLibraryInvalid'},400);
  if(root!=='work'&&root!=='images') return reply({error:'agentLibraryInvalid'},400);
  if(!await routeAllowed(db,'app/api/agent-files/preview/route.ts','GET',company,user.id)) return reply({error:'agentLibraryNotAllowed'},403);
  const read=await agentFilePreview(db,{company,agent,folder,name,root});
  if(read.state==='found') return reply(read.preview);
  if(read.state==='invalid') return reply({error:'agentLibraryInvalid'},400);
  if(read.state==='missing') return reply({error:'agentLibraryMissing'},404);
  if(read.state==='tooLarge') return reply({error:'agentLibraryInvalid'},413);
  return reply({error:'agentLibraryUnreadable'},read.state==='refused'?502:503);
 } catch { return reply({error:'agentLibraryFailed'},500); }
}
