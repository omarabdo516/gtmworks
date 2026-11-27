import { NextRequest, NextResponse } from 'next/server';
import { setupAdmin } from '@/lib/first-run';
import { inviteLinkInput } from '@/lib/first-run-input.mjs';
import { linkSecretHash, linkSecretShape } from '@/lib/company-link.mjs';
import { i18n } from '@/lib/i18n.mjs';
import { passwordProblem } from '@/lib/password.mjs';
import { supabase } from '@/lib/supabase';
import { logActionFailure } from '@/lib/diagnostics.mjs';
import { appUrl } from '@/lib/app-origin.mjs';
import { cappedForm } from '@/lib/request-body.mjs';

// Sending an Invite link's form (#950, ADR 0019) makes the new Person's account, makes them a Member of the link's
// Company with its Role and Agents, and signs them in. The link is spent by this request, in claim_invite_link's one
// transaction, never by opening the page: the page's check (check=1) only asks whether it is open, so a link preview
// fetching the page uses nothing. Only the link's hash is held here, so no log or address receives its secret.
const refused=(language:'en'|'ar')=>new NextResponse(i18n(language).t('inviteLinkNeedsNew'),{status:410,headers:{'content-type':'text/plain; charset=utf-8'}});
const redacted=(error:{name:string,code?:string,status?:number,message:string})=>({name:error.name,code:error.code,status:error.status,message:error.message.replace(/\S+@\S+/g,'[redacted]')});

export async function POST(request:NextRequest) {
 // The form is read only up to its limit (#778): a larger body is refused before it is read.
 const form=await cappedForm(request,16000);
 if(!form) return new NextResponse(null,{status:413});
 const secret=String(form.get('code')||''), language=form.get('language')==='ar'?'ar':'en';
 if(!linkSecretShape.test(secret)) {
  logActionFailure('invite_link_missing',new Error('The Invite link carried no secret'));
  return refused(language);
 }
 const admin=setupAdmin(), hash=linkSecretHash(secret);
 const {data:open,error}=await admin.rpc('invite_link_open',{link_hash:hash});
 if(error) {
  logActionFailure('invite_link_read',error);
  throw new Error('The Invite link could not be read');
 }
 const link=(open as {company:string,role:string}[]|null)?.[0];
 if(!link) {
  logActionFailure('invite_link_refused',new Error('The Invite link is unknown, used, cancelled or ended'));
  return refused(language);
 }
 // The page asks which Company and Role wait behind its link before it shows the form; the answer changes nothing.
 if(form.get('check')==='1') return NextResponse.json({company:link.company,role:link.role});
 const input=inviteLinkInput(form);
 // Back to the form with the secret in the fragment, as the link carries it, so the next request does not.
 const again=(problem:string)=>appUrl(`/join?invalid=${problem}&language=${language}#code=${secret}`);
 if(!input) {
  logActionFailure('invite_link_invalid_input',new Error('Invalid Invite link input'));
  return NextResponse.redirect(again(passwordProblem(form.get('password'),form.get('confirm') ?? '') ?? '1'),303);
 }
 // Sign-ups stay off: the server's own key makes the account, confirmed, as first run does.
 const {data:created,error:createError}=await admin.auth.admin.createUser({email:input.email,password:input.password,email_confirm:true});
 if(createError || !created.user) {
  logActionFailure('invite_link_createUser',createError?redacted(createError):new Error('Auth returned no user'));
  const exists=createError && (createError.code==='email_exists' || /already (been )?registered|already exists/i.test(createError.message));
  return NextResponse.redirect(again(exists?'emailTaken':'1'),303);
 }
 const person=created.user.id;
 const {data:slug,error:failure}=await admin.rpc('claim_invite_link',{link_hash:hash,person,person_name:input.name,language:input.language});
 if(failure || !slug) {
  logActionFailure(failure?'claim_invite_link':'invite_link_empty_slug',failure ?? new Error('The claim returned no company slug'));
  // Nothing half made: the account this request made goes with the claim that failed.
  const {error:cleanup}=await admin.auth.admin.deleteUser(person);
  if(cleanup) {
   logActionFailure('invite_link_cleanup',new Error('The new account cleanup failed'));
   throw new Error('The new account cleanup failed');
  }
  // A link spent by another send at the same moment is refused in plain words; anything else goes back to the form.
  if(failure?.code==='55000') return refused(language);
  return NextResponse.redirect(again('1'),303);
 }
 // The new Member is signed in with the password just chosen. Should that fail, they are a Member and the sign-in page
 // opens on the Company's home.
 const next=`/c/${slug}/home`, db=await supabase();
 const {error:signIn}=await db.auth.signInWithPassword({email:input.email,password:input.password});
 if(signIn) {
  logActionFailure('invite_link_signIn',redacted(signIn));
  return NextResponse.redirect(appUrl(`/sign-in?next=${encodeURIComponent(next)}&language=${input.language}`),303);
 }
 return NextResponse.redirect(appUrl(next),303);
}
