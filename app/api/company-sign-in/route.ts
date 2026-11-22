import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { changeCompanySignIn } from '@/lib/company-sign-in.mjs';

// The Company's model sign-in (#3; #384, ADR 0018): an Owner starts a ChatGPT sign-in on the root profile of the
// Company's own Engine, follows it, cancels it or disconnects, all of a provider or one account of it (#618).
// lib/company-sign-in.mjs checks the Owner on the server for every step; the answer holds only states, the code and
// the link. Nothing from the request or from Hermes is logged.
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
  if(!await routeAllowed(db,'app/api/company-sign-in/route.ts','POST',body.company,user.id)) return reply({error:'signInNotAllowed'},403);
  const result=await changeCompanySignIn(db,{company:body.company,provider:body.provider,intent:body.intent,session:body.session,account:body.account});
  return reply(result.body,result.status);
 } catch { return reply({error:'signInInvalid'},400); }
}
