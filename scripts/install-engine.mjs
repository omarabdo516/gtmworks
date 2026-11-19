import { createClient } from '@supabase/supabase-js';
import { settleInstallEngine } from '../lib/engine-record.mjs';

// Runs inside the web container after `compose up`, from scripts/install.sh (#380, #382, #378, ADR 0018). On a fresh
// install it registers the install's Engine record with the address and key the installer gave it, the key encrypted,
// and leaves it waiting for first run's first Company to name it. On an install made by the release before this one it
// adopts the Engine that install already runs as its one Company's Engine, so the Company keeps answering with the data,
// key and sign-in it had. On a repeat install of this release it writes nothing. It prints counts, never the key or the
// ciphertext.
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const address=process.env.ENGINE_ADDRESS, key=process.env.ENGINE_KEY;
if(!address||!key) throw new Error('The install Engine has no address or key');
const {registered,adopted}=await settleInstallEngine(service,{address,key});
console.log(`Engine records: ${registered} registered, ${adopted} adopted`);
