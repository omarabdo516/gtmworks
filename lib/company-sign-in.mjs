import { engineOf } from './bundled-hermes.mjs';
import { readSignIns, startSignIn, pollSignIn, cancelSignIn, disconnectSignIn, signInProviders } from './hermes.mjs';

// A Company's model sign-in (#3, ADR 0014; #123, ADR 0016 Sign-in). Hermes runs it, and gtmworks only asks Hermes
// through the driver. On an install with several Companies it lives in the Company's own profile in the bundled
// Engine. On an install with one Company it lives in the Engine's root profile, which the Engine gives every Agent
// profile with no sign-in of its own. `db` is the signed-in person's own session: the database says which profiles are
// the Company's, whether the install has one Company and that the person is a member (company_engine_target), and
// is_company_owner says whether they may change it. The Engine is reached with the install's key (#342). What goes back to the browser
// is the state of each provider, and for a ChatGPT sign-in its code, its https link and the session to poll: never a
// credential, a token preview or Hermes's own error text.

const drivers={read:readSignIns,start:startSignIn,poll:pollSignIn,cancel:cancelSignIn,disconnect:disconnectSignIn};

// What the Engine's two facts mean for the Company, by kind of install. `root`: a sign-in on the root profile, which the
// Engine lends every profile with none of its own. `own`: one in the Company's profile while the root has none (the
// Engine reports a lent sign-in as logged in too, so only then is the profile's own known).
// `agent`: on one Company, one in an Agent's own profile while the root and the Company profile have none, as a
// Disconnect that stopped part way leaves it: the Owner can still remove it or connect again.
const states={
 one:{root:'connected',own:'mainAgentOnly',agent:'someAgentsOnly',none:'notConnected'},
 several:{root:'shared',own:'connected',agent:'notConnected',none:'notConnected'},
};

// Where the Company's sign-in lives, or null when it has no profile of its own in the bundled Engine yet (or, on a hosted
// install, no Engine). `profiles` are every Engine profile of the Company.
/** @param {any} db @param {string} company @param {{address:string,key:string}|null} [hermes] */
export async function signInTarget(db,company,hermes=null) {
 const {data,error}=await db.rpc('company_engine_target',{c:company});
 const target=Array.isArray(data)?data[0]:data;
 const at=(await hermes)??await engineOf(company);
 if(error||!target?.profile||!at) return null;
 const profiles=Array.isArray(target.profiles)?target.profiles.filter(name=>typeof name==='string'):[target.profile];
 return {...at,profile:target.profile,oneCompany:target.one_company===true,profiles};
}

// What a member of the Company sees: the state of ChatGPT and Claude for it. signIns is null when unknown.
/** @param {any} db @param {{company:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function readCompanySignIns(db,{company,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const target=await signInTarget(db,company,hermes);
 if(!target) return {profile:null,oneCompany:false,signIns:null};
 const read=await (driver.read||drivers.read)(target);
 const kind=states[target.oneCompany?'one':'several'];
 if(read.state!=='found') return {profile:target.profile,oneCompany:target.oneCompany,signIns:null};
 const agents=new Set();
 if(target.oneCompany&&signInProviders.some(id=>!read.signIns[id].shared&&!read.signIns[id].connected)) {
  // A profile the Engine has not made yet, or cannot read now, holds nothing this page could remove.
  for(const profile of target.profiles.filter(name=>name!==target.profile)) {
   const other=await (driver.read||drivers.read)({...target,profile});
   if(other.state==='found') for(const id of signInProviders) if(other.signIns[id].connected) agents.add(id);
  }
 }
 const signIns=Object.fromEntries(signInProviders.map(id=>{
  const found=read.signIns[id];
  return [id,{state:kind[found.shared?'root':found.connected?'own':agents.has(id)?'agent':'none'],flow:found.flow}];
 }));
 return {profile:target.profile,oneCompany:target.oneCompany,signIns};
}

// The Company's log names each connect and disconnect by its provider (record_subscription_change, Owner only). The
// Engine already did the step, so a failed write is not the step's failure.
/** @param {any} db @param {{c:string,provider:string,connected:boolean,session:string|null}} change */
async function logChange(db,change) {
 try {
  const {error}=await db.rpc('record_subscription_change',change);
  if(error) console.error('Subscription change not logged',error.code||'');
 } catch { console.error('Subscription change not logged'); }
}

// An Owner starts, follows, cancels or removes a sign-in. Returns the answer and its HTTP status.
/** @param {any} db @param {{company:string,provider:unknown,intent:unknown,session?:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function changeCompanySignIn(db,{company,provider,intent,session,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const use={...drivers,...driver};
 if(typeof provider!=='string'||!signInProviders.includes(provider)||!['start','poll','cancel','disconnect'].includes(String(intent))) return {status:400,body:{error:'signInInvalid'}};
 // Checked on the server for every step: a person who is not an active Owner of the Company changes nothing.
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 if(error||owner!==true) return {status:403,body:{error:'signInNotAllowed'}};
 const target=await signInTarget(db,company,hermes);
 if(!target) return {status:409,body:{error:'signInNoProfile'}};
 const signInAt=target.oneCompany?{...target,profile:'default'}:target;
 const failed=state=>({status:state==='unreachable'?503:502,body:{error:'signInFailed'}});
 if(intent==='start') {
  const started=await use.start(signInAt,provider);
  if(started.state==='terminal_only') return {status:409,body:target.oneCompany?{error:'signInTerminalOnly'}:{error:'signInTerminalOnly',profile:target.profile}};
  if(started.state!=='started') return failed(started.state);
  return {status:200,body:{session:started.session,code:started.code,link:started.link,expiresIn:started.expiresIn,interval:started.interval}};
 }
 if(intent==='poll'||intent==='cancel') {
  if(typeof session!=='string') return {status:400,body:{error:'signInInvalid'}};
  const result=intent==='poll'?await use.poll(signInAt,provider,session):await use.cancel(signInAt,session);
  if(['refused','unreachable','failed'].includes(result.state)) return failed(result.state);
  if(result.state==='approved') await logChange(db,{c:company,provider,connected:true,session});
  return {status:200,body:{status:result.state}};
 }
 if(!target.oneCompany) {
  const removed=await use.disconnect(target,provider);
  if(removed.state!=='disconnected') return failed(removed.state);
  await logChange(db,{c:company,provider,connected:false,session:null});
  return {status:200,body:{status:'disconnected'}};
 }
 // The root's sign-in, and any the Company's profiles still hold of their own (an older one keeps shadowing the root's
 // for its profile), and no other Company's. Each is asked even after one fails, so a removal that happened is logged.
 const removed=[];
 for(const profile of ['default',...target.profiles]) removed.push((await use.disconnect({...target,profile},provider)).state);
 if(removed.includes('disconnected')) await logChange(db,{c:company,provider,connected:false,session:null});
 const failure=removed.find(state=>state!=='disconnected'&&state!=='nothing');
 return failure?failed(failure):{status:200,body:{status:'disconnected'}};
}
