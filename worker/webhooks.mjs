import { createClient } from '@supabase/supabase-js';
import { decryptSecret, newKey, retryAt, signature } from '../lib/agent-crypto.mjs';

// The worker's elevated database modules are this one and lib/conversation-runs.mjs.
export async function deliverBatch(db, options={}) {
 const {data:jobs,error}=await db.rpc('claim_webhook_deliveries');
 if(error) throw error;
 await Promise.all((jobs || []).map(async job=>{
  const attempts=job.attempts+1; let status=null; let failure='';
  try {
   const {data:config,error:configError}=await db.from('agent_webhooks').select('url,secret_encrypted').eq('company_id',job.company_id).single();
   if(configError || !config) throw new Error('Webhook configuration unavailable');
   const secret=decryptSecret(config.secret_encrypted,options.encryptionKey);
   // Assigning a card to an agent issues its run key now, so the key exists only inside this signed request and as a hash in the database.
   let run_key; if(job.event.event_type==='assigned') {
    // A key is a bearer credential and an HMAC does not hide it, so it is sent over HTTPS only (plain HTTP is allowed to this machine for development).
    // These two errors are stored as message catalogue keys, so the Owner reads them in their own language on Team > Agents.
    const target=new URL(config.url); if(target.protocol!=='https:' && !['localhost','127.0.0.1','[::1]'].includes(target.hostname)) throw new Error('runKeyHttpsOnly');
    const issued=newKey('run'); const {data:expires_at,error:issueError}=await db.rpc('issue_run_key_for',{c:job.company_id,card:job.card_id,agent:job.event.agent.id,hash:issued.hash,ttl_seconds:3600});
    if(issueError) throw new Error('runKeyUnavailable'); run_key={key:issued.key,expires_at};
   }
   const body=JSON.stringify({...job.event,...(run_key ? {run_key} : {}),card_url:new URL(job.event.card_path,options.origin).toString()});
   const response=await (options.fetch || fetch)(config.url,{method:'POST',headers:{'Content-Type':'application/json','X-GTMWorks-Signature':signature(secret,body),'X-GTMWorks-Delivery':String(job.id)},body,signal:AbortSignal.timeout(5000),redirect:'error'});
   status=response.status; if(!response.ok) throw new Error(`HTTP ${response.status}`);
   const {error:updateError}=await db.from('webhook_deliveries').update({status:'delivered',attempts,last_status:status,last_error:null,delivered_at:new Date().toISOString()}).eq('id',job.id).eq('status','delivering');
   if(updateError) throw updateError;
   return;
  } catch(error) { failure=error instanceof Error ? error.message.slice(0,500) : 'Delivery failed'; }
  const next=retryAt(job.created_at,attempts);
  const {error:updateError}=await db.from('webhook_deliveries').update({status:next?'pending':'failed',attempts,last_status:status,last_error:failure,next_attempt_at:next || new Date().toISOString()}).eq('id',job.id).eq('status','delivering');
  if(updateError) console.error('Unable to update webhook delivery',job.id,updateError.message);
 }));
 return (jobs || []).length;
}
export function createWorkerClient(url,key) { if(!url || !key) throw new Error('Worker database configuration missing'); return createClient(url,key,{auth:{persistSession:false}}); }
