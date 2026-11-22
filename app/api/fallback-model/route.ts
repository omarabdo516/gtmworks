import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { changeFallbackModel } from '@/lib/fallback-model.mjs';
import { uuid } from '@/lib/conversations';

// The Company's Fallback model, or None (#622): only an Owner, which set_company_fallback_model checks again in the
// database. Every Member reads it on Settings, server side. The kept choice goes to every profile the Company's Agents
// run on at once (lib/fallback-model.mjs); one the Engine did not take now is named, and the worker gives it later.
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'fallbackNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'fallbackNotAllowed'},403);
  const raw=await request.text(); if(raw.length>2000) return reply({error:'fallbackInvalid'},400);
  const body=JSON.parse(raw);
  if(typeof body?.company!=='string'||!uuid.test(body.company)||!(body.value===null||typeof body.value==='string')) return reply({error:'fallbackInvalid'},400);
  if(!await routeAllowed(db,'app/api/fallback-model/route.ts','POST',body.company,user.id)) return reply({error:'fallbackNotAllowed'},403);
  const result=await changeFallbackModel(db,{company:body.company,value:body.value});
  return reply(result.body,result.status);
 } catch { return reply({error:'fallbackInvalid'},400); }
}
