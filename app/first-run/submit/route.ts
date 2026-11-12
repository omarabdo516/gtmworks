import { NextRequest, NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { setupAdmin, setupIsOpen } from '@/lib/first-run';
import { firstRunInput } from '@/lib/first-run-input.mjs';
import { setupCodeMatches } from '@/lib/setup-code.mjs';
import { i18n } from '@/lib/i18n.mjs';
import { passwordProblem } from '@/lib/password.mjs';
import { supabase } from '@/lib/supabase';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import { appUrl } from '@/lib/app-origin.mjs';

export async function POST(request:NextRequest) {
 if(!await setupIsOpen()) {
  logActionFailure('first_run_setup_closed',new Error('Setup closed at start'));
  notFound();
 }
 const form=await request.formData(), code=form.get('code'), language=form.get('language')==='ar'?'ar':'en';
 // Only the link the installer printed opens setup (issue #50): nothing is created without its code.
 if(!setupCodeMatches(code)) {
  logActionFailure('first_run_wrong_code',new Error('Setup code missing or wrong'));
  return new NextResponse(i18n(language).t('setupNeedsLink'),{status:403,headers:{'content-type':'text/plain; charset=utf-8'}});
 }
 // The page asks whether its link's code is right before it shows the form; the answer creates nothing.
 if(form.get('check')==='1') return new NextResponse(null,{status:204});
 const input=firstRunInput(form);
 // Back to the form with the code in the fragment, as the setup link carries it, so the next request does not.
 // A password problem gets its own message; the password itself never leaves this request except to the auth service.
 const invalid=appUrl(`/first-run?invalid=${passwordProblem(form.get('password'),form.get('confirm') ?? '') ?? '1'}&language=${language}#code=${code}`);
 if(!input) {
  logActionFailure('first_run_invalid_input',new Error('Invalid setup input'));
  return NextResponse.redirect(invalid,303);
 }
 const admin=setupAdmin();
 const {data:created,error}=await admin.auth.admin.createUser({email:input.email,password:input.password,email_confirm:true});
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
 // The Owner is signed in with the password just chosen, so no email step is needed. Should that fail, setup is still done
 // and the sign-in page opens on the new Company's home.
 const next=`/c/${slug}/home`, db=await supabase();
 const {error:signIn}=await db.auth.signInWithPassword({email:input.email,password:input.password});
 if(signIn) {
  logActionFailure('first_run_signIn',{name:signIn.name,code:signIn.code,status:signIn.status,message:signIn.message.replace(/\S+@\S+/g,'[redacted]')});
  return NextResponse.redirect(appUrl(`/sign-in?next=${encodeURIComponent(next)}&language=${input.language}`),303);
 }
 return NextResponse.redirect(appUrl(next),303);
}
