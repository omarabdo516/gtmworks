import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { changeCompanyApp } from '@/lib/company-apps.mjs';
import { agentToolItems, companyAppItems } from '@/lib/company-app-items';
import { getI18n } from '@/lib/i18n-server';

// The Company's apps (#30): any Member reads them, each with every Agent's state, in the reader's words (null when the
// Engine cannot be read), for the Connect apps sheet and the sidebar's count (#201); with `agent`, that Agent's connected
// tools for its details (#204). An Owner connects one for an Agent (the answer is the vendor's https sign-in page),
// follows or cancels that sign-in, or disconnects one for an Agent or for every Agent. The Agent is named by its id only; the database says which profile is its. lib/company-apps.mjs
// checks the Owner on the server for every step. Nothing from the request or from the Engine is logged.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'appsNotAllowed'},401);
  const company=request.nextUrl.searchParams.get('company');
  if(typeof company!=='string'||!uuid.test(company)) return reply({error:'appsInvalid'},400);
  const agent=request.nextUrl.searchParams.get('agent');
  if(agent!==null&&!uuid.test(agent)) return reply({error:'appsInvalid'},400);
  if(!await routeAllowed(db,'app/api/company-apps/route.ts','GET',company,user.id)) return reply({error:'appsNotAllowed'},403);
  const {language}=await getI18n();
  return reply(agent?{tools:await agentToolItems(company,agent,language)}:{apps:await companyAppItems(company,language)});
 } catch { return reply({error:'appsFailed'},500); }
}
export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'appsNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'appsNotAllowed'},403);
  const raw=await request.text(); if(raw.length>1000) return reply({error:'appsInvalid'},400);
  const body=JSON.parse(raw);
  if(typeof body?.company!=='string'||!uuid.test(body.company)) return reply({error:'appsInvalid'},400);
  if(body.agent!==undefined&&(typeof body.agent!=='string'||!uuid.test(body.agent))) return reply({error:'appsInvalid'},400);
  if(!await routeAllowed(db,'app/api/company-apps/route.ts','POST',body.company,user.id)) return reply({error:'appsNotAllowed'},403);
  const result=await changeCompanyApp(db,{company:body.company,agent:body.agent,person:user.id,app:body.app,action:body.action});
  return reply(result.body,result.status);
 } catch { return reply({error:'appsFailed'},500); }
}
