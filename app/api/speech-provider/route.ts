import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { changeCompanySpeech, readCompanySpeech } from '@/lib/company-speech.mjs';

// The Company's speech-to-text provider (#430): any member reads which one is set; an Owner sets one with its key or
// removes it, which lib/company-speech.mjs checks again on the server and passes straight to the Engine. The request
// carries a key, so nothing from the request, the Engine or an error is logged or answered back.
const file='app/api/speech-provider/route.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'speechNotAllowed'},401);
  const company=request.nextUrl.searchParams.get('company');
  if(typeof company!=='string'||!uuid.test(company)) return reply({error:'speechInvalid'},400);
  if(!await routeAllowed(db,file,'GET',company,user.id)) return reply({error:'speechNotAllowed'},403);
  return reply(await readCompanySpeech(db,{company}));
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
  const result=await changeCompanySpeech(db,{company:body.company,provider:body.provider,intent:body.intent,value:body.value});
  return reply(result.body,result.status);
 } catch { return reply({error:'speechInvalid'},400); }
}
