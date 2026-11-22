import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { changeProviderModel } from '@/lib/provider-models.mjs';
import { uuid } from '@/lib/conversations';

// One model of one of the Company's Providers switched on or off (#620): only an Owner, which set_provider_model checks
// again in the database. Every Member reads the switches on Settings, server side (lib/provider-models.mjs).
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'providerModelNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'providerModelNotAllowed'},403);
  const raw=await request.text(); if(raw.length>2000) return reply({error:'providerModelInvalid'},400);
  const body=JSON.parse(raw);
  if(typeof body?.company!=='string'||!uuid.test(body.company)) return reply({error:'providerModelInvalid'},400);
  if(!await routeAllowed(db,'app/api/provider-models/route.ts','POST',body.company,user.id)) return reply({error:'providerModelNotAllowed'},403);
  const result=await changeProviderModel(db,{company:body.company,entry:body.entry,model:body.model,enabled:body.enabled});
  return reply(result.body,result.status);
 } catch { return reply({error:'providerModelInvalid'},400); }
}
