import { NextRequest, NextResponse } from 'next/server';
import { setupAdmin } from '@/lib/first-run';
import { ownerLinkInput } from '@/lib/first-run-input.mjs';
import { ownerSecretHash } from '@/lib/owner-link.mjs';
import { i18n } from '@/lib/i18n.mjs';
import { passwordProblem } from '@/lib/password.mjs';
import { supabase } from '@/lib/supabase';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import { appUrl } from '@/lib/app-origin.mjs';

// Sending a first-Owner link (#383, ADR 0019) makes the Company waiting behind it on that link's Engine record, with the
// person sending the form as its Owner, and signs them in. The link is spent by this request, never by opening the page;
// a check answers which Company waits and creates nothing. Only the link's hash is ever held here, so no log or address
// receives its secret. An email that already has an account is refused, pointing to naming that Person in the command.
const secretShape=/^[a-f0-9]{64}$/;
const refused=(language:'en'|'ar')=>new NextResponse(i18n(language).t('firstOwnerNeedsLink'),{status:410,headers:{'content-type':'text/plain; charset=utf-8'}});

export async function POST(request:NextRequest) {
 const form=await request.formData(), secret=String(form.get('code')||''), language=form.get('language')==='ar'?'ar':'en';
 if(!secretShape.test(secret)) {
  logActionFailure('first_owner_link_missing',new Error('The first-Owner link carried no secret'));
  return refused(language);
 }
 const admin=setupAdmin(), hash=ownerSecretHash(secret);
 const {data:link,error}=await admin.from('company_owner_links').select('company_name,claimed_at').eq('secret_hash',hash).maybeSingle();
 if(error) {
  logActionFailure('first_owner_link_read',error);
  throw new Error('The first-Owner link could not be read');
 }
 if(!link || link.claimed_at) {
  logActionFailure('first_owner_link_refused',new Error('The first-Owner link is unknown or already used'));
  return refused(language);
 }
 // The page asks which Company waits behind its link before it shows the form; the answer creates nothing.
 if(form.get('check')==='1') return NextResponse.json({company:link.company_name});
 const input=ownerLinkInput(form);
 // Back to the form with the secret in the fragment, as the link carries it, so the next request does not. A password
 // problem gets its own message; the password itself never leaves this request except to the auth service.
 const again=(problem:string)=>appUrl(`/first-owner?invalid=${problem}&language=${language}#code=${secret}`);
 if(!input) {
  logActionFailure('first_owner_invalid_input',new Error('Invalid first-Owner input'));
  return NextResponse.redirect(again(passwordProblem(form.get('password'),form.get('confirm') ?? '') ?? '1'),303);
 }
 const {data:created,error:createError}=await admin.auth.admin.createUser({email:input.email,password:input.password,email_confirm:true});
 if(createError || !created.user) {
  logActionFailure('first_owner_createUser',createError?{name:createError.name,code:createError.code,status:createError.status,message:createError.message.replace(/\S+@\S+/g,'[redacted]')}:new Error('Auth returned no user'));
  const exists=createError && (createError.code==='email_exists' || /already (been )?registered|already exists/i.test(createError.message));
  return NextResponse.redirect(again(exists?'emailTaken':'1'),303);
 }
 const person=created.user.id;
 const {data:slug,error:failure}=await admin.rpc('claim_company_owner_link',{link_hash:hash,person,person_name:input.name,language:input.language});
 if(failure || !slug) {
  logActionFailure(failure?'claim_company_owner_link':'first_owner_empty_slug',failure ?? new Error('The claim returned no company slug'));
  // Nothing half made: the account this request made goes with the claim that failed.
  const {error:cleanup}=await admin.auth.admin.deleteUser(person);
  if(cleanup) {
   logActionFailure('first_owner_cleanup',new Error('The Owner account cleanup failed'));
   throw new Error('The Owner account cleanup failed');
  }
  // A link spent by another send at the same moment is refused in plain words; anything else goes back to the form.
  if(failure?.code==='55000' || /ownerLinkUsed/.test(failure?.message ?? '')) return refused(language);
  return NextResponse.redirect(again('1'),303);
 }
 // The Owner is signed in with the password just chosen, so no email step is needed. Should that fail, the Company is
 // made and the sign-in page opens on its home.
 const next=`/c/${slug}/home`, db=await supabase();
 const {error:signIn}=await db.auth.signInWithPassword({email:input.email,password:input.password});
 if(signIn) {
  logActionFailure('first_owner_signIn',{name:signIn.name,code:signIn.code,status:signIn.status,message:signIn.message.replace(/\S+@\S+/g,'[redacted]')});
  return NextResponse.redirect(appUrl(`/sign-in?next=${encodeURIComponent(next)}&language=${input.language}`),303);
 }
 return NextResponse.redirect(appUrl(next),303);
}
