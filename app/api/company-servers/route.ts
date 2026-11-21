import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { changeCompanyServer } from '@/lib/company-servers.mjs';

// The Owner's own MCP server (#458): add it by name, address and sign-in kind, or by name and a command that runs in the
// Company's work sandbox (#459), or test the tools it lists. Only an Owner reaches it (route-permissions), and
// lib/company-servers.mjs checks the Owner on the server again. A command beside an address is refused before the Engine
// is asked. A token and a declared field are passed straight to the Engine and are
// never logged, never written by gtmworks and never put in a response. The body is larger than an app step's because a
// pasted token can be a long JWT; it is still capped.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'appsNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'appsNotAllowed'},403);
  const raw=await request.text(); if(raw.length>32768) return reply({error:'appsInvalid'},400);
  const body=JSON.parse(raw);
  if(typeof body?.company!=='string'||!uuid.test(body.company)) return reply({error:'appsInvalid'},400);
  if(typeof body.agent!=='string'||!uuid.test(body.agent)) return reply({error:'appsInvalid'},400);
  if(typeof body.name!=='string'||typeof body.kind!=='string'||(body.kind==='command'?typeof body.command!=='string'||!Array.isArray(body.args):typeof body.url!=='string')) return reply({error:'appsServerInvalid'},400);
  if(!await routeAllowed(db,'app/api/company-servers/route.ts','POST',body.company,user.id)) return reply({error:'appsNotAllowed'},403);
  const result=await changeCompanyServer(db,{company:body.company,person:user.id,agent:body.agent,action:body.action,name:body.name,url:body.url,kind:body.kind,token:body.token,command:body.command,args:body.args});
  return reply(result.body,result.status);
 } catch { return reply({error:'appsFailed'},500); }
}
