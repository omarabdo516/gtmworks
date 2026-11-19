import { createClient } from '@supabase/supabase-js';
import { registerEngine, attachEngine, readdressEngine } from '../lib/engine-record.mjs';

// Runs inside the web container after `compose up`, from scripts/install.sh (#380, ADR 0018). It registers the install's
// Engine record with the address and key the install gave the app, the key encrypted, and attaches every Company an
// existing install already has. A fresh install leaves one record waiting for first run's first Company; a repeat install
// leaves the records it finds as they are. It prints a count, never the key or the ciphertext.
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const read=async query=>{ const {data,error}=await query; if(error) throw new Error(error.message); return data||[]; };
const address=process.env.BUNDLED_HERMES_URL, key=process.env.HERMES_API_KEY;
if(!address||!key) throw new Error('The install Engine has no address or key');
const companies=await read(service.from('companies').select('id'));
const engines=await read(service.from('company_engines').select('id,company_id,address'));
const claimed=new Set(engines.filter(engine=>engine.company_id).map(engine=>engine.company_id));
const waiting=engines.filter(engine=>!engine.company_id);
// An install made by #380 keeps its Engine under the old install-wide `hermes` name. The template gives the same Engine
// its own container name, so its records move with it; the key and the volume stay as they are (#381, ADR 0018).
const legacy='http://hermes:8642';
for(const engine of engines) {
 if(engine.address===legacy&&address!==legacy) await readdressEngine(service,{id:engine.id,address});
}
let registered=0;
for(const company of companies) {
 if(claimed.has(company.id)) continue;
 if(waiting.length) await attachEngine(service,{id:waiting.shift().id,company:company.id});
 else await registerEngine(service,{company:company.id,address,key});
 registered++;
}
if(!companies.length&&!engines.some(engine=>!engine.company_id)) { await registerEngine(service,{address,key}); registered++; }
console.log(`Engine records: ${registered} registered`);
