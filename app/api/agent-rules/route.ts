import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';

// An Owner or a Manager removes a lasting rule from an Agent's page (#18). The request runs as the signed-in person, and
// the database checks again that they are an active Owner or Manager of the rule's own Company (remove_agent_rule): the
// rule is kept, marked removed, and its removal is logged once.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest) {
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return reply({error:'agentRuleNotAllowed'},401);
 if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'agentRuleNotAllowed'},403);
 const body=await request.json().catch(()=>null) as {company?:unknown,rule?:unknown}|null;
 if(typeof body?.company!=='string'||!uuid.test(body.company)||typeof body.rule!=='string'||!uuid.test(body.rule)) return reply({error:'agentRuleInvalid'},400);
 if(!await routeAllowed(db,'app/api/agent-rules/route.ts','POST',body.company,user.id)) return reply({error:'agentRuleNotAllowed'},403);
 const {data,error}=await db.rpc('remove_agent_rule',{c:body.company,rule:body.rule});
 if(error) return error.code==='42501'?reply({error:'agentRuleNotAllowed'},403):error.code==='P0002'?reply({error:'agentRuleNotFound'},404):reply({error:'agentRuleFailed'},500);
 return reply({removed:data===true});
}
