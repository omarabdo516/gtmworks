import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { companyHermesHome, hermesSignIn, signInProviders } from '@/lib/hermes-sign-in.mjs';
import { logActionFailure } from '@/lib/diagnostics.mjs';

// A company's Owner (or the Agency) connects the company's own ChatGPT or Claude subscription through Hermes's own
// sign-in, in that company's Hermes home (#3). Only the state, the link and the code leave this route; the credential
// stays in the home and is never read here. A Claude sign-in is finished with the authorization code the Owner pastes
// (`complete`), which is passed to Hermes and nothing else.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
const failure=(status:number)=>reply({error:status===403?'subscriptionOwnerOnly':status===503?'subscriptionUnavailable':'subscriptionFailed'},status);

async function signInRequest(request:NextRequest) {
 const database=await supabase(); const {data:{user}}=await database.auth.getUser();
 if(!user) return failure(401);
 const writing=request.method==='POST';
 if(writing&&(!request.headers.get('content-type')?.startsWith('application/json')||(request.headers.get('origin')&&new URL(request.headers.get('origin')!).host!==request.headers.get('host')))) return failure(403);
 const raw=writing?await request.text():''; if(raw.length>2000) return failure(400);
 const body=writing?JSON.parse(raw):Object.fromEntries(request.nextUrl.searchParams);
 const company=body.company;
 if(typeof company!=='string'||!uuid.test(company)) return failure(400);
 // The caller's own company only (ADR 0004), and only its Owner or the Agency.
 const {data:visibleCompany}=await database.from('companies').select('id').eq('id',company).maybeSingle();
 if(!visibleCompany) return failure(404);
 const {data:membership}=await database.from('members').select('role').eq('company_id',company).eq('person_id',user.id).is('removed_at',null).maybeSingle();
 const {data:agency}=await database.rpc('agency_access');
 if(membership?.role!=='owner'&&!agency) return failure(403);
 const home=companyHermesHome(company);
 if(!home) return failure(503);
 const signIn=hermesSignIn({home});
 if(!writing) return reply({providers:Object.fromEntries(await Promise.all(signInProviders.map(async provider=>[provider,await signIn.state(provider)])))});
 if(!signInProviders.includes(body.provider)||!['connect','disconnect','complete'].includes(body.intent)) return failure(400);
 // The pasted authorization code goes only to the waiting sign-in's input; it is not kept, logged or sent back.
 const state=body.intent==='connect'?await signIn.start(body.provider):body.intent==='complete'?await signIn.complete(body.provider,body.authorizationCode):await signIn.disconnect(body.provider);
 if(state.state==='failed') return body.intent==='complete'?reply({error:'subscriptionCodeRejected'},502):failure(502);
 return reply({provider:body.provider,...state});
}

async function respond(request:NextRequest) {
 try { return await signInRequest(request); }
 catch { logActionFailure('subscriptionSignIn',new Error('Subscription sign-in operation failed')); return failure(400); }
}
export const GET=respond;
export const POST=respond;
