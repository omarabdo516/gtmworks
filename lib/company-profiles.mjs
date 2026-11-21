import { testHermes, provideProfile, configureProfile, readToolsets, readProfileApps, readSignIns, replaceSoulText } from './hermes.mjs';
import { engineOf } from './company-engine.mjs';
import { toolConfig, toolsDiffer } from './agent-toolsets.mjs';

// One Hermes profile per Company in the Engine (#2, ADR 0014), kept by the worker. For each Company the database lists
// (company_profile_work), the worker:
//  - makes the Company's own profile through the driver, with its Run API key and the one fixed set of tools every Agent
//    gets (lib/agent-toolsets.mjs), and records it once the Engine reports exactly that set;
//  - writes and reads the tools back again when a profile the Engine already had is unconfirmed, or its tools differ;
//  - attaches a Company with no Engine profile to its profile (its main Agent, Lead);
//  - moves a Company whose Agents run on the old `default` profile once its Engine holds a model sign-in on the root
//    profile or its own, so the move never leaves it without a model, and the database refuses a move while a Run is open.
// Only the driver talks to Hermes, and its key never reaches the database (#342). `db` is a service-role client.

// The soul a new company profile starts with: its keeper is the main Agent, Lead, which manages the Company's team (#434):
// it hands a job to the Agent that does it, offers to make one for work no Agent does (lib/lead-offer.mjs), and does
// small one-off jobs itself.
export const leadSoul='You are the main agent of one company in gtmworks, and you manage its team of agents. When a job belongs to an agent on the team, hand it to that agent with hand_to_agent. When recurring or specialist work comes up that no agent on the team does, offer to make an agent for it. Do small one-off jobs yourself: you read, research and draft. Nothing is published or spent without a person\'s approval.';
// The baseline of an Agent made with no instructions, and the text every company profile started with before #434.
export const baselineSoul='You are a marketing agent working for one company in gtmworks. You read, research and draft; people approve what is published or spent.';
// An Agent's own profile has its instructions as its soul (ADR 0016); an Agent made with none keeps that baseline.
/** @param {string|null|undefined} instructions */
export const agentSoul=instructions=>instructions||baselineSoul;
// A Company waiting to move is asked about its sign-in, and an Agent waiting to move about its profile, at most this
// often.
const askEvery=60000;

/** @param {any} db @param {{hermes?:{address:string,profile:string,key:string,managementAddress?:string}|null,engine?:(company:string|null|undefined)=>object|null,waiting?:Map<string,number>,now?:()=>number,
 *  driver?:{test:typeof testHermes,provide:typeof provideProfile,configure:typeof configureProfile,signIns:typeof readSignIns}}} options */
export async function keepCompanyProfiles(db,{hermes,engine=engineOf,waiting=new Map(),now=Date.now,driver={test:testHermes,provide:provideProfile,configure:configureProfile,signIns:readSignIns}}) {
 const done={provided:0,configured:0,attached:0,moved:0};
 // A caller that names no Engine at all (a hosted install) has nothing to keep; the worker omits it and each row asks.
 if(hermes===null) return done;
 const {data:work,error}=await db.rpc('company_profile_work');
 if(error) throw new Error(error.message);
 for(const row of work||[]) {
  // The Company's own Engine answers each row; a Company with none is kept for a later pass.
  const at=hermes??await engine(row.company_id);
  if(!at) continue;
  try { await keepOne(db,row,{hermes:at,waiting,now,driver},done); }
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

// One profile's tools brought to the fixed set, a Company's or an Agent's alike. A profile never confirmed is made (or
// finished) with its soul and the fixed tools. A confirmed one that is marked as changing is written, read back and
// recorded; a failure anywhere leaves the mark. The read-back is checked by lib/hermes.mjs against the whole list of
// tools no Agent gets, so a profile whose Engine still offers one of them is never recorded.
// Answers what it did, null when there was nothing to do, false when the Engine did not apply it.
/** @param {any} db @param {{provide:typeof provideProfile,configure:typeof configureProfile}} driver @param {any} hermes
 *  @param {{name:string,soul:string,subagents?:boolean,confirmed:boolean,pending:boolean,begin:[string,object],record:[string,object]}} profile
 *  @returns {Promise<'provided'|'configured'|null|false>} */
async function keepTools(db,driver,hermes,{name,soul,subagents=false,confirmed,pending,begin,record}) {
 const config=toolConfig({subagents,profile:name});
 const tools={name,config,forbidden:config.agent.disabled_toolsets};
 if(!confirmed) {
  if((await driver.provide(hermes,{...tools,soul})).state!=='configured') return false;
  await called(db,...record);
  return 'provided';
 }
 if(!pending) return null;
 await called(db,...begin);
 if((await driver.configure(hermes,tools)).state!=='configured') return false;
 await called(db,...record);
 return 'configured';
}

async function keepOne(db,row,{hermes,waiting,now,driver},done) {
 const {company_id:company,profile}=row;
 // The main Agent's sub-agents switch is its `co-` profile's own (#425), written and named on the read-back as an Agent's.
 const subagents=row.subagents===true;
 const kept=await keepTools(db,driver,hermes,{name:profile,soul:leadSoul,subagents,confirmed:row.tools_confirmed===true,pending:row.tools_pending===true,row,
  begin:['begin_company_tools',{c:company}],record:['record_company_profile',{c:company,engine_profile:profile,subagents_written:subagents}]});
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
  if(signed.state!=='found'||!Object.values(signed.signIns).some(signIn=>signIn.connected||signIn.root)) return;
 }
 const status=await driver.test(target);
 if(status.state!=='connected'||!status.features.includes('run_submission')) return;
 const {data,error}=await db.rpc(row.attach?'attach_company_profile':'move_company_profile',{c:company});
 if(error) throw new Error(error.message);
 if(row.attach&&data===true) done.attached++;
 if(row.move&&data>0) { done.moved++; waiting.delete(company); }
}

// #434: a main Agent whose profile still holds the text every Company started with gets the manager's; one whose Owner
// changed it keeps theirs. The database lists each Company profile not yet checked (lead_soul_work), and one read the
// Engine answered is recorded (record_lead_soul), so it is checked once; one it could not read is asked again later.
/** @param {any} db @param {{hermes?:{address:string,key:string,managementAddress?:string}|null,engine?:(company:string|null|undefined)=>object|null,replace?:typeof replaceSoulText}} options */
export async function keepLeadSouls(db,{hermes,engine=engineOf,replace=replaceSoulText}) {
 const done={upgraded:0,checked:0};
 if(hermes===null) return done;
 for(const {company_id:company,profile} of await called(db,'lead_soul_work',{})||[]) {
  const at=hermes??await engine(company);
  if(!at) continue;
  const result=await replace(at,{profile,from:baselineSoul,to:leadSoul});
  if(result.state!=='written'&&result.state!=='unchanged') continue;
  try { await called(db,'record_lead_soul',{c:company,engine_profile:profile}); } catch(failure) { console.error('Lead soul not recorded:',company,failure?.message||'unknown error'); continue; }
  if(result.state==='written') done.upgraded++;
  done.checked++;
 }
 return done;
}

// Each Agent's own profile (ADR 0016) is kept in step with the one fixed set of tools as the Company's profile is: the
// database lists the ones it never confirmed or marked as changing (agent_profile_work), and one the Engine lost is made
// again, empty, with the Agent's instructions as its soul and the install key as its Run API key, as when Lead's call
// made it. One profile that fails never holds back the others. Each row names its Company, and asks that Company's
// Engine (#380).
/** @param {any} db @param {{hermes?:{address:string,profile:string,key:string,managementAddress?:string}|null,engine?:(company:string|null|undefined)=>object|null,driver?:{provide:typeof provideProfile,configure:typeof configureProfile}}} options */
export async function keepAgentProfiles(db,{hermes,engine=engineOf,driver={provide:provideProfile,configure:configureProfile}}) {
 // No Engine at all (a hosted install, or a caller that says so): nothing to keep.
 if(hermes===null) return {provided:0,configured:0};
 const {data:work,error}=await db.rpc('agent_profile_work');
 if(error) throw new Error(error.message);
 const done={provided:0,configured:0};
 for(const row of work||[]) {
  const at=hermes??await engine(row.company_id);
  if(!at) continue;
  try {
   const kept=await keepTools(db,driver,at,{name:row.profile,soul:agentSoul(row.instructions),subagents:row.subagents===true,confirmed:row.tools_confirmed===true,pending:row.tools_pending===true,
    begin:['begin_agent_tools',{agent:row.agent_id}],record:['record_agent_profile',{agent:row.agent_id,engine_profile:row.profile,subagents_written:row.subagents===true}]});
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
/** @param {any} db @param {{hermes?:{address:string,profile:string,key:string,managementAddress?:string}|null,engine?:(company:string|null|undefined)=>object|null,waiting?:Map<string,number>,now?:()=>number,
 *  driver?:{provideAgent:import('./engine.mjs').Engine['provideAgent']},driverFor?:(connection:object)=>import('./engine.mjs').Engine}} options */
export async function moveAgentProfiles(db,{hermes,engine=engineOf,waiting=new Map(),now=Date.now,driver,driverFor}) {
 // A caller that names no Engine at all (a hosted install) has nothing to move; the worker omits it and each row asks.
 if(hermes===null) return {moved:0};
 const {data:work,error}=await db.rpc('agent_move_work');
 if(error) throw new Error(error.message);
 let moved=0;
 for(const row of work||[]) {
  const at=hermes??await engine(row.company_id);
  if(!at) continue;
  const use=driver??driverFor?.(at);
  if(!use) continue;
  const last=waiting.get(row.agent_id);
  if(last!==undefined&&now()-last<askEvery) continue;
  waiting.set(row.agent_id,now());
  try {
   if(!row.recorded&&!(await called(db,'begin_agent_profile_move',{agent:row.agent_id}))) continue;
   // The profile is made with the Agent's own sub-agents switch, the one recorded as written below.
   const made=await use.provideAgent({name:row.profile,instructions:agentSoul(row.instructions),subagents:row.subagents===true});
   if(made.state!=='provided') continue;
   await called(db,'record_agent_profile',{agent:row.agent_id,engine_profile:row.profile,subagents_written:row.subagents===true});
   if(await called(db,'move_agent_profile',{agent:row.agent_id})) { moved++; waiting.delete(row.agent_id); }
  } catch(failure) { console.error('Agent not moved:',row.agent_id,failure?.message||'unknown error'); }
 }
 return {moved};
}

// Every Company and Agent profile is read now and then: one the Engine no longer serves is forgotten, so its profile
// loop makes it again, and one whose Engine reports other tools than the fixed set is marked as changing, written and
// read back before its Runs start again. The Company's own Apps' servers (#30) are beside the fixed set, not a difference;
// any other toolset on is. A profile the Engine keeps on offering a tool no Agent gets is left unconfirmed. A profile's
// saved config is not read: the write that corrects its tools pins its own start folder and approval mode as well, and a
// matching tool list is left alone. Returns how many profiles were read. Each row names its Company, and asks that
// Company's Engine (#380).
/** @param {any} db @param {{hermes?:{address:string,key:string}|null,engine?:(company:string|null|undefined)=>object|null,
 *  read?:typeof readToolsets,apps?:typeof readProfileApps,driver?:{configure:typeof configureProfile}}} options */
export async function checkAgentTools(db,{hermes,engine=engineOf,read=readToolsets,apps=readProfileApps,driver={configure:configureProfile}}) {
 // No Engine at all (a hosted install, or a caller that says so): nothing to read.
 if(hermes===null) return 0;
 const {data:due,error}=await db.rpc('engine_tools_due');
 if(error) throw new Error(error.message);
 let count=0;
 for(const {company_id:company,profile,subagents=false} of due||[]) {
  const at=hermes??await engine(company);
  if(!at) continue;
  const found=await read({address:at.address,profile,key:at.key});
  if(found.state==='missing') { const {error:lost}=await db.rpc('forget_company_profile',{engine_profile:profile}); if(lost) console.error('Company profile not forgotten:',profile,lost.message); continue; }
  if(found.state!=='found') continue;
  count++;
  if(!toolsDiffer(found.toolsets,{subagents:subagents===true})) continue;
  // The profile's Apps are read only when the tool list itself is different; when they cannot be read, the extra toolset
  // counts as a difference, so a tool no Agent gets is never let by for want of an answer.
  const held=await apps({address:at.address,profile,key:at.key,managementAddress:at.managementAddress});
  if(held.state==='found'&&!toolsDiffer(found.toolsets,{subagents:subagents===true,apps:held.apps})) continue;
  try {
   await called(db,'begin_profile_tools',{profile});
   const fixed=toolConfig({subagents:subagents===true,profile});
   const written=await driver.configure(at,{name:profile,config:fixed,forbidden:fixed.agent.disabled_toolsets});
   if(written.state==='configured') await called(db,'record_profile_tools',{profile,subagents_written:subagents===true});
  } catch(failure) { console.error('Agent tools not corrected:',profile,failure?.message||'unknown error'); }
 }
 return count;
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
