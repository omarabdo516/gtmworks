import { AsyncLocalStorage } from 'node:async_hooks';
import { engineOf } from '../company-engine.mjs';
import { companyProfile } from '../agent-toolsets.mjs';
import { hermesEngine } from './contract.mjs';
import { findSessionMessage, readSessionImage, readSessionList, readSessionMessages, readSessionUsage, readUsage, sessionHeld, titleSession } from './sessions.mjs';
import { readRun, readRunEvents, startSessionRun } from './runs.mjs';
import { testHermes } from './version.mjs';
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
import * as board from './board.mjs';
import * as plugin from './plugin.mjs';
import { readRunReply } from './routines.mjs';
import { engineDashboardRequest, engineDashboardSocket } from './transport.mjs';
import { holdsSecret, secretCut, secretFrames } from './secret-scan.mjs';
// The Engine's own cap for a Card's file (#843), for a check before anything is sent.
export { cardFileLimit } from './board.mjs';
// A turn's tool calls as a reply's steps (#875), read beside the messages of the same page; the driver's own reading.
export { stepsBetween } from './sessions.mjs';
// A stored reply with gtmworks's own tool blocks taken out (#875), as the Run record's reply is read.
export { takeToolCalls } from './runs.mjs';

// The Engine handle (ADR 0031, #782): the one way code reaches a Company's Engine. There are two ways in:
// - `companyEngine(company)`: the Company's Engine, or null when it has none this install can reach. `on(profile)` is
//   one profile of it (`default` is the Engine's root profile, which holds the Company's model sign-ins);
// - `agentEngine(db, {company, agent})`: one Agent's profile as the reader whose session `db` is may see it. An Agent
//   hidden from that reader is `missing`, in this one place, for every kind of Engine read.
// A profile's handle carries the Engine's capabilities grouped as the Engine has them: `runs` (the methods of the engine
// contract, ADR 0009) and `sessions` here, and each further capability as it moves behind the handle. The Engine's own
// Kanban board (`board`) is the Engine's, not one profile's, so it hangs on the Company's Engine itself. Every request any of
// them makes goes through the one transport (lib/engine/transport.mjs), which keeps the deadline, the limit on calls at
// once, the health and the cause; no caller passes a raw address, key and profile.
//
// The record of the Company's Engine is the database's (lib/company-engine.mjs), read once per request or worker pass.
//
// The seam (ADR 0031): behind a handle is the Hermes driver, and a test reaches it through the Hermes wire fake
// (tests/fake-hermes.mjs). A test of a place where Runs happen may give the smaller fake of the contract's methods in its
// stead, for the work it runs (`withEngineContract`), and a test that must make one call of a capability answer
// otherwise than the wire fake can (a race, a refusal at one step) may put that one method in its place
// (`withEngineCapabilities`). Both hold only for the work they run; nothing else in the product changes which driver
// answers, and no function takes a driver or a lookup as a parameter.

/** @typedef {{address:string,key:string,managementAddress?:string}} EngineRecord */
/** @typedef {EngineRecord&{profile:string}} ProfileConnection */
/** @typedef {(connection:ProfileConnection)=>import('../engine.mjs').Engine} ContractFor */

/** @typedef {{contract?:ContractFor,capabilities?:(connection:ProfileConnection,handle:any)=>Record<string,Record<string,Function>>}} Adapter */
/** @type {AsyncLocalStorage<Adapter>} */
const adapters=new AsyncLocalStorage();
/** Runs `work` with the given fake of the contract's methods answering every Run a handle starts, reads or stops in it
 * (tests of a place). @template T @param {ContractFor} contractFor @param {()=>T} work @returns {T} */
export function withEngineContract(contractFor,work) { return adapters.run({...adapters.getStore(),contract:contractFor},work); }
/** Runs `work` with some methods of a profile's capabilities answered by `capabilities(connection, handle)` in place of
 * the driver's (tests). @template T @param {NonNullable<Adapter['capabilities']>} capabilities @param {()=>T} work @returns {T} */
export function withEngineCapabilities(capabilities,work) { return adapters.run({...adapters.getStore(),capabilities},work); }

/** One profile of an Engine, with its capabilities. `listed` keeps the model list each profile's Engine read gave while
 * this Company's handle lives (one request or pass), so several parts of a page read it once.
 * @param {ProfileConnection} connection @param {Map<string,Promise<any>>} listed */
function profileHandle(connection,listed=new Map()) {
 const adapter=adapters.getStore();
 const runs=(adapter?.contract??hermesEngine)(connection);
 const c=connection;
 const handle={
  profile:connection.profile,
  // Whether the profile's Run API answers this install's key, on the pinned release, with what it offers.
  test:()=>testHermes(c),
  // The methods of the engine contract (ADR 0009): a Run's start, read, Steps, question, Permission request and stop.
  runs,
  sessions:{
   /** @param {string} session */ read:session=>runs.session(session),
   /** @param {string} session @param {{offset?:number,limit?:number}} [page] */ messages:(session,page)=>readSessionMessages(c,session,page),
   /** @param {string} session */ tokenUse:session=>readSessionUsage(c,session),
   // One message as a page shows it, found from the newest back, and the n-th image a person's message carries (#880):
   // what a Conversation's file is read from each time it is opened, never a copy.
   /** @param {string} session @param {(message:any)=>boolean} matches */ find:(session,matches)=>findSessionMessage(c,session,matches),
   /** @param {string} session @param {(message:any)=>boolean} matches @param {number} n */ image:(session,matches,n)=>readSessionImage(c,session,matches,n),
   /** @param {string} session @param {boolean} archived */ mark:(session,archived)=>runs.markSession(session,archived),
   /** @param {string} session @param {string} title */ title:(session,title)=>titleSession(c,session,title),
   /** @param {{offset?:number,limit?:number}} [page] */ list:page=>readSessionList(c,page),
   /** @param {string} session */ held:session=>sessionHeld(c,session),
   /** @param {number} days */ usage:days=>readUsage(c,days),
   /** @param {string} session */ reply:session=>readRunReply(c,session),
   // A person's message as one Run on their Conversation's session (#876), and that Run's events as they happen: its
   // reply as it is written and its steps as they start and end. Nothing of either is kept in gtmworks.
   /** @param {{session:string,input:unknown,instructions?:string,model?:import('../engine.mjs').ModelChoice|null,history?:import('../engine.mjs').HistoryEntry[],idempotencyKey:string,retry?:boolean}} message */ send:message=>startSessionRun({...c,...message}),
   /** @param {string} run @param {{signal?:AbortSignal}} [options] */ follow:(run,{signal}={})=>readRunEvents({...c,run,signal}),
   // Whether a Run waits its turn behind another on its session (#877), as the Engine reads it now.
   /** @param {string} run */ queued:run=>readRun({...c,run}).then(read=>read.queued===true),
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
   read:()=>{ if(!listed.has(c.profile)) listed.set(c.profile,runs.models()); return /** @type {Promise<import('../engine.mjs').AgentModels>} */(listed.get(c.profile)); },
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
  // gtmworks's plugin of the main Agent's profile (#884): kept placed by the worker, and told which sessions are an Owner's.
  plugin:{
   read:()=>plugin.readMainAgentPlugin(c),
   offered:()=>plugin.readOfferedPlugin(c),
   /** @param {{files:string[],enabled:boolean}} differs */ place:differs=>plugin.placeMainAgentPlugin(c,differs),
   busy:()=>plugin.engineBusy(c),
   restart:()=>plugin.restartEngine(c),
   /** @param {{session:string,person:string,seconds?:number}} mark */ markOwner:mark=>plugin.markOwnerSession(c,mark),
   ownerSessions:()=>plugin.readOwnerSessions(c),
  },
  screen:{
   read:()=>runs.screen(),
   wake:()=>runs.wakeScreen(),
   picture:()=>runs.screenPicture(),
   viewer:()=>runs.screenViewer(),
  },
 };
 const over=adapter?.capabilities?.(connection,handle);
 if(over) for(const [name,methods] of Object.entries(over)) Object.assign(/** @type {any} */(handle)[name],methods);
 return handle;
}
/** @typedef {ReturnType<typeof profileHandle>} ProfileEngine */

/** The Engine of a record. @param {EngineRecord} record @param {string|null} [company] */
function engineHandle(record,company=null) {
 const listed=new Map();
 return {
  company,
  // Where the Engine answers, for a log line or the upkeep's pacing; never a way to call it.
  address:record.address,
  // The Engine's own Kanban board (spec #831): the Engine's default board, which is the Company's one board. It belongs
  // to the Engine, not to one profile.
  board:{
   read:()=>board.readBoard(record),
   /** One Card whole, comments, events and Runs (#835). @param {string} id */ task:id=>board.readTask(record,id),
   // The board's live changes (#840): the ids of the Cards that changed, as the Engine's event stream names them.
   /** @param {Parameters<typeof board.followBoard>[1]} listener */ follow:listener=>board.followBoard(record,listener),
   /** @param {Parameters<typeof board.makeCard>[1]} card */ make:card=>board.makeCard(record,card),
   /** @param {Parameters<typeof board.assignCard>[1]} change */ assign:change=>board.assignCard(record,change),
   // A Card's title, body or status changed, and the Cards it waits for (#837).
   /** @param {Parameters<typeof board.editCard>[1]} change */ edit:change=>board.editCard(record,change),
   /** @param {Parameters<typeof board.linkCards>[1]} link */ link:link=>board.linkCards(record,link),
   /** @param {Parameters<typeof board.unlinkCards>[1]} link */ unlink:link=>board.unlinkCards(record,link),
   dispatch:()=>board.dispatchNow(record),
   // A comment under a person's name, the Engine's stop for a Card's open Run, and a move that holds it or lets it go on (#838).
   /** @param {Parameters<typeof board.commentTask>[1]} comment */ comment:comment=>board.commentTask(record,comment),
   /** @param {Parameters<typeof board.reclaimTask>[1]} stop */ stop:stop=>board.reclaimTask(record,stop),
   /** @param {Parameters<typeof board.moveTask>[1]} move */ move:move=>board.moveTask(record,move),
   /** A review a person passed (#839). @param {Parameters<typeof board.completeTask>[1]} done */ complete:done=>board.completeTask(record,done),
   // A Card's files (#843): a person's added, and one read back by its id.
   /** @param {Parameters<typeof board.attachCardFile>[1]} file */ attach:file=>board.attachCardFile(record,file),
   /** @param {number} id */ file:id=>board.readCardFile(record,id),
   taskIds:()=>board.readTaskIds(record),
   // Archiving and restoring a Card (#842): the archived Cards, the Engine's archive, and the move back where it was.
   archived:()=>board.readArchived(record),
   /** @param {string} id */ archive:id=>board.archiveCard(record,{id}),
   /** @param {string} id @param {{resume?:boolean}} [how] */ restore:(id,how={})=>board.restoreCard(record,{id,...how}),
  },
  /** One profile of this Engine; null for a Company profile that is not this Company's own (ADR 0014).
   * @param {string|null|undefined} profile @returns {ProfileEngine|null} */
  on(profile) {
   if(!profile) return null;
   if(company&&/^co-[0-9a-f]{32}$/.test(profile)&&profile!==companyProfile(company)) return null;
   return profileHandle({...record,profile},listed);
  },
  // The Engine's own dashboard (#869), passed through for gtmworks's gate (lib/engine-dashboard.mjs), which asks who
  // may open it first: one request, or one socket joined to the browser's.
  dashboard:{
   /** @param {Parameters<typeof engineDashboardRequest>[1]} asked */ request:asked=>engineDashboardRequest(record,asked),
   /** @param {Parameters<typeof engineDashboardSocket>[1]} asked @param {import('node:stream').Duplex} browser @param {Buffer} early */
   socket:(asked,browser,early)=>engineDashboardSocket(record,asked,browser,early),
   // Whether an answer on its way to the browser holds the Engine's own key (#871), which the gate never lets pass; and
   // a stream that ends an answer read as it comes before the key would pass. The key itself stays here.
   /** @param {Buffer} bytes */ holdsKey:bytes=>holdsSecret(bytes,record.key),
   keyCut:()=>secretCut(record.key),
   // And a socket's guard (#892): its head read whole, its frames read as they come, ending it before the key would pass.
   keyGuard:()=>({holds:(/** @type {Buffer} */ bytes)=>holdsSecret(bytes,record.key),frames:secretFrames(record.key)}),
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

// What the driver knows that is no call to the Engine: names, limits and shapes the library reads beside the handle.
// They come through here, so nothing outside the handle imports the driver (ADR 0009, #784).
export { signInProviders } from './providers.mjs';
export { sameChain } from './models.mjs';
export { essentialSkill } from './skills.mjs';
export { speakLimit, speechEnvs } from './speech.mjs';
export { isSilentReply } from './sessions.mjs';
export { isRoutineSchedule } from './routines.mjs';
export { libraryRoot, workSegments } from './files.mjs';
