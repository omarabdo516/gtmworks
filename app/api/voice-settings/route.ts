import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { changeCompanyVoice, readCompanyVoice } from '@/lib/company-speech.mjs';

// Settings → Voice (#863): the Company's speech-to-text options, Hermes's own `stt` options. The Owner and the Managers
// read them; only an Owner changes them, which lib/company-speech.mjs checks again before it writes every profile.
const file='app/api/voice-settings/route.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'speechNotAllowed'},401);
  const company=request.nextUrl.searchParams.get('company');
  if(typeof company!=='string'||!uuid.test(company)) return reply({error:'speechInvalid'},400);
  if(!await routeAllowed(db,file,'GET',company,user.id)) return reply({error:'speechNotAllowed'},403);
  return reply({data:await readCompanyVoice(db,{company}),readAt:Date.now()});
 } catch { return reply({error:'speechFailed'},502); }
}
export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'speechNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'speechNotAllowed'},403);
  const raw=await request.text(); if(raw.length>8000) return reply({error:'speechInvalid'},400);
  const body=JSON.parse(raw);
  if(typeof body?.company!=='string'||!uuid.test(body.company)) return reply({error:'speechInvalid'},400);
  if(!await routeAllowed(db,file,'POST',body.company,user.id)) return reply({error:'speechNotAllowed'},403);
  const result=await changeCompanyVoice(db,{company:body.company,language:body.language,model:body.model,prompt:body.prompt,trimSilence:body.trimSilence});
  // `savedAt` holds the choice on the page until it reads itself again after that time (app/settings-saved.ts, #663).
  return reply(result.status===200?{...result.body,savedAt:Date.now()}:result.body,result.status);
 } catch { return reply({error:'speechInvalid'},400); }
}
