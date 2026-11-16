import { appUrl } from './app-origin.mjs';
import { appByKey } from './app-catalogue.mjs';
import { signInTarget } from './company-sign-in.mjs';
import { readApps, startAppSignIn, pollAppSignIn, cancelAppSignIn, finishAppSignIn, disconnectApp } from './hermes.mjs';

// A Company's apps (#30), kept in its own profile in the bundled Engine, as its model sign-in is (lib/company-sign-in.mjs):
// `db` is the signed-in person's own session, which says which profile is the Company's and whether they are its Owner;
// `service` only reads the key of the Company's bundled Connection. The browser gets each app's state and, to connect,
// the vendor's https sign-in page; the Engine's flow stays on the server, kept as the person's own sign-in in the
// database, and nothing the Engine says beyond a state is passed on.

const drivers={read:readApps,start:startAppSignIn,poll:pollAppSignIn,cancel:cancelAppSignIn,finish:finishAppSignIn,disconnect:disconnectApp};
const actions=['connect','poll','cancel','disconnect'];
// Where the vendor sends the person back: gtmworks's own address, never the Engine's private listener.
const callbackOf=key=>appUrl(`/api/apps/callback/${key}`).href;

// The newest sign-in of an app the person started in a Company, or in any Company; `open` keeps only those not yet
// finished. Row-level security shows a person only the sign-ins of Companies they are an Owner of.
/** @param {any} db @param {{app:string,person?:string,company?:string,open?:boolean}} filter */
async function latestSignIn(db,{app,person,company,open}) {
 let request=db.from('company_app_sign_ins').select('company_id,flow_id,finished_at,companies(slug)').eq('app',app);
 if(person) request=request.eq('started_by',person);
 if(company) request=request.eq('company_id',company);
 if(open) request=request.is('finished_at',null);
 const {data,error}=await request.order('started_at',{ascending:false}).limit(1).maybeSingle();
 return error?null:data;
}

// What a member who sees the section reads: the apps the Engine offers the Company, each with its state. null when the
// Company has no profile of its own in the bundled Engine, or the Engine does not answer.
/** @param {any} db @param {any} service @param {{company:string,encryptionKey:string|undefined,driver?:Partial<typeof drivers>}} request */
export async function readCompanyApps(db,service,{company,encryptionKey,driver={}}) {
 const target=await signInTarget(db,service,company,encryptionKey);
 if(!target) return null;
 const read=await (driver.read||drivers.read)(target);
 return read.state==='found'?read.apps:null;
}

// An Owner connects, follows, cancels or disconnects an app. Returns the answer and its HTTP status.
/** @param {any} db @param {any} service @param {{company:string,person:string,app:unknown,action:unknown,encryptionKey:string|undefined,driver?:Partial<typeof drivers>}} request */
export async function changeCompanyApp(db,service,{company,person,app,action,encryptionKey,driver={}}) {
 const use={...drivers,...driver};
 const entry=appByKey(app);
 if(!entry||!actions.includes(String(action))) return {status:400,body:{error:'appsInvalid'}};
 const key=entry.key;
 // Checked on the server for every step: a person who is not an active Owner of the Company changes nothing.
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 if(error||owner!==true) return {status:403,body:{error:'appsNotAllowed'}};
 const target=await signInTarget(db,service,company,encryptionKey);
 if(!target) return {status:409,body:{error:'appsNoEngine'}};
 const failed=state=>({status:state==='unreachable'?503:502,body:{error:'appsFailed'}});
 if(action==='connect') {
  // A person has one open sign-in per app, in whichever Company they start it: the vendor's way back then always
  // matches it. An earlier one left open (its window closed), here or in another Company, gives way to the new one;
  // start_app_sign_in forgets it.
  const open=await latestSignIn(db,{app:key,person,open:true});
  if(open) { const before=open.company_id===company?target:await signInTarget(db,service,open.company_id,encryptionKey); if(before) await use.cancel(before,open.flow_id); }
  const started=await use.start(target,key,callbackOf(key));
  if(started.state==='busy') return {status:409,body:{error:'appsBusy'}};
  if(started.state!=='started') return failed(started.state);
  const kept=await db.rpc('start_app_sign_in',{c:company,app_key:key,flow:started.flow});
  if(kept.error) { await use.cancel(target,started.flow); return {status:403,body:{error:'appsNotAllowed'}}; }
  return {status:200,body:{url:started.url}};
 }
 if(action==='disconnect') {
  const removed=await use.disconnect(target,key);
  if(removed.state!=='disconnected') return failed(removed.state);
  const logged=await db.rpc('record_app_disconnected',{c:company,app_key:key});
  if(logged.error) throw logged.error;
  return {status:200,body:{status:'off'}};
 }
 // A sign-in is closed only when it connected (finish_app_sign_in), here or by the vendor's way back.
 const open=await latestSignIn(db,{app:key,person,company});
 if(!open) return {status:200,body:{status:action==='poll'?'failed':'cancelled'}};
 if(open.finished_at) return {status:200,body:{status:'connected'}};
 if(action==='cancel') {
  const cancelled=await use.cancel(target,open.flow_id);
  return cancelled.state==='cancelled'?{status:200,body:{status:'cancelled'}}:failed(cancelled.state);
 }
 const polled=await use.poll(target,open.flow_id);
 if(polled.state==='approved') {
  const finished=await db.rpc('finish_app_sign_in',{app_key:key,flow:open.flow_id});
  if(finished.error) throw finished.error;
  return {status:200,body:{status:'connected'}};
 }
 if(polled.state==='waiting') return {status:200,body:{status:'waiting'}};
 return ['refused','unreachable'].includes(polled.state)?failed(polled.state):{status:200,body:{status:'failed'}};
}

// The vendor sent the person back to gtmworks (/api/apps/callback/<app>). The answer goes on to the Engine only for an
// open sign-in of that app the person started, in a Company they are still an Owner of; the connect is then logged once.
// Returns where to send the person: the Company's slug (null when no sign-in of theirs is known) and the outcome.
/** @param {any} db @param {any} service @param {{person:string,app:string,answer:Record<string,string>,encryptionKey:string|undefined,driver?:Partial<typeof drivers>}} request */
export async function finishCompanyAppSignIn(db,service,{person,app,answer,encryptionKey,driver={}}) {
 const use={...drivers,...driver};
 const entry=appByKey(app);
 // Only an open sign-in is matched: the answer of a sign-in that was replaced or already finished is never applied to
 // another one.
 const open=entry?await latestSignIn(db,{app:entry.key,person,open:true}):null;
 if(!entry||!open) return {slug:null,outcome:'failed'};
 const slug=typeof open.companies?.slug==='string'?open.companies.slug:null;
 const target=await signInTarget(db,service,open.company_id,encryptionKey);
 if(!target) return {slug,outcome:'failed'};
 const finished=await use.finish(target,{key:entry.key,flow:open.flow_id,answer});
 if(finished.state==='approved') {
  const logged=await db.rpc('finish_app_sign_in',{app_key:entry.key,flow:open.flow_id});
  if(logged.error) throw logged.error;
  return {slug,outcome:'connected'};
 }
 return {slug,outcome:finished.state==='waiting'?'waiting':'failed'};
}
