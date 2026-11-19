import { createClient } from '@supabase/supabase-js';
import { registerEngine, readdressEngine } from '../lib/engine-record.mjs';

// Runs inside the web container after `compose up`, from scripts/install.sh (#380, #382, ADR 0018). On a fresh install it
// registers the install's Engine record with the address and key the installer gave it, the key encrypted, and leaves it
// waiting for first run's first Company to name it. On a repeat install it leaves the records it finds as they are. It
// prints a count, never the key or the ciphertext.
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const read=async query=>{ const {data,error}=await query; if(error) throw new Error(error.message); return data||[]; };
const address=process.env.BUNDLED_HERMES_URL, key=process.env.HERMES_API_KEY;
if(!address||!key) throw new Error('The install Engine has no address or key');
const engines=await read(service.from('company_engines').select('id,company_id,address'));
// An install made by #380 keeps its Engine under the old install-wide `hermes` name. The template gives the same Engine
// its own container name, so its records move with it; the key and the volume stay as they are (#381, ADR 0018).
const legacy='http://hermes:8642';
for(const engine of engines) {
 if(engine.address===legacy&&address!==legacy) await readdressEngine(service,{id:engine.id,address});
}
// A fresh install leaves one waiting record for first run to name. Every Company of a later install already names its own
// record (#382), so nothing else is registered or attached here.
let registered=0;
if(!engines.length) { await registerEngine(service,{address,key}); registered=1; }
console.log(`Engine records: ${registered} registered`);
