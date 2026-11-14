import { encryptSecret, decryptSecret } from './agent-crypto.mjs';
import { testHermes, provideProfile, configureProfile, readToolsets, readSignIns } from './hermes.mjs';
import { levelConfig, riskyOf, toolPolicy } from './agent-levels.mjs';
import { engineFor as defaultEngine } from './engine.mjs';

// One Hermes profile per Company in the bundled Engine (#2, ADR 0014), kept by the worker. For each Company the
// database lists (company_profile_work), the worker:
//  - makes the Company's own profile through the driver, with its Run API key and the tools of its Agent level, and
//    records it once Hermes reports no forbidden toolset for it;
//  - writes the tools again when the Owner changed the level;
//  - attaches a Company with no Hermes to its profile (a Connection and its main Agent, Lead);
//  - moves a Company whose Agents run on the shared `default` profile once its own profile holds a model sign-in, so
//    the move never leaves it without a model, and the database refuses a move while a Run is open.
// Only the driver talks to Hermes, and the key reaches the database only encrypted (ADR 0008). `db` is a service-role
// client. A pasted Connection is never touched (ADR 0010).

// The soul a new company profile starts with; each Agent's own instructions come with its Conversations.
export const companySoul='You are a marketing agent working for one company in gtmworks. You read, research and draft; people approve what is published or spent.';
// A Company waiting to move is asked about its sign-in at most this often.
const signInEvery=60000;

/** @param {any} db @param {{hermes:{address:string,profile:string,key:string,managementAddress?:string}|null,encryptionKey:string|undefined,waiting?:Map<string,number>,now?:()=>number,
 *  driver?:{test:typeof testHermes,provide:typeof provideProfile,configure:typeof configureProfile,signIns:typeof readSignIns}}} options */
export async function keepCompanyProfiles(db,{hermes,encryptionKey,waiting=new Map(),now=Date.now,driver={test:testHermes,provide:provideProfile,configure:configureProfile,signIns:readSignIns}}) {
 if(!hermes) return {provided:0,configured:0,attached:0,moved:0};
 const {data:work,error}=await db.rpc('company_profile_work');
 if(error) throw new Error(error.message);
 const done={provided:0,configured:0,attached:0,moved:0};
 for(const row of work||[]) {
  try { await keepOne(db,row,{hermes,encryptionKey,waiting,now,driver},done); }
  catch(failure) { console.error('Company profile not kept:',row.company_id,failure?.message||'unknown error'); }
 }
 return done;
}

async function recorded(db,args) {
 const {error}=await db.rpc('record_company_profile',args);
 if(error) throw new Error(error.message);
}

async function keepOne(db,row,{hermes,encryptionKey,waiting,now,driver},done) {
 const {company_id:company,profile,agent_level:level}=row;
 // Read back against the whole deny list of the requested level, so a downgrade Hermes did not apply never counts.
 const config=levelConfig(level);
 const tools={name:profile,config,forbidden:config.agent.disabled_toolsets};
 // A new profile is made with its tools. A recorded one whose level, policy or last change is not confirmed is first
 // marked as changing (no run starts on it), then written, read back and recorded; a failure anywhere leaves the mark.
 if(row.tools_level==null) {
  const made=await driver.provide(hermes,{...tools,soul:companySoul});
  if(made.state!=='configured') return;
  await recorded(db,{c:company,engine_profile:profile,level,policy:toolPolicy});
  done.provided++;
 } else if(row.tools_level!==level||row.tools_policy!==toolPolicy||row.tools_pending) {
  const {error}=await db.rpc('begin_company_tools',{c:company});
  if(error) throw new Error(error.message);
  const made=await driver.configure(hermes,tools);
  if(made.state!=='configured') return;
  await recorded(db,{c:company,engine_profile:profile,level,policy:toolPolicy});
  done.configured++;
 }
 if(!row.attach&&!row.move) return;
 const target={...hermes,profile};
 if(row.move) {
  // Moving before the Company's profile has a model would leave its Agents without one; ask again later.
  const last=waiting.get(company);
  if(last!==undefined&&now()-last<signInEvery) return;
  waiting.set(company,now());
  const signed=await driver.signIns(target);
  if(signed.state!=='found'||!Object.values(signed.signIns).some(signIn=>signIn.connected)) return;
 }
 const status=await driver.test(target);
 if(status.state!=='connected'||!status.features.includes('run_submission')) return;
 const args={c:company,bundled_address:hermes.address,bundled_key:encryptSecret(hermes.key,encryptionKey),bundled_version:status.version,bundled_features:status.features};
 const {data,error}=await db.rpc(row.attach?'attach_company_profile':'move_company_profile',args);
 if(error) throw new Error(error.message);
 if(row.attach&&data===true) done.attached++;
 if(row.move&&data>0) { done.moved++; waiting.delete(company); }
}

// Tool health (rule f): what each connected Connection's profile lets a Run use, read from Hermes and recorded as the
// risky toolsets it has on. A Connection that cannot be read keeps its last reading. Returns how many were recorded.
// A bundled company profile the Engine no longer serves is forgotten, so the profile loop makes it again.
/** @param {any} db @param {{encryptionKey:string|undefined,read?:typeof readToolsets}} options */
export async function checkAgentTools(db,{encryptionKey,read=readToolsets}) {
 const {data:due,error}=await db.rpc('engine_tools_due');
 if(error) throw new Error(error.message);
 let recorded=0;
 for(const connection of due||[]) {
  let key; try { key=decryptSecret(connection.key_encrypted,encryptionKey); } catch { continue; }
  const found=await read({address:connection.address,profile:connection.profile,key});
  // A company profile the Engine lost is made again by the profile loop; a pasted one is only reported as unreadable.
  if(found.state==='missing') { const {error:lost}=await db.rpc('forget_company_profile',{connection:connection.connection}); if(lost) console.error('Company profile not forgotten:',connection.connection,lost.message); continue; }
  if(found.state!=='found') continue;
  const {error:refused}=await db.rpc('record_engine_tools',{connection:connection.connection,risky:riskyOf(found.toolsets)});
  if(refused) { console.error('Agent tools not recorded:',connection.connection,refused.message); continue; }
  recorded++;
 }
 return recorded;
}

// A reservation whose message was never recorded (the answer from Hermes was lost, or saving failed) is settled with
// Hermes on the Connection it pinned, never another: starting again with the same idempotency key replays the run
// Hermes started, or starts it, and the run is then recorded as the person's message. An unreachable or refusing
// Hermes leaves the reservation, which keeps holding its Connection. Returns how many were settled.
/** @param {any} db @param {{encryptionKey:string|undefined,engineFor?:typeof defaultEngine}} options */
export async function settleConversationRuns(db,{encryptionKey,engineFor=defaultEngine}) {
 const {data:held,error}=await db.rpc('unsettled_conversation_runs');
 if(error) throw new Error(error.message);
 let settled=0;
 for(const reserved of held||[]) {
  if(reserved.state!=='connected'||!reserved.features?.includes('run_submission')) continue;
  let key; try { key=decryptSecret(reserved.key_encrypted,encryptionKey); } catch { continue; }
  const run=await engineFor({address:reserved.address,profile:reserved.profile,key}).start({conversation:reserved.conversation,input:reserved.message,idempotencyKey:`${reserved.conversation}:${reserved.send_key}`});
  if(!run) continue;
  const {error:refused}=await db.rpc('settle_conversation_run',{conversation:reserved.conversation,message_key:reserved.send_key,run});
  if(refused) { console.error('Conversation run not settled:',reserved.conversation,refused.message); continue; }
  settled++;
 }
 return settled;
}
