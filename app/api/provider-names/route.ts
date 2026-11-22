import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';
import { routeAllowed } from '@/lib/route-permissions.mjs';
import { renameProvider } from '@/lib/provider-names.mjs';

// The name the Owner gives one of the Company's Providers (#618): a subscription account or a key. lib/provider-names.mjs
// checks the input and rename_provider checks the Owner again in the database. The answer holds only the name kept.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'providerNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'providerNotAllowed'},403);
  const raw=await request.text(); if(raw.length>2000) return reply({error:'providerNameInvalid'},400);
  const body=JSON.parse(raw);
  if(typeof body?.company!=='string'||!uuid.test(body.company)) return reply({error:'providerNameInvalid'},400);
  if(!await routeAllowed(db,'app/api/provider-names/route.ts','POST',body.company,user.id)) return reply({error:'providerNotAllowed'},403);
  const result=await renameProvider(db,{company:body.company,provider:body.provider,account:body.account,name:body.name});
  return reply(result.body,result.status);
 } catch { return reply({error:'providerNameInvalid'},400); }
}
