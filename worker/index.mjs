import { checkSettings } from '../lib/settings.mjs';
import { createClient } from '@supabase/supabase-js';
import { closeOpenRuns, followOpenRuns, startQueuedTurns } from '../lib/conversation-runs.mjs';
import { driveChannelRuns, driveNoteRuns } from '../lib/channel-runs.mjs';
import { bundledHermes } from '../lib/bundled-hermes.mjs';
import { keepCompanyProfiles, keepAgentProfiles, moveAgentProfiles, checkAgentTools, abandonConversationReservations } from '../lib/company-profiles.mjs';
import { keepSharedSkills } from '../lib/shared-skills.mjs';
import { engineFor } from '../lib/engine.mjs';
checkSettings();
// The worker's elevated database client; lib/conversation-runs.mjs and lib/channel-runs.mjs use it.
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const options={encryptionKey:process.env.WEBHOOK_ENCRYPTION_KEY};
let stopping=false;
process.on('SIGTERM',()=>{stopping=true}); process.on('SIGINT',()=>{stopping=true});
// Conversation runs, queued turns, channel Runs (#23) and note Runs (#22) keep separate loops, so a start that waits on an engine never delays closing other conversations' runs; a
// turn starts once its conversation's run was closed (lib/conversation-runs.mjs). A loop waits `every`
// milliseconds between passes, and stops waiting as soon as the worker is asked to stop.
const pause=every=>new Promise(resolve=>{ const end=Date.now()+every; const tick=()=>stopping||Date.now()>=end?resolve():setTimeout(tick,Math.min(1000,end-Date.now())); tick(); });
const loop=async(name,work,every=1000)=>{ while(!stopping) { try { await work(); } catch(error) { console.error(`${name} worker:`,error.message); } await pause(every); } };
// A self-hosted install gives each company its own profile in the bundled Hermes and keeps its tools, and those of each
// Agent's own profile, in step with the company's Agent level (ADR 0014, ADR 0016), gives each company one shared Skills
// folder that every one of its Agent profiles reads, holding the lessons its team approved (#122), and moves each Agent
// still on its company's profile to its own once that profile reads the folder (#121); a hosted one has none. Every
// Connection's profile is read, so one the Engine lost is made again.
const hermes=bundledHermes();
const waiting=new Map(); const moving=new Map();
// Each open run's events are followed while it works (#141), one follower per run, all stopped with the worker.
const following=new Map(); const resting=new Map();
await Promise.all([loop('Conversation runs',()=>closeOpenRuns(db,options)),loop('Run steps',()=>followOpenRuns(db,{encryptionKey:options.encryptionKey,following,resting}),2000),loop('Queued turns',()=>startQueuedTurns(db,options)),
 loop('Channel runs',()=>driveChannelRuns(db,options)),
 loop('Note runs',()=>driveNoteRuns(db,options)),
 hermes&&loop('Hermes',()=>keepCompanyProfiles(db,{hermes,encryptionKey:options.encryptionKey,waiting}),2000),
 hermes&&loop('Agent profiles',async()=>{ await keepAgentProfiles(db,{hermes}); await keepSharedSkills(db,{hermes}); await moveAgentProfiles(db,{hermes,waiting:moving,driver:engineFor(hermes)}); },2000),
 loop('Agent tools',()=>checkAgentTools(db,{encryptionKey:options.encryptionKey}),300000),
 loop('Reserved runs',()=>abandonConversationReservations(db),60000)]);
for(const follower of following.values()) follower.abort();
