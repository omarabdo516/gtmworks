import { NextRequest, NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { setupAdmin, setupIsOpen } from '@/lib/first-run';
import { firstRunInput } from '@/lib/first-run-input.mjs';
import { setupCodeMatches } from '@/lib/setup-code.mjs';
import { i18n } from '@/lib/i18n.mjs';
import { supabase } from '@/lib/supabase';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import { appUrl } from '@/lib/app-origin.mjs';

export async function POST(request:NextRequest) {
 if(!await setupIsOpen()) {
  logActionFailure('first_run_setup_closed',new Error('Setup closed at start'));
  notFound();
 }
 const form=await request.formData(), input=firstRunInput(form), code=form.get('code'), language=form.get('language')==='ar'?'ar':'en';
 // Only the link the installer printed opens setup (issue #50): nothing is created without its code.
 if(!setupCodeMatches(code)) {
  logActionFailure('first_run_wrong_code',new Error('Setup code missing or wrong'));
  return new NextResponse(i18n(language).t('setupNeedsLink'),{status:403,headers:{'content-type':'text/plain; charset=utf-8'}});
 }
 // Back to the form with the code in the fragment, as the setup link carries it, so the next request does not.
 const invalid=appUrl(`/first-run?invalid=1&language=${language}#code=${code}`);
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
