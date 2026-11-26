import { AsyncLocalStorage } from 'node:async_hooks';
import { engineOf } from '../company-engine.mjs';
import { companyProfile } from '../agent-toolsets.mjs';
import { hermesEngine } from './contract.mjs';
import { readUsage } from './sessions.mjs';
import * as agents from './agents.mjs';
import * as souls from './souls.mjs';
import * as skills from './skills.mjs';
import * as memory from './memory.mjs';
import * as routines from './routines.mjs';
import * as apps from './apps.mjs';
import * as providers from './providers.mjs';
import * as models from './models.mjs';
import * as config from './config.mjs';
import * as speech from './speech.mjs';
import * as files from './files.mjs';
import { readRunReply } from './routines.mjs';

// The Engine handle (ADR 0031, #782): the one way code reaches a Company's Engine. There are two ways in:
// - `companyEngine(company)`: the Company's Engine, or null when it has none this install can reach. `on(profile)` is
//   one profile of it (`default` is the Engine's root profile, which holds the Company's model sign-ins);
// - `agentEngine(db, {company, agent})`: one Agent's profile as the reader whose session `db` is may see it. An Agent
//   hidden from that reader is `missing`, in this one place, for every kind of Engine read.
// A profile's handle carries the Engine's capabilities grouped as the Engine has them: `runs` (the methods of the engine
// contract, ADR 0009) and `sessions` here, and each further capability as it moves behind the handle. Every request any of
// them makes goes through the one transport (lib/engine/transport.mjs), which keeps the deadline, the limit on calls at
// once, the health and the cause; no caller passes a raw address, key and profile.
//
// The record of the Company's Engine is the database's (lib/company-engine.mjs), read once per request or worker pass.
//
// The seam (ADR 0031): behind a handle is the Hermes driver, and a test reaches it through the Hermes wire fake
// (tests/fake-hermes.mjs). A test of a place where Runs happen may give the smaller fake of the contract's methods in its
// stead, for the work it runs (`withEngineContract`); nothing else in the product changes which driver answers.

/** @typedef {{address:string,key:string,managementAddress?:string}} EngineRecord */
/** @typedef {EngineRecord&{profile:string}} ProfileConnection */
/** @typedef {(connection:ProfileConnection)=>import('../engine.mjs').Engine} ContractFor */

/** @type {AsyncLocalStorage<ContractFor>} */
const contracts=new AsyncLocalStorage();
/** Runs `work` with the given fake of the contract's methods answering every Run a handle starts, reads or stops in it
 * (tests of a place). @template T @param {ContractFor} contractFor @param {()=>T} work @returns {T} */
export function withEngineContract(contractFor,work) { return contracts.run(contractFor,work); }

/** One profile of an Engine, with its capabilities. @param {ProfileConnection} connection */
function profileHandle(connection) {
 const runs=(contracts.getStore()??hermesEngine)(connection);
 const c=connection;
 return {
  profile:connection.profile,
  // The methods of the engine contract (ADR 0009): a Run's start, read, Steps, question, Permission request and stop.
  runs,
  sessions:{
   /** @param {string} session */ read:session=>runs.session(session),
   /** @param {string} session @param {boolean} archived */ mark:(session,archived)=>runs.markSession(session,archived),
   /** @param {number} days */ usage:days=>readUsage(c,days),
   /** @param {string} session */ reply:session=>readRunReply(c,session),
  },
  // The profile itself: an Agent's profile made, read, kept and removed, its About, its tools.
  agents:{
   /** @param {string} name */ read:name=>agents.readAgent(c,name),
   /** @param {{name:string,description:string}} change */ writeAbout:change=>agents.writeAgentAbout(c,change),
   /** @param {Parameters<typeof agents.provideProfile>[1]} profile */ provide:profile=>agents.provideProfile(c,profile),
   /** @param {Parameters<typeof agents.configureProfile>[1]} profile */ configure:profile=>agents.configureProfile(c,profile),
   toolsets:()=>agents.readToolsets(c),
   apps:()=>agents.readProfileApps(c),
  },
  souls:{
   /** @param {{profile:string,rules:string[]}} change */ writeRules:change=>souls.writeSoulRules(c,change),
   /** @param {{profile:string,from:string,to:string}} change */ replaceText:change=>souls.replaceSoulText(c,change),
   /** @param {string} name */ readInstructions:name=>souls.readAgentInstructions(c,name),
   /** @param {{profile:string,instructions:string}} change */ writeInstructions:change=>souls.writeAgentInstructions(c,change),
  },
  skills:{
   read:()=>skills.readSkills(c),
   learned:()=>skills.readLearningGraph(c),
   /** @param {{name:string}} skill */ readOwn:skill=>skills.readOwnSkill(c,skill),
   /** @param {{name:string,content:string}} skill */ write:skill=>skills.writeSkill(c,skill),
   /** @param {{name:string,enabled:boolean}} skill */ enable:skill=>skills.setSkillEnabled(c,skill),
   /** @param {{name:string}} space */ provideSpace:space=>skills.provideSharedSpace(c,space),
   /** @param {{space:string,name:string}} skill */ readShared:skill=>skills.readSharedSkill(c,skill),
   /** @param {Parameters<typeof skills.writeSharedSkill>[1]} skill */ writeShared:skill=>skills.writeSharedSkill(c,skill),
   /** @param {{profile:string,folder:string,skill:string}} sharing */ share:sharing=>skills.shareSkills(c,sharing),
  },
  memory:{
   read:()=>memory.readMemoryNotes(c),
   reset:()=>memory.resetMemory(c),
   /** @param {{note:string,text:string}} change */ edit:change=>memory.editMemoryNote(c,change),
   /** @param {{note:string}} change */ forget:change=>memory.forgetMemoryNote(c,change),
  },
  routines:{
   read:()=>routines.readRoutines(c),
   /** @param {Parameters<typeof routines.createRoutine>[1]} routine */ create:routine=>routines.createRoutine(c,routine),
   /** @param {Parameters<typeof routines.changeRoutine>[1]} change */ change:change=>routines.changeRoutine(c,change),
   /** @param {{id:string}} routine */ pause:routine=>routines.pauseRoutine(c,routine),
   /** @param {{id:string}} routine */ resume:routine=>routines.resumeRoutine(c,routine),
   /** @param {{id:string}} routine */ trigger:routine=>routines.triggerRoutine(c,routine),
   /** @param {{id:string}} routine */ remove:routine=>routines.deleteRoutine(c,routine),
   /** @param {{id:string,limit?:number}} routine */ replies:routine=>routines.readRoutineReplies(c,routine),
   /** @param {{id:string,limit?:number}} routine */ runs:routine=>routines.readRoutineRuns(c,routine),
   running:()=>routines.readRunningRoutines(c),
  },
  apps:{
   /** @param {{test?:boolean}} [options] */ read:options=>apps.readApps(c,options),
   /** @param {string} key */ test:key=>apps.testApp(c,key),
   /** @param {string} key */ testServer:key=>apps.testServer(c,key),
   /** @param {string} key @param {string} redirectUri @param {any} [options] */ prepare:(key,redirectUri,options)=>apps.prepareApp(c,key,redirectUri,options),
   /** @param {Parameters<typeof apps.prepareServer>[1]} server */ prepareServer:server=>apps.prepareServer(c,server),
   /** @param {Parameters<typeof apps.prepareCommandServer>[1]} server */ prepareCommandServer:server=>apps.prepareCommandServer(c,server),
   /** @param {string} key @param {string} redirectUri @param {any} [options] */ startSignIn:(key,redirectUri,options)=>apps.startAppSignIn(c,key,redirectUri,options),
   /** @param {string} flow */ pollSignIn:flow=>apps.pollAppSignIn(c,flow),
   /** @param {string} flow */ cancelSignIn:flow=>apps.cancelAppSignIn(c,flow),
   /** @param {Parameters<typeof apps.finishAppSignIn>[1]} signIn */ finishSignIn:signIn=>apps.finishAppSignIn(c,signIn),
   /** @param {string} key */ disconnect:key=>apps.disconnectApp(c,key),
   /** @param {string} key */ turnOff:key=>apps.turnOffApp(c,key),
  },
  providers:{
   signIns:()=>providers.readSignIns(c),
   /** @param {string} provider */ startSignIn:provider=>providers.startSignIn(c,provider),
   /** @param {string} provider @param {string} session */ pollSignIn:(provider,session)=>providers.pollSignIn(c,provider,session),
   /** @param {string} session */ cancelSignIn:session=>providers.cancelSignIn(c,session),
   /** @param {string} provider */ disconnectSignIn:provider=>providers.disconnectSignIn(c,provider),
   accounts:()=>providers.readSubscriptionAccounts(c),
   /** @param {string} provider @param {string} account */ removeAccount:(provider,account)=>providers.removeSubscriptionAccount(c,provider,account),
   /** @param {string} provider @param {{account:string,off:boolean}[]} entries */ writeAccountOrder:(provider,entries)=>providers.writeAccountOrder(c,provider,entries),
   switches:()=>providers.readAccountSwitches(c),
   /** @param {{space:string,profiles:string[]}} target */ keys:target=>providers.readProviderKeys(c,target),
   /** @param {{space:string,profiles:string[]}} target */ heldKeys:target=>providers.readHeldKeys(c,target),
   /** @param {Parameters<typeof providers.setProviderKey>[1]} key */ setKey:key=>providers.setProviderKey(c,key),
   /** @param {Parameters<typeof providers.removeProviderKey>[1]} key */ removeKey:key=>providers.removeProviderKey(c,key),
  },
  models:{
   read:()=>runs.models(),
   /** @param {string[]} profiles */ ofProfiles:profiles=>models.readProfileModels(c,profiles),
   /** @param {{profile:string,provider:string,model:string}} change */ write:change=>models.writeProfileModel(c,change),
   fallbackChain:()=>models.readFallbackChain(c),
   /** @param {Parameters<typeof models.writeFallbackChain>[1]} change */ writeFallbackChain:change=>models.writeFallbackChain(c,change),
  },
  config:{
   read:()=>config.readConfig(c),
   readSaved:()=>config.readSavedConfig(c),
   defaults:()=>config.readConfigDefaults(c),
   schema:()=>config.readConfigSchema(c),
   /** @param {Record<string,unknown>} change */ write:change=>config.writeConfig(c,change),
   standingPermissions:()=>config.readStandingPermissions(c),
   /** @param {Parameters<typeof config.revokeStandingPermission>[1]} change */ revokeStandingPermission:change=>config.revokeStandingPermission(c,change),
  },
  speech:{
   voices:()=>speech.readVoices(c),
   /** @param {{text:string}} say */ speak:say=>speech.speakText(c,say),
   /** @param {{profiles:string[],envs:string[]}} asked */ read:asked=>speech.readSpeech(c,asked),
   /** @param {Parameters<typeof speech.writeSpeech>[1]} change */ write:change=>speech.writeSpeech(c,change),
   // What the profile hears (#160), through the engine contract.
   dictation:()=>runs.dictation(),
   /** @param {{dataUrl:string,mimeType:string}} audio */ transcribe:audio=>runs.transcribe(audio),
  },
  files:{
   sandbox:()=>files.readWorkSandbox(c),
   /** @param {unknown} [folder] @param {unknown} [root] */ list:(folder,root)=>files.listAgentFiles(c,folder,root),
   /** @param {{folder?:unknown,name?:unknown,root?:unknown}} file */ download:file=>files.downloadAgentFile(c,file),
   /** @param {{folder?:unknown,name?:unknown,root?:unknown}} file */ read:file=>files.readAgentFile(c,file),
  },
  screen:{
   read:()=>runs.screen(),
   wake:()=>runs.wakeScreen(),
   picture:()=>runs.screenPicture(),
   viewer:()=>runs.screenViewer(),
  },
 };
}
/** @typedef {ReturnType<typeof profileHandle>} ProfileEngine */

/** The Engine of a record. @param {EngineRecord} record @param {string|null} [company] */
function engineHandle(record,company=null) {
 return {
  company,
  /** One profile of this Engine; null for a Company profile that is not this Company's own (ADR 0014).
   * @param {string|null|undefined} profile @returns {ProfileEngine|null} */
  on(profile) {
   if(!profile) return null;
   if(company&&/^co-[0-9a-f]{32}$/.test(profile)&&profile!==companyProfile(company)) return null;
   return profileHandle({...record,profile});
  },
 };
}
/** @typedef {ReturnType<typeof engineHandle>} CompanyEngine */

/**
 * The Company's Engine, or null when it has none this install can reach. Given a `reader` (a person's own session), it is
 * the Company's Engine as that person may see it: null unless they are a Member, and with the Company's own profile
 * (`profile`, null while it has none) and every Engine profile of the Company, its own first (`profiles`), as the
 * database answers for them (company_engine_target).
 * @param {string|null|undefined} company @param {{reader?:any}} [options]
 * @returns {Promise<(CompanyEngine&{profile:string|null,profiles:string[]})|null>}
 */
export async function companyEngine(company,{reader}={}) {
 if(!reader) {
  const record=await engineOf(company);
  return record?{...engineHandle(record,company??null),profile:null,profiles:[]}:null;
 }
 const [{data,error},record]=await Promise.all([reader.rpc('company_engine_target',{c:company}),engineOf(company)]);
 const target=Array.isArray(data)?data[0]:data;
 if(error||!record||!target) return null;
 const profiles=Array.isArray(target.profiles)?target.profiles.filter((/** @type {unknown} */ name)=>typeof name==='string'):[];
 return {...engineHandle(record,company??null),profile:typeof target.profile==='string'&&target.profile?target.profile:null,profiles};
}

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * The Agents the reader sees in a Company, each with the profile it runs on, as the database answers for the reader's
 * own session (company_app_agents): an Agent hidden from them is not among them. Null when the database does not answer.
 * This is the one place the question is asked.
 * @param {any} db the reader's session @param {string} company
 * @returns {Promise<{agent:string,name:string,profile:string,main?:boolean,own?:boolean,connection?:string,[field:string]:unknown}[]|null>}
 */
export async function seenAgents(db,company) {
 if(typeof company!=='string'||!uuid.test(company)) return null;
 const {data,error}=await db.rpc('company_app_agents',{c:company});
 return error||!Array.isArray(data)?null:data.filter(row=>typeof row?.agent==='string');
}

/**
 * One Agent's profile as the reader may see it: found with the Agent's row and its profile's handle; invalid for an id
 * that is none; failed when the database does not answer; missing for an Agent the reader does not see (hidden from them,
 * of another Company, or gone); noEngine when the Company has no Engine this install can reach (the row is still given).
 * @param {any} db the reader's session @param {{company:string,agent:unknown}} target
 * @returns {Promise<{state:'found',agent:NonNullable<Awaited<ReturnType<typeof seenAgents>>>[number],engine:ProfileEngine}|{state:'noEngine',agent:NonNullable<Awaited<ReturnType<typeof seenAgents>>>[number],engine:null}|{state:'invalid'|'failed'|'missing',agent:null,engine:null}>}
 */
export async function agentEngine(db,{company,agent}) {
 if(typeof company!=='string'||!uuid.test(company)||typeof agent!=='string'||!uuid.test(agent)) return {state:'invalid',agent:null,engine:null};
 const [seen,engine]=await Promise.all([seenAgents(db,company),companyEngine(company)]);
 if(!seen) return {state:'failed',agent:null,engine:null};
 const row=seen.find(found=>found.agent===agent&&typeof found.profile==='string');
 if(!row) return {state:'missing',agent:null,engine:null};
 const profile=engine?.on(row.profile)??null;
 return profile?{state:'found',agent:row,engine:profile}:{state:'noEngine',agent:row,engine:null};
}

/** Stops each Run on its own profile of the Company's Engine (#478: a person's Stop ends every open Run of a Handover
 * chain, each on the Agent that runs it). A Run on a profile the Company may not use is left alone, and one the Engine
 * cannot stop now keeps the others going. Answers whether any Run was stopped.
 * @param {CompanyEngine|null} engine @param {{run:string,profile:string|null}[]} runs @returns {Promise<boolean>} */
export async function stopRuns(engine,runs) {
 let stopped=false;
 for(const {run,profile} of runs) {
  const on=run?engine?.on(profile):null;
  if(on) try { if(await on.runs.stop(run)) stopped=true; } catch(failure) { console.error('Run not stopped:',run,/** @type {any} */(failure)?.message||'unknown error'); }
 }
 return stopped;
}
