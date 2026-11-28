import { NextRequest, NextResponse } from 'next/server';
import { setupAdmin } from '@/lib/first-run';
import { linkSecretHash, linkSecretShape } from '@/lib/company-link.mjs';
import { i18n } from '@/lib/i18n.mjs';
import { passwordProblem } from '@/lib/password.mjs';
import { supabase } from '@/lib/supabase';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import { appUrl } from '@/lib/app-origin.mjs';
import { cappedForm } from '@/lib/request-body.mjs';
import { verifySecondStep } from '@/lib/second-step';

// Sending a password link's form (#954, ADR 0019) sets the Member's new password, ends their other sessions and signs
// this browser in. The link is spent by this request, in claim_password_link's one transaction, never by opening the
// page: the page's check (check=1) only asks whether it is open, so a link preview fetching the page uses nothing. Only
// the link's hash is held here, so no log or address receives its secret.
const refusal=(language:'en'|'ar',key:string,status:number)=>new NextResponse(i18n(language).t(key),{status,headers:{'content-type':'text/plain; charset=utf-8'}});
const redacted=(error:{name:string,code?:string,status?:number,message:string})=>({name:error.name,code:error.code,status:error.status,message:error.message.replace(/\S+@\S+/g,'[redacted]')});

export async function POST(request:NextRequest) {
 // The form is read only up to its limit (#778): a larger body is refused before it is read.
 const form=await cappedForm(request,16000);
 if(!form) return new NextResponse(null,{status:413});
 const secret=String(form.get('code')||''), language=form.get('language')==='ar'?'ar':'en';
 if(!linkSecretShape.test(secret)) {
  logActionFailure('password_link_missing',new Error('The password link carried no secret'));
  return refusal(language,'passwordLinkNeedsNew',410);
 }
 const admin=setupAdmin(), hash=linkSecretHash(secret);
 const {data:open,error}=await admin.rpc('password_link_open',{link_hash:hash});
 if(error) {
  logActionFailure('password_link_read',error);
  throw new Error('The password link could not be read');
 }
 const link=(open as {company:string,person_name:string,email:string,two_step:boolean}[]|null)?.[0];
 if(!link) {
  logActionFailure('password_link_refused',new Error('The password link is unknown, used, cancelled or ended'));
  // The page's own check gets a refusal it reads; a sent form opens the page's clear refusal.
  return form.get('check')==='1'?refusal(language,'passwordLinkNeedsNew',410):NextResponse.redirect(appUrl(`/password?language=${language}`),303);
 }
 // The page asks whose password waits behind its link before it shows the form; the answer changes nothing.
 if(form.get('check')==='1') return NextResponse.json({company:link.company,person:link.person_name,email:link.email,twoStep:link.two_step===true});
 const password=form.get('password'), problem=passwordProblem(password,form.get('confirm') ?? '');
 // Back to the form with the secret in the fragment, as the link carries it, so the next request does not.
 const again=(invalid:string)=>NextResponse.redirect(appUrl(`/password?invalid=${invalid}&language=${language}#code=${secret}`),303);
 if(problem || typeof password!=='string') return again(problem ?? 'passwordTooShort');
 // A password link never goes around the second step (Omar, #954): with a verified authenticator, its code is checked
 // by the auth service before the link is spent, so a wrong code sets nothing and the link stays usable.
 if(link.two_step) {
  const code=String(form.get('verification') ?? '').replace(/\s+/g,'');
  if(!code) return again('passwordNeedsVerificationCode');
  const step=await verifySecondStep(admin,link.email,code);
  if(step==='failed') {
   logActionFailure('password_link_second_step',new Error('The second step could not be checked'));
   throw new Error('The second step could not be checked');
  }
  if(step==='refused') return again('passwordLinkCodeRefused');
 }
 const {data:claimed,error:failure}=await admin.rpc('claim_password_link',{link_hash:hash});
 const member=(claimed as {person:string,email:string,slug:string}[]|null)?.[0];
 if(failure || !member) {
  logActionFailure(failure?'claim_password_link':'password_link_empty_claim',failure ?? new Error('The claim returned no Member'));
  // A link spent by another send at the same moment, or one whose Member left, opens the page's clear refusal: the
  // address carries no secret, so the page says the link can't be used and whom to ask.
  if(!failure || failure.code==='55000') return NextResponse.redirect(appUrl(`/password?language=${language}`),303);
  throw new Error('The password link could not be claimed');
 }
 // The claim has ended every session of the Member; the new password is set by the server's own key.
 const {error:saveError}=await admin.auth.admin.updateUserById(member.person,{password});
 if(saveError) {
  logActionFailure('password_link_save',redacted(saveError));
  return refusal(language,'passwordLinkSaveFailed',500);
 }
 // The Member is signed in with the password just chosen. Should that fail, the password is saved and the sign-in page
 // opens on the Company's home.
 const next=`/c/${member.slug}/home`, db=await supabase();
 const {error:signIn}=await db.auth.signInWithPassword({email:member.email,password});
 if(signIn) {
  logActionFailure('password_link_signIn',redacted(signIn));
  return NextResponse.redirect(appUrl(`/sign-in?next=${encodeURIComponent(next)}&language=${language}`),303);
 }
 return NextResponse.redirect(appUrl(next),303);
}
