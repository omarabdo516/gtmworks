import { createClient } from '@supabase/supabase-js';
import { engineRecord } from './engine-record.mjs';
import { companyProfile } from './agent-levels.mjs';
import { supabaseSettings } from './supabase-settings.mjs';

// Hermes ships inside the install (ADR 0010), on the compose network only, and is the only Hermes (#342). The install's
// own address and key are read here for two things only: the installer writes them into the install's Engine record, and a
// module with no database configured (a unit test) still answers from the environment. Every app and worker process has a
// database, and there the record is the source of truth (#380, ADR 0018).
/** @param {Record<string,string|undefined>} env @returns {{address:string,key:string}|null} */
export const hermesAt=(env=process.env)=>env.BUNDLED_HERMES_URL&&env.HERMES_API_KEY?{address:env.BUNDLED_HERMES_URL,key:env.HERMES_API_KEY}:null;

// One server-role client for the module, made on first use. Kept here so every call answers from the same connection as
// the rest of the server code; a module run with no database at all (a unit test) answers null and falls back below.
// The address comes from the app's own settings (`supabaseSettings`), which reads it when the app runs: Next.js inlines a
// literal `process.env.NEXT_PUBLIC_*` in the build, and one app build serves every local test lane, so a literal here
// made every lane's Engine record come from the lane the build was made on (the browser suite's lane 0).
let service;
const serviceDb=()=>{
 if(service!==undefined) return service;
 const url=supabaseSettings().url, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 service=url&&key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}):null;
 return service;
};

// One module answers "the Engine of this Company" (ADR 0018): its address and the key that opens it. The database's Engine
// record for the Company answers; with no Company, or none the record can give (the Engine is not made or not running, or
// this install cannot decrypt it), the answer is null, which every caller shows as its one state (`noEngine`), never an
// exception. A module given a database client uses it; otherwise the server's own service-role client does. Only a module
// with no database at all reads the install's environment, which is where the installer wrote the record from.
/** @param {string|null|undefined} company @param {any} [db] @returns {Promise<{address:string,key:string}|null>} */
export async function engineOf(company,db=null) {
 const store=db??serviceDb();
 if(store) return engineRecord(store,company);
 return hermesAt(process.env);
}

// Whether this install keeps each Company's profiles on its own Engines (#342, ADR 0018). A hosted install keeps none.
// Which Engine serves a Company is that Company's record's answer (engineOf); the install's environment names no Engine,
// so it tells this one thing and nothing else.
/** @param {Record<string,string|undefined>} env @returns {boolean} */
export function selfHosted(env=process.env) {
 return env.GTMWORKS_SELF_HOSTED==='true';
}

// A Run's target: the Engine of the Company the database pinned the Run to, on the profile it pinned for it. Every caller
// gives the Engine `engineOf` answered for that Company; without one there is no target. A Company profile serves its own
// Company only (ADR 0014); an Agent's own profile is checked by the database against its Agent (ADR 0016). Null when there
// is no profile or no Engine to reach.
/** @param {string|null|undefined} profile @param {string|null} [company] @param {{address:string,key:string}|null} hermes */
export function onProfile(profile,company=null,hermes=null) {
 if(!hermes||!profile) return null;
 if(company&&/^co-[0-9a-f]{32}$/.test(profile)&&profile!==companyProfile(company)) return null;
 return {...hermes,profile};
}
