import { savedConnectionKey } from './connection-key.mjs';
import { readSignIns, startSignIn, pollSignIn, cancelSignIn, disconnectSignIn, signInProviders } from './hermes.mjs';

// A Company's model sign-in (#3, ADR 0014). It lives in the Company's own profile in the bundled Engine; Hermes runs
// it, and gtmworks only asks Hermes through the driver. `db` is the signed-in person's own session: the database says
// which profile is the Company's and that the person is a member (company_engine_target), and is_company_owner says
// whether they may change it. `service` is a service-role client that only reads the key of that Company's bundled
// Connection (the install key), by its id and the Company (ADR 0008). What goes back to the browser is the connected
// state of each provider, and for a ChatGPT sign-in its code, its https link and the session to poll: never a
// credential, a token preview or Hermes's own error text.

const drivers={read:readSignIns,start:startSignIn,poll:pollSignIn,cancel:cancelSignIn,disconnect:disconnectSignIn};

// Where the Company's sign-in lives, or null when it has no profile of its own in the bundled Engine (a pasted Hermes,
// or a hosted install): its sign-in is then managed in that Hermes.
/** @param {any} db @param {any} service @param {string} company @param {string|undefined} encryptionKey */
export async function signInTarget(db,service,company,encryptionKey) {
 const {data,error}=await db.rpc('company_engine_target',{c:company});
 const target=Array.isArray(data)?data[0]:data;
 if(error||!target?.connection||!target.profile) return null;
 let key=null; try { key=await savedConnectionKey(service,{id:target.connection,company},encryptionKey); } catch { key=null; }
 return key?{address:target.address,profile:target.profile,key}:null;
}

// What a member of the Company sees: whether ChatGPT and Claude are connected for it. null when unknown.
/** @param {any} db @param {any} service @param {{company:string,encryptionKey:string|undefined,driver?:Partial<typeof drivers>}} request */
export async function readCompanySignIns(db,service,{company,encryptionKey,driver={}}) {
 const target=await signInTarget(db,service,company,encryptionKey);
 if(!target) return {profile:null,signIns:null};
 const read=await (driver.read||drivers.read)(target);
 return {profile:target.profile,signIns:read.state==='found'?read.signIns:null};
}

// An Owner starts, follows, cancels or removes a sign-in. Returns the answer and its HTTP status.
/** @param {any} db @param {any} service @param {{company:string,provider:unknown,intent:unknown,session?:unknown,encryptionKey:string|undefined,driver?:Partial<typeof drivers>}} request */
export async function changeCompanySignIn(db,service,{company,provider,intent,session,encryptionKey,driver={}}) {
 const use={...drivers,...driver};
 if(typeof provider!=='string'||!signInProviders.includes(provider)||!['start','poll','cancel','disconnect'].includes(String(intent))) return {status:400,body:{error:'signInInvalid'}};
 // Checked on the server for every step: a person who is not an active Owner of the Company changes nothing.
 const {data:owner,error}=await db.rpc('is_company_owner',{c:company});
 if(error||owner!==true) return {status:403,body:{error:'signInNotAllowed'}};
 const target=await signInTarget(db,service,company,encryptionKey);
 if(!target) return {status:409,body:{error:'signInNoProfile'}};
 const failed=state=>({status:state==='unreachable'?503:502,body:{error:'signInFailed'}});
 if(intent==='start') {
  const started=await use.start(target,provider);
  if(started.state==='terminal_only') return {status:409,body:{error:'signInTerminalOnly',profile:target.profile}};
  if(started.state!=='started') return failed(started.state);
  return {status:200,body:{session:started.session,code:started.code,link:started.link,expiresIn:started.expiresIn,interval:started.interval}};
 }
 if(intent==='poll'||intent==='cancel') {
  if(typeof session!=='string') return {status:400,body:{error:'signInInvalid'}};
  const result=intent==='poll'?await use.poll(target,provider,session):await use.cancel(target,session);
  if(['refused','unreachable','failed'].includes(result.state)) return failed(result.state);
  return {status:200,body:{status:result.state}};
 }
 const removed=await use.disconnect(target,provider);
 return removed.state==='disconnected'?{status:200,body:{status:'disconnected'}}:failed(removed.state);
}
