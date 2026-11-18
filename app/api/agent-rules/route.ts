import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';

// An Owner or a Manager removes a lasting rule from an Agent's page, and brings one back from Learning (#28). The
// request runs as the signed-in person, and the database checks again that they are an active Owner or Manager of the
// rule's own Company who sees that Agent (remove_agent_rule, restore_agent_rule): the rule is kept, marked removed or
// cleared, and the change is logged once.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
// The Company and the rule the request names, or the answer to send instead.
type Checked={reply?:undefined,db:Awaited<ReturnType<typeof supabase>>,company:string,rule:string}|{reply:NextResponse};
async function target(request:NextRequest):Promise<Checked> {
 const db=await supabase(); const {data:{user}}=await db.auth.getUser();
 if(!user) return {reply:reply({error:'agentRuleNotAllowed'},401)};
 if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return {reply:reply({error:'agentRuleNotAllowed'},403)};
 const body=await request.json().catch(()=>null) as {company?:unknown,rule?:unknown}|null;
 if(typeof body?.company!=='string'||!uuid.test(body.company)||typeof body.rule!=='string'||!uuid.test(body.rule)) return {reply:reply({error:'agentRuleInvalid'},400)};
 if(!await routeAllowed(db,'app/api/agent-rules/route.ts',request.method,body.company,user.id)) return {reply:reply({error:'agentRuleNotAllowed'},403)};
 return {db,company:body.company,rule:body.rule};
}
const failed=(error:{code?:string})=>error.code==='42501'?reply({error:'agentRuleNotAllowed'},403):error.code==='P0002'?reply({error:'agentRuleNotFound'},404):reply({error:'agentRuleFailed'},500);
export async function POST(request:NextRequest) {
 const found=await target(request);
 if(found.reply) return found.reply;
 const {db,company,rule}=found;
 const {data,error}=await db.rpc('remove_agent_rule',{c:company,rule});
 if(error) return failed(error);
 return reply({removed:data===true});
}
// A rule removed from Learning, brought back into force: the same checks, and the worker writes it into the Agent's
// SOUL.md section on its next pass (lib/agent-rules.mjs).
export async function PUT(request:NextRequest) {
 const found=await target(request);
 if(found.reply) return found.reply;
 const {db,company,rule}=found;
 const {data,error}=await db.rpc('restore_agent_rule',{c:company,rule});
 if(error) return failed(error);
 return reply({restored:data===true});
}
