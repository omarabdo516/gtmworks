import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';
import { encryptSecret, decryptSecret } from '@/lib/agent-crypto.mjs';
import { isHermesAddressAllowed, testHermes } from '@/lib/hermes.mjs';
import { logActionFailure } from '@/lib/diagnostics.mjs';

const columns='id,company_id,owner_id,address,profile,state,version,features,unreachable_since';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const failure=(status:number)=>reply({error:status===404?'hermesNotFound':status===403?'hermesNotAllowed':'hermesFailed'},status);

async function connectionRequest(request:NextRequest) {
 const database=await supabase(); const {data:{user}}=await database.auth.getUser();
 if(!user) return failure(401);
 const writing=request.method==='POST';
 if(writing&&(!request.headers.get('content-type')?.startsWith('application/json')||(request.headers.get('origin')&&new URL(request.headers.get('origin')!).host!==request.headers.get('host')))) return failure(403);
 const raw=writing?await request.text():''; if(raw.length>12000) return failure(400);
 const body=writing?JSON.parse(raw):Object.fromEntries(request.nextUrl.searchParams);
 const company=body.company; const id=body.id;
 if(typeof company!=='string'||!uuid.test(company)||(id!==undefined&&(typeof id!=='string'||!uuid.test(id)))) return failure(400);
 const {data:visibleCompany}=await database.from('companies').select('id').eq('id',company).maybeSingle();
 if(!visibleCompany) return failure(404);
 const {data:connections,error:readError}=await database.from('hermes_connections').select(columns).eq('company_id',company);
 if(readError) return failure(500);
 const connection=connections?.find(connection=>connection.id===id);
 if(id&&!connection) return failure(404);
 if(!writing) return reply(id?{connection}:{connections});
 // Connections are the Company's Owners' to manage (ADR 0012); RLS refuses anyone else as well.
 const {data:membership}=await database.from('members').select('role').eq('company_id',company).eq('person_id',user.id).is('removed_at',null).maybeSingle();
 if(membership?.role!=='owner') return failure(403);
 if(body.intent==='remove'&&connection) {
  const {data:removed,error}=await database.from('hermes_connections').delete().eq('id',id).select('id');
  if(error?.code==='23503') return reply({error:'hermesProfileInUse'},409);
  return error||!removed?.length?failure(500):reply({});
 }
 if(!['save','test'].includes(body.intent)||body.intent==='test'&&!connection) return failure(400);
 let address=connection?.address,profile=connection?.profile,key:string;
 if(body.intent==='save') {
  const url=new URL(body.address);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||typeof body.profile!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(body.profile)||typeof body.key!=='string'||!body.key.trim()||body.key.length>4096||/[\r\n]/.test(body.key)) return failure(400);
  if(!isHermesAddressAllowed(url.href)) return reply({error:'hermesHttpsRequired'},400);
  address=url.toString().replace(/\/$/,''); profile=body.profile; key=body.key;
 } else {
  if(!isHermesAddressAllowed(address)) return reply({error:'hermesHttpsRequired'},400);
  const server=createClient(supabaseConfig.url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
  const {data:secret,error}=await server.from('hermes_connections').select('key_encrypted').eq('id',id).single();
  if(error||!secret) return failure(500);
  key=decryptSecret(secret.key_encrypted,process.env.WEBHOOK_ENCRYPTION_KEY);
 }
 const status=await testHermes({address,profile,key});
 const unreachableSince=connection&&connection.address===address&&connection.profile===profile?connection.unreachable_since:null;
 const fields={...status,unreachable_since:status.state==='unreachable'?(unreachableSince||new Date().toISOString()):null};
 const mutation=body.intent==='save'?{...fields,address,profile,key_encrypted:encryptSecret(key,process.env.WEBHOOK_ENCRYPTION_KEY)}:fields;
 const query=connection?database.from('hermes_connections').update(mutation).eq('id',id):database.from('hermes_connections').insert({...mutation,company_id:company,owner_id:user.id});
 const {data:saved,error}=await query.select(columns).single();
 if(error?.message==='hermesProfileInUse') return reply({error:'hermesProfileInUse'},409);
 return error?failure(500):reply({connection:saved});
}

async function respond(request:NextRequest) {
 try { return await connectionRequest(request); }
 catch { logActionFailure('hermesConnection',new Error('Connection operation failed')); return failure(400); }
}
export const GET=respond;
export const POST=respond;
