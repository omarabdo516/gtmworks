import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from '@supabase/supabase-js';
import { engineRecord } from './engine-record.mjs';
import { companyProfile } from './agent-toolsets.mjs';
import { supabaseSettings } from './supabase-settings.mjs';

// One server-role client for the module, made on first use, so every call answers from the same connection as the rest of
// the server code; a module run with no database at all (a unit test) has no client and answers no Engine. The address is
// read at run time through `supabaseSettings`, never from a literal `process.env.NEXT_PUBLIC_*`: Next.js inlines those in
// the build, and one app build serves every local test lane.
let service;
const serviceDb=()=>{
 if(service!==undefined) return service;
 const url=supabaseSettings().url, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 service=url&&key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}):null;
 return service;
};

// One module answers "the Engine of this Company" (ADR 0018): its address and the key that opens it. The database's Engine
// record for the Company is the only source; with no Company, or none the record can give (the Engine is not made or not
// running, or this install cannot decrypt it), the answer is null, which every caller shows as its one state (`noEngine`),
// never an exception. A module given a database client uses it; otherwise the server's own service-role client does. A
// module with no database at all (a unit test) has no Engine to answer.
// The record is read once per request, not once per helper (#771): the answer for a Company is kept two seconds by the
// client that read it, so one page's or one request's helpers share one read, and a change to an Engine is seen by the
// next request. A read that failed, or found no Engine, is not kept: an Engine made a moment ago is found at once.
// A worker pass reads each Company's record once however long it lasts (#781): `enginePass` keeps every answer, none
// included, until the pass ends, and the next pass reads again.
const kept=new WeakMap();
const keptFor=2000;
/** @type {AsyncLocalStorage<Map<string,Promise<{address:string,key:string}|null>>>} */
const pass=new AsyncLocalStorage();
/** Runs one worker pass, in which each Company's Engine record is read once. @template T @param {()=>Promise<T>} work @returns {Promise<T>} */
export function enginePass(work) { return pass.run(new Map(),work); }
/** @param {string|null|undefined} company @param {any} [db] @returns {Promise<{address:string,key:string}|null>} */
export async function engineOf(company,db=null) {
 const store=db??serviceDb();
 if(!store) return null;
 const inPass=pass.getStore();
 if(inPass) {
  const key=String(company);
  if(!inPass.has(key)) inPass.set(key,engineRecord(store,company));
  return inPass.get(key)??null;
 }
 if(!kept.has(store)) kept.set(store,new Map());
 const answers=kept.get(store); const key=String(company);
 const known=answers.get(key);
 if(known&&Date.now()-known.at<keptFor) return known.read;
 const read=engineRecord(store,company);
 answers.set(key,{at:Date.now(),read});
 read.then(found=>{ if(!found) answers.delete(key); },()=>answers.delete(key));
 return read;
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

// Stops each Run on its own profile's Engine (#478: the person's Stop ends every open Run of a Handover chain, each on the
// Agent that runs it). A Run whose profile the Company may not use is left alone. Answers whether any Run was stopped.
/** @param {{run:string,profile:string|null}[]} runs @param {string} company @param {{address:string,key:string}|null} hermes
 * @param {(connection:{address:string,key:string,profile:string})=>{stop:(run:string)=>Promise<boolean>}} engineFor @returns {Promise<boolean>} */
export async function stopOnProfiles(runs,company,hermes,engineFor) {
 let stopped=false;
 for(const {run,profile} of runs) {
  const connection=run?onProfile(profile,company,hermes):null;
  // One Run the Engine cannot stop now does not keep the others going.
  if(connection) try { if(await engineFor(connection).stop(run)) stopped=true; } catch(failure) { console.error('Run not stopped:',run,failure?.message||'unknown error'); }
 }
 return stopped;
}
