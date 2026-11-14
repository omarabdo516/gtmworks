import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';

// The Owner sets the Company's Agent level (1 read and draft, 2 act on approval, 3 scheduled work). The request runs
// as the signed-in person and the database function checks that they are an active Owner of that Company
// (set_agent_level), so another Role is refused here whatever the page showed them. The worker then rewrites the
// Company's profile tools to match (lib/agent-levels.mjs).
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'agentLevelNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'agentLevelNotAllowed'},403);
  const raw=await request.text(); if(raw.length>1000) return reply({error:'agentLevelInvalid'},400);
  const body=JSON.parse(raw);
  if(typeof body?.company!=='string'||!uuid.test(body.company)||!Number.isInteger(body.level)) return reply({error:'agentLevelInvalid'},400);
  const {data:level,error}=await db.rpc('set_agent_level',{c:body.company,level:body.level});
  if(error) return error.code==='42501'?reply({error:'agentLevelNotAllowed'},403):reply({error:'agentLevelInvalid'},400);
  return reply({level});
 } catch { return reply({error:'agentLevelInvalid'},400); }
}
