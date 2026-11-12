import { checkSettings } from '../lib/settings.mjs';
import { createWorkerClient, deliverBatch } from './webhooks.mjs';
import { closeOpenRuns } from '../lib/conversation-runs.mjs';
import { bundledHermes, provideBundledHermes } from '../lib/bundled-hermes.mjs';
checkSettings();
const db=createWorkerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const options={encryptionKey:process.env.WEBHOOK_ENCRYPTION_KEY,origin:process.env.APP_ORIGIN || 'http://localhost:3000'};
let stopping=false;
process.on('SIGTERM',()=>{stopping=true}); process.on('SIGINT',()=>{stopping=true});
// Webhooks and conversation runs keep separate loops, so a slow Hermes never delays a webhook.
const loop=async(name,work)=>{ while(!stopping) { try { await work(); } catch(error) { console.error(`${name} worker:`,error.message); } await new Promise(resolve=>setTimeout(resolve,1000)); } };
// A self-hosted install also gives each new company its bundled Hermes (ADR 0010); a hosted one has none.
const hermes=bundledHermes();
await Promise.all([loop('Webhook',()=>deliverBatch(db,options)),loop('Conversation',()=>closeOpenRuns(db,options)),
 hermes&&loop('Hermes',()=>provideBundledHermes(db,{hermes,encryptionKey:options.encryptionKey}))]);
