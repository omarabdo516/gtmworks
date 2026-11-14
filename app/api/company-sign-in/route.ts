import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { changeCompanySignIn } from '@/lib/company-sign-in.mjs';

// The Company's model sign-in (#3): an Owner starts a ChatGPT sign-in in the Company's own Hermes profile, follows it,
// cancels it or disconnects. lib/company-sign-in.mjs checks the Owner on the server for every step; the answer holds
// only states, the code and the link. Nothing from the request or from Hermes is logged.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'signInNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'signInNotAllowed'},403);
  const raw=await request.text(); if(raw.length>1000) return reply({error:'signInInvalid'},400);
  const body=JSON.parse(raw);
  if(typeof body?.company!=='string'||!uuid.test(body.company)) return reply({error:'signInInvalid'},400);
  const service=createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const result=await changeCompanySignIn(db,service,{company:body.company,provider:body.provider,intent:body.intent,session:body.session,encryptionKey:process.env.WEBHOOK_ENCRYPTION_KEY});
  return reply(result.body,result.status);
 } catch { return reply({error:'signInInvalid'},400); }
}
