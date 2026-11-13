import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { crossSiteWrite } from '@/lib/app-origin.mjs';

// The Owner renames the Company from Settings (#26). The request runs as the signed-in person, and the database
// function checks that they are an active Owner of that Company (rename_company), so another Role is refused here
// whatever the page showed them.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest) {
 try {
  const db=await supabase(); const {data:{user}}=await db.auth.getUser();
  if(!user) return reply({error:'companyRenameNotAllowed'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json')||crossSiteWrite(request.headers)) return reply({error:'companyRenameNotAllowed'},403);
  const raw=await request.text(); if(raw.length>1000) return reply({error:'companyNameInvalid'},400);
  const body=JSON.parse(raw);
  if(typeof body.company!=='string'||!uuid.test(body.company)||typeof body.name!=='string') return reply({error:'companyNameInvalid'},400);
  const {data:name,error}=await db.rpc('rename_company',{c:body.company,company_name:body.name});
  if(error) return error.code==='42501'?reply({error:'companyRenameNotAllowed'},403):reply({error:'companyNameInvalid'},400);
  return reply({name});
 } catch { return reply({error:'companyNameInvalid'},400); }
}
