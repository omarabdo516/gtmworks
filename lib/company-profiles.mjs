import { encryptSecret, decryptSecret } from './agent-crypto.mjs';
import { testHermes, provideProfile, configureProfile, readToolsets, readSignIns } from './hermes.mjs';
import { levelConfig, riskyOf, toolPolicy } from './agent-levels.mjs';

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
const companySoul='You are a marketing agent working for one company in gtmworks. You read, research and draft; people approve what is published or spent.';
// An Agent's own profile has its instructions as its soul (ADR 0016); an Agent made with none keeps the Company
// profile's, the baseline it would have had there.
/** @param {string|null|undefined} instructions */
export const agentSoul=instructions=>instructions||companySoul;
// A Company waiting to move is asked about its sign-in, and an Agent waiting to move about its profile, at most this
// often.
const askEvery=60000;

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

/** @param {any} db @param {string} name @param {object} args */
async function called(db,name,args) {
 const {data,error}=await db.rpc(name,args);
 if(error) throw new Error(error.message);
 return data;
}

// One profile's tools brought to its level, a Company's or an Agent's alike. A profile with no record is made (again)
// with its soul and its tools. A recorded one whose level, policy or last change is not confirmed is first marked as
// changing (no run starts on it), then written, read back and recorded; a failure anywhere leaves the mark. The read-back
// is checked against the whole deny list of the requested level, so a downgrade Hermes did not apply never counts.
// Answers what it did, null when there was nothing to do, false when the Engine did not apply it.
/** @param {any} db @param {{provide:typeof provideProfile,configure:typeof configureProfile}} driver @param {any} hermes
 *  @param {{name:string,level:number,soul:string,row:{tools_level:number|null,tools_policy:number|null,tools_pending:boolean},begin:[string,object],record:[string,object]}} profile
 *  @returns {Promise<'provided'|'configured'|null|false>} */
async function keepTools(db,driver,hermes,{name,level,soul,row,begin,record}) {
 const config=levelConfig(level);
 const tools={name,config,forbidden:config.agent.disabled_toolsets};
 if(row.tools_level==null) {
  if((await driver.provide(hermes,{...tools,soul})).state!=='configured') return false;
  await called(db,...record);
  return 'provided';
 }
 if(row.tools_level===level&&row.tools_policy===toolPolicy&&!row.tools_pending) return null;
 await called(db,...begin);
 if((await driver.configure(hermes,tools)).state!=='configured') return false;
 await called(db,...record);
 return 'configured';
}

async function keepOne(db,row,{hermes,encryptionKey,waiting,now,driver},done) {
 const {company_id:company,profile,agent_level:level}=row;
 const kept=await keepTools(db,driver,hermes,{name:profile,level,soul:companySoul,row,
  begin:['begin_company_tools',{c:company}],record:['record_company_profile',{c:company,engine_profile:profile,level,policy:toolPolicy}]});
 if(kept===false) return;
 if(kept) done[kept]++;
 if(!row.attach&&!row.move) return;
 const target={...hermes,profile};
 if(row.move) {
  // Moving before the Company's profile has a model would leave its Agents without one; ask again later.
  const last=waiting.get(company);
  if(last!==undefined&&now()-last<askEvery) return;
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

// Each Agent's own profile (ADR 0016) is kept in step with its Company's level as the Company's profile is: the database
// lists the ones whose tools lag (agent_profile_work), and one the Engine lost is made again, empty, with the Agent's
// instructions as its soul and the install key as its Run API key, as when Lead's call made it. One profile that fails
// never holds back the others.
/** @param {any} db @param {{hermes:{address:string,profile:string,key:string,managementAddress?:string}|null,driver?:{provide:typeof provideProfile,configure:typeof configureProfile}}} options */
export async function keepAgentProfiles(db,{hermes,driver={provide:provideProfile,configure:configureProfile}}) {
 if(!hermes) return {provided:0,configured:0};
 const {data:work,error}=await db.rpc('agent_profile_work');
 if(error) throw new Error(error.message);
 const done={provided:0,configured:0};
 for(const row of work||[]) {
  try {
   const kept=await keepTools(db,driver,hermes,{name:row.profile,level:row.agent_level,soul:agentSoul(row.instructions),row,
    begin:['begin_agent_tools',{agent:row.agent_id}],record:['record_agent_profile',{agent:row.agent_id,engine_profile:row.profile,level:row.agent_level,policy:toolPolicy}]});
   if(kept) done[kept]++;
  } catch(failure) { console.error('Agent profile not kept:',row.agent_id,failure?.message||'unknown error'); }
 }
 return done;
}

// An Agent that runs on its Company's profile from before ADR 0016 moves to its own (#121): the database lists each Agent
// other than its Company's keeper, of a Company whose profile is ready, with nothing of it in flight (agent_move_work).
// For each, at most once a minute, the worker records the move's start, has the driver make or finish the Agent's
// profile under its reserved name, and only when the Engine answers that it was provided (its tools read back and a
// model it can answer with) records its tools and moves it. Anything else leaves the Agent where it is, still working.
// The worker asks the Engine about the Agent's own profile and nothing else, so the keeper's profile is never touched.
// One Agent that fails never holds back another. `driver` is the bundled Engine's, through the engine contract.
/** @param {any} db @param {{hermes:{address:string,profile:string,key:string,managementAddress?:string}|null,waiting?:Map<string,number>,now?:()=>number,
 *  driver:{provideAgent:import('./engine.mjs').Engine['provideAgent']}}} options */
export async function moveAgentProfiles(db,{hermes,waiting=new Map(),now=Date.now,driver}) {
 if(!hermes) return {moved:0};
 const {data:work,error}=await db.rpc('agent_move_work');
 if(error) throw new Error(error.message);
 let moved=0;
 for(const row of work||[]) {
  const last=waiting.get(row.agent_id);
  if(last!==undefined&&now()-last<askEvery) continue;
  waiting.set(row.agent_id,now());
  try {
   if(!row.recorded&&!(await called(db,'begin_agent_profile_move',{agent:row.agent_id}))) continue;
   const made=await driver.provideAgent({name:row.profile,instructions:agentSoul(row.instructions),level:row.agent_level});
   if(made.state!=='provided') continue;
   await called(db,'record_agent_profile',{agent:row.agent_id,engine_profile:row.profile,level:row.agent_level,policy:toolPolicy});
   if(await called(db,'move_agent_profile',{agent:row.agent_id})) { moved++; waiting.delete(row.agent_id); }
  } catch(failure) { console.error('Agent not moved:',row.agent_id,failure?.message||'unknown error'); }
 }
 return {moved};
}

// Tool health (rule f): what each connected Connection's profile lets a Run use, read from Hermes and recorded as the
// risky toolsets it has on. A Connection that cannot be read keeps its last reading. Returns how many were recorded.
// A bundled Company or Agent profile the Engine no longer serves is forgotten, so its profile loop makes it again.
/** @param {any} db @param {{encryptionKey:string|undefined,read?:typeof readToolsets}} options */
export async function checkAgentTools(db,{encryptionKey,read=readToolsets}) {
 const {data:due,error}=await db.rpc('engine_tools_due');
 if(error) throw new Error(error.message);
 let recorded=0;
 for(const connection of due||[]) {
  let key; try { key=decryptSecret(connection.key_encrypted,encryptionKey); } catch { continue; }
  const found=await read({address:connection.address,profile:connection.profile,key});
  // A Company or Agent profile the Engine lost is made again by its profile loop; a pasted one is only reported as unreadable.
  if(found.state==='missing') { const {error:lost}=await db.rpc('forget_company_profile',{connection:connection.connection}); if(lost) console.error('Company profile not forgotten:',connection.connection,lost.message); continue; }
  if(found.state!=='found') continue;
  const {error:refused}=await db.rpc('record_engine_tools',{connection:connection.connection,risky:riskyOf(found.toolsets)});
  if(refused) { console.error('Agent tools not recorded:',connection.connection,refused.message); continue; }
  recorded++;
 }
 return recorded;
}

// Reservations whose message was not recorded within ten minutes, or can never be (the Agent or the sender's place is
// gone), are marked abandoned in one database update; gtmworks never calls the engine to finish one. The person already
// saw an error and can send again. An abandoned reservation is kept for the record and holds nothing. Returns how many.
/** @param {any} db */
export async function abandonConversationReservations(db) {
 const {data,error}=await db.rpc('abandon_conversation_reservations');
 if(error) throw new Error(error.message);
 return data||0;
}
