import { checkSettings } from '../lib/settings.mjs';
import { createWorkerClient, deliverBatch } from './webhooks.mjs';
import { closeOpenRuns, startQueuedTurns } from '../lib/conversation-runs.mjs';
import { bundledHermes } from '../lib/bundled-hermes.mjs';
import { keepCompanyProfiles, checkAgentTools, abandonConversationReservations } from '../lib/company-profiles.mjs';
import { appOrigin } from '../lib/app-origin.mjs';
checkSettings();
const db=createWorkerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const options={encryptionKey:process.env.WEBHOOK_ENCRYPTION_KEY,origin:appOrigin()};
let stopping=false;
process.on('SIGTERM',()=>{stopping=true}); process.on('SIGINT',()=>{stopping=true});
// Webhooks and conversation runs keep separate loops, so a slow Hermes never delays a webhook. A conversation pass
// closes ended runs, then starts the turns that waited for them (lib/conversation-runs.mjs). A loop waits `every`
// milliseconds between passes, and stops waiting as soon as the worker is asked to stop.
const pause=every=>new Promise(resolve=>{ const end=Date.now()+every; const tick=()=>stopping||Date.now()>=end?resolve():setTimeout(tick,Math.min(1000,end-Date.now())); tick(); });
const loop=async(name,work,every=1000)=>{ while(!stopping) { try { await work(); } catch(error) { console.error(`${name} worker:`,error.message); } await pause(every); } };
// A self-hosted install gives each company its own profile in the bundled Hermes and keeps its tools in step with the
// company's Agent level (ADR 0014); a hosted one has none. Every Connection's tools are read for the Owner's warning.
const hermes=bundledHermes();
const waiting=new Map();
await Promise.all([loop('Webhook',()=>deliverBatch(db,options)),loop('Conversation',async()=>{ await closeOpenRuns(db,options); await startQueuedTurns(db,options); }),
 hermes&&loop('Hermes',()=>keepCompanyProfiles(db,{hermes,encryptionKey:options.encryptionKey,waiting}),2000),
 loop('Agent tools',()=>checkAgentTools(db,{encryptionKey:options.encryptionKey}),300000),
 loop('Reserved runs',()=>abandonConversationReservations(db),60000)]);
