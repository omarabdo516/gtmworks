import { NextRequest, NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { setupAdmin, setupIsOpen } from '@/lib/first-run';
import { firstRunInput } from '@/lib/first-run-input.mjs';
import { supabase } from '@/lib/supabase';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import { appUrl } from '@/lib/app-origin.mjs';

export async function POST(request:NextRequest) {
 if(!await setupIsOpen()) {
  logActionFailure('first_run_setup_closed',new Error('Setup closed at start'));
  notFound();
 }
 const form=await request.formData(), input=firstRunInput(form);
 const invalid=appUrl(`/first-run?invalid=1&language=${form.get('language')==='ar'?'ar':'en'}`);
 if(!input) {
  logActionFailure('first_run_invalid_input',new Error('Invalid setup input'));
  return NextResponse.redirect(invalid,303);
 }
 const admin=setupAdmin();
 const {data:created,error}=await admin.auth.admin.createUser({email:input.email,email_confirm:true});
 if(error || !created.user) {
  logActionFailure('first_run_createUser',error?{name:error.name,code:error.code,status:error.status,message:error.message.replace(/\S+@\S+/g,'[redacted]')}:new Error('Auth returned no user'));
  if(!await setupIsOpen()) {
   logActionFailure('first_run_setup_closed_after_createUser',new Error('Setup closed after Auth failure'));
   notFound();
  }
  return NextResponse.redirect(invalid,303);
 }
 const id=created.user.id;
 const {data:slug,error:failure}=await admin.rpc('complete_setup',{person:id,person_name:input.name,company_name:input.company,language:input.language});
 if(failure || !slug) {
  logActionFailure(failure?'complete_setup':'first_run_empty_slug',failure ?? new Error('Setup returned no company slug'));
  const {error:cleanup}=await admin.auth.admin.deleteUser(id);
  if(cleanup) {
   logActionFailure('first_run_cleanup',new Error('Setup account cleanup failed'));
   throw new Error('Setup account cleanup failed');
  }
  notFound();
 }
 const next=`/c/${slug}/home`, db=await supabase();
 const {error:mail}=await db.auth.signInWithOtp({email:input.email,options:{shouldCreateUser:false,emailRedirectTo:appUrl(`/auth/callback?next=${encodeURIComponent(next)}`).href}});
 return NextResponse.redirect(appUrl(`/sign-in?next=${encodeURIComponent(next)}&message=${mail?'failed':'sent'}&language=${input.language}`),303);
}
