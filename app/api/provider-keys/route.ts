import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { changeCompanyKey, readCompanyKeys } from '@/lib/provider-keys.mjs';

// A Company's model-provider API key (#124): any member reads which providers take a key and whether one is set; an
// Owner sets or removes one, which lib/provider-keys.mjs checks again on the server and passes straight to the Engine.
// The request carries a key, so nothing from the request, the Engine or an error is logged or answered back.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const service=()=>createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
export async function GET(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'keyNotAllowed'},401);
  const company=request.nextUrl.searchParams.get('company');
  if(typeof company!=='string'||!uuid.test(company)) return reply({error:'keyInvalid'},400);
  if(!await routeAllowed(db,'app/api/provider-keys/route.ts','GET',company,user.id)) return reply({error:'keyNotAllowed'},403);
  return reply(await readCompanyKeys(db,service(),{company,encryptionKey:process.env.WEBHOOK_ENCRYPTION_KEY}));
 } catch { return reply({error:'keyFailed'},502); }
}
export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'keyNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'keyNotAllowed'},403);
  const raw=await request.text(); if(raw.length>8000) return reply({error:'keyInvalid'},400);
  const body=JSON.parse(raw);
  if(typeof body?.company!=='string'||!uuid.test(body.company)) return reply({error:'keyInvalid'},400);
  if(!await routeAllowed(db,'app/api/provider-keys/route.ts','POST',body.company,user.id)) return reply({error:'keyNotAllowed'},403);
  const result=await changeCompanyKey(db,service(),{company:body.company,provider:body.provider,intent:body.intent,value:body.value,encryptionKey:process.env.WEBHOOK_ENCRYPTION_KEY});
  return reply(result.body,result.status);
 } catch { return reply({error:'keyInvalid'},400); }
}
