import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { changeCompanyApp } from '@/lib/company-apps.mjs';

// The Company's apps (#30): an Owner connects one for an Agent (the answer is the vendor's https sign-in page), follows
// or cancels that sign-in, or disconnects one for an Agent or for every Agent. The Agent is named by its id only; the
// database says which profile is its. lib/company-apps.mjs checks the Owner on the server for every step. Nothing from
// the request or from the Engine is logged.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
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
  const service=createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const result=await changeCompanyApp(db,service,{company:body.company,agent:body.agent,person:user.id,app:body.app,action:body.action,encryptionKey:process.env.WEBHOOK_ENCRYPTION_KEY});
  return reply(result.body,result.status);
 } catch { return reply({error:'appsFailed'},500); }
}
