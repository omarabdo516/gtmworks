import { engineOf } from './company-engine.mjs';
import { accountId, forgetProviderName } from './provider-names.mjs';
import { readSignIns, startSignIn, pollSignIn, cancelSignIn, disconnectSignIn, readSubscriptionAccounts, removeSubscriptionAccount, signInProviders } from './hermes.mjs';

// A Company's model sign-in (#3; #384, ADR 0018). It lives on the root profile of the Company's own Engine, and the
// Engine gives it to every Agent profile of that Company with none of its own. `db` is the signed-in person's own
// session: the database says which profiles are the Company's (company_engine_target) and is_company_owner says whether
// they may change it. The Engine is reached with the key of the Company's Engine record (#380). What goes back to the
// browser is the state of each provider, and for a ChatGPT sign-in its code, its https link and the session to poll:
// never a credential, a token preview or Hermes's own error text.

const drivers={read:readSignIns,start:startSignIn,poll:pollSignIn,cancel:cancelSignIn,disconnect:disconnectSignIn,accounts:readSubscriptionAccounts,removeAccount:removeSubscriptionAccount};
const root='default';

// Where the Company's sign-in lives: the Engine of the Company and its root profile. `profiles` are every Engine profile
// of the Company, the Company's own first, so a Disconnect can remove an older sign-in an earlier version left in one of
// them. Null when the person is no Member of the Company, or the Company has no Engine this install can reach.
/** @param {any} db @param {string} company @param {{address:string,key:string}|null} [hermes] */
export async function signInTarget(db,company,hermes=null) {
 const {data,error}=await db.rpc('company_engine_target',{c:company});
 const target=Array.isArray(data)?data[0]:data;
 const at=(await hermes)??await engineOf(company);
 if(error||!at||!target) return null;
 const profiles=Array.isArray(target.profiles)?target.profiles.filter(name=>typeof name==='string'):[];
 return {...at,profile:typeof target.profile==='string'&&target.profile?target.profile:null,profiles};
}

// What a member of the Company sees: the state of ChatGPT and Claude for it. The root profile's sign-in serves every
// Agent of the Company; one an earlier version left on the Company's profile serves its main Agent only, and one left on
// an Agent's own profile that Agent only. Those are still read so the Owner can remove them. signIns is null when
// unknown. A Company whose Engine is not made, or does not answer, gets one plain state instead (`noEngine`) and no
// sign-in action: asking it would fail, and the person is told to ask the install owner. `accounts` are the root's
// subscription accounts one by one (#618), two of one kind apart by the Engine's id; null when the Engine did not list
// them, and the provider's state above still says whether it is connected.
/** @param {any} db @param {{company:string,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function readCompanySignIns(db,{company,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 if(!hermes) return {profile:null,profiles:null,signIns:null,noEngine:true};
 const target=await signInTarget(db,company,hermes);
 if(!target) return {profile:null,profiles:null,signIns:null};
 const read=driver.read||drivers.read;
 const atRoot=await read({...target,profile:root});
 if(atRoot.state==='unreachable') return {profile:null,profiles:null,signIns:null,noEngine:true};
 if(atRoot.state!=='found') return {profile:target.profile,profiles:target.profiles,signIns:null};
 // Only a provider the root does not hold can be an older one of the Company's, so nothing is read otherwise.
 // A profile that could not be read is named (`unread`), so no caller takes its sign-ins as absent (#422).
 const elsewhere=new Map(); let unread=false;
 if(signInProviders.some(id=>!atRoot.signIns[id].connected)) {
  const own=target.profile?await read({...target,profile:target.profile}):null;
  if(own&&own.state!=='found') unread=true;
  if(own?.state==='found') for(const id of signInProviders) if(own.signIns[id].connected) elsewhere.set(id,'mainAgentOnly');
  for(const profile of target.profiles.filter(name=>name!==target.profile)) {
   const other=await read({...target,profile});
   if(other.state!=='found') { unread=true; continue; }
   for(const id of signInProviders) if(other.signIns[id].connected&&!elsewhere.has(id)) elsewhere.set(id,'someAgentsOnly');
  }
 }
 const signIns=Object.fromEntries(signInProviders.map(id=>[id,{state:atRoot.signIns[id].connected?'connected':elsewhere.get(id)??'notConnected',flow:atRoot.signIns[id].flow}]));
 const listed=await (driver.accounts||drivers.accounts)({...target,profile:root});
 const accounts=listed.state==='found'?listed.accounts:null;
 return {profile:target.profile,profiles:target.profiles,signIns,accounts,...(unread?{unread}:{})};
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

// An Owner starts, follows, cancels or removes a sign-in. Returns the answer and its HTTP status. A disconnect that
// names an `account` removes that one account of the root's (#618), and every other one stays as it was.
/** @param {any} db @param {{company:string,provider:unknown,intent:unknown,session?:unknown,account?:unknown,hermes?:{address:string,key:string}|null,driver?:Partial<typeof drivers>}} request */
export async function changeCompanySignIn(db,{company,provider,intent,session,account,hermes=engineOf(company),driver={}}) {
 hermes=await hermes;
 const use={...drivers,...driver};
 if(typeof provider!=='string'||!signInProviders.includes(provider)||!['start','poll','cancel','disconnect'].includes(String(intent))) return {status:400,body:{error:'signInInvalid'}};
 if(account!==undefined&&(intent!=='disconnect'||typeof account!=='string'||!accountId.test(account))) return {status:400,body:{error:'signInInvalid'}};
 // Checked on the server for every step: a person who is not an active Owner of the Company changes nothing.
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 if(error||owner!==true) return {status:403,body:{error:'signInNotAllowed'}};
 const target=await signInTarget(db,company,hermes);
 if(!target) return {status:409,body:{error:'signInNoProfile'}};
 const atRoot={...target,profile:root};
 const failed=state=>({status:state==='unreachable'?503:502,body:{error:'signInFailed'}});
 if(intent==='start') {
  const started=await use.start(atRoot,provider);
  if(started.state==='terminal_only') return {status:409,body:{error:'signInTerminalOnly'}};
  if(started.state!=='started') return failed(started.state);
  return {status:200,body:{session:started.session,code:started.code,link:started.link,expiresIn:started.expiresIn,interval:started.interval}};
 }
 if(intent==='poll'||intent==='cancel') {
  if(typeof session!=='string') return {status:400,body:{error:'signInInvalid'}};
  const result=intent==='poll'?await use.poll(atRoot,provider,session):await use.cancel(atRoot,session);
  if(['refused','unreachable','failed'].includes(result.state)) return failed(result.state);
  if(result.state==='approved') await logChange(db,{c:company,provider,connected:true,session});
  return {status:200,body:{status:result.state}};
 }
 if(account!==undefined) {
  const removed=await use.removeAccount(atRoot,provider,account);
  if(removed.state==='disconnected') await logChange(db,{c:company,provider,connected:false,session:null});
  if(removed.state!=='disconnected'&&removed.state!=='nothing') return failed(removed.state);
  await forgetProviderName(db,{company,provider,account});
  return {status:200,body:{status:'disconnected'}};
 }
 // The root's sign-in, and any the Company's profiles still hold of their own (an older one keeps shadowing the root's
 // for its profile), and no other Company's. Each is asked even after one fails, so a removal that happened is logged.
 const profiles=[...new Set([root,...(target.profile?[target.profile]:[]),...target.profiles])];
 const removed=[];
 for(const profile of profiles) removed.push((await use.disconnect({...target,profile},provider)).state);
 if(removed.includes('disconnected')) await logChange(db,{c:company,provider,connected:false,session:null});
 const failure=removed.find(state=>state!=='disconnected'&&state!=='nothing');
 return failure?failed(failure):{status:200,body:{status:'disconnected'}};
}
