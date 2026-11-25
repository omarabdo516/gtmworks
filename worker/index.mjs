import { checkSettings } from '../lib/settings.mjs';
import { createClient } from '@supabase/supabase-js';
import { closeOpenRuns, startQueuedTurns } from '../lib/conversation-runs.mjs';
import { driveChannelRuns, driveNoteRuns } from '../lib/channel-runs.mjs';
import { markConversationSessions } from '../lib/conversation-archive.mjs';
import { driveHandovers } from '../lib/handovers.mjs';
import { driveGoodMornings } from '../lib/good-morning-runs.mjs';
import { keepRunningRoutines } from '../lib/routine-runs.mjs';
import { selfHosted as isSelfHosted } from '../lib/company-engine.mjs';
import { engineFor } from '../lib/engine.mjs';
import { keepCompanyProfiles, keepAgentProfiles, moveAgentProfiles, releaseKeyWaits, checkAgentTools, abandonConversationReservations, keepLeadSouls } from '../lib/company-profiles.mjs';
import { keepSharedSkills } from '../lib/shared-skills.mjs';
import { keepAgentRules } from '../lib/agent-rules.mjs';
import { logHeldAgentChanges } from '../lib/agent-change-log.mjs';
import { keepProviderAccounts } from '../lib/provider-switches.mjs';
import { keepFallbackModels } from '../lib/fallback-model.mjs';
checkSettings();
// The worker's elevated database client; lib/conversation-runs.mjs and lib/channel-runs.mjs use it.
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
let stopping=false;
process.on('SIGTERM',()=>{stopping=true}); process.on('SIGINT',()=>{stopping=true});
// Conversation runs, queued turns, channel Runs (#23), note Runs (#22) and a job Lead handed another Agent (#317) keep
// separate loops, so a start that waits on an engine never delays closing other conversations' runs; a
// turn starts once its conversation's run was closed (lib/conversation-runs.mjs). A loop waits `every`
// milliseconds between passes, and stops waiting as soon as the worker is asked to stop.
const pause=every=>new Promise(resolve=>{ const end=Date.now()+every; const tick=()=>stopping||Date.now()>=end?resolve():setTimeout(tick,Math.min(1000,end-Date.now())); tick(); });
// The stack starts the worker beside the gateway and PostgREST (after a backup, an update), so the database may not answer
// yet: wait up to a minute for one answer before the first pass. A database that never answers still fails every pass.
for(let tries=60;tries>0&&!stopping;tries--) { const {error}=await db.rpc('setup_is_open').then(answer=>answer,error=>({error})); if(!error) break; await pause(1000); }
const loop=async(name,work,every=1000)=>{ while(!stopping) { try { await work(); } catch(error) { console.error(`${name} worker:`,error.message); } await pause(every); } };
// A self-hosted install gives each company its own profile in the bundled Hermes and keeps its tools, and those of each
// Agent's own profile, in step with the company's Agent level (ADR 0014, ADR 0016), gives each company one shared Skills
// folder that every one of its Agent profiles reads, holding the lessons its team approved (#122), writes each Agent's team rules into its profile's SOUL.md (#345), gives a main Agent still holding the old default soul the manager's (#434), and moves each Agent
// still on its company's profile to its own once that profile reads the folder (#121), and starts an Agent waiting for a
// model once its own profile has the Company's Providers (#660); a hosted one has none. Every
// Company and Agent profile is read, so one the Engine lost is made again. Each call asks the one module for the Engine
// of the Company it serves (lib/company-engine.mjs), and Runs go to that Engine on each Agent's profile (#342, ADR 0018).
const selfHosted=isSelfHosted();
const waiting=new Map(); const moving=new Map(); const keyWaits=new Map(); const providerAccounts=new Map(); const fallbackModels=new Map();
await Promise.all([loop('Conversation runs',()=>closeOpenRuns(db,{})),loop('Queued turns',()=>startQueuedTurns(db,{})),
 loop('Channel runs',()=>driveChannelRuns(db,{})),
 loop('Note runs',()=>driveNoteRuns(db,{})),
 loop('Handovers',()=>driveHandovers(db,{})),
 // Each archived or restored Conversation's session takes the same mark in its Engine once the Engine answers (#674).
 loop('Conversation archive marks',()=>markConversationSessions(db),5000),
 // Each finished run of a Company's Good morning job becomes that morning's message for its Members (#183).
 loop('Good morning',()=>driveGoodMornings(db),30000),
 // Which Routines each Agent runs now, so its face shows it working (#699); the database counts each set two minutes.
 loop('Running Routines',()=>keepRunningRoutines(db),15000),
 selfHosted&&loop('Hermes',async()=>{ await keepCompanyProfiles(db,{waiting}); await keepLeadSouls(db,{}); },2000),
 selfHosted&&loop('Agent profiles',async()=>{ await keepAgentProfiles(db,{}); await moveAgentProfiles(db,{waiting:moving,driverFor:connection=>engineFor(connection)}); await releaseKeyWaits(db,{waiting:keyWaits,driverFor:connection=>engineFor(connection)}); },2000),
 // What gtmworks writes into each profile (its team's lessons, its rules) is written when it changed, with a slow pass for
 // drift, and an Engine that does not answer is left alone a while (#772): its own loop, so a slow write never holds a
 // new Agent's profile or an Agent waiting for a model key.
 selfHosted&&loop('Agent upkeep',async()=>{ await keepSharedSkills(db,{}); await keepAgentRules(db,{}); },2000),
 selfHosted&&loop('Agent tools',()=>checkAgentTools(db,{}),300000),
 loop('Reserved runs',()=>abandonConversationReservations(db),60000),
 // Each Company's Engine takes its subscription accounts in the Owner's order, and each move it made from one account to
 // the next is logged once (#621).
 loop('Provider accounts',()=>keepProviderAccounts(db,{memory:providerAccounts}),10000),
 // Every profile a Company's Agents run on holds the Company's Fallback model, or none (#622): an Agent made or moved later too.
 loop('Fallback model',()=>keepFallbackModels(db,{memory:fallbackModels}),10000),
 // A memory or skill change whose log the app could not write is logged once by this pass (#370).
 loop('Held changes',()=>logHeldAgentChanges(db),60000)]);
