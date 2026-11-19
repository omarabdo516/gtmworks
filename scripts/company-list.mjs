import { createClient } from '@supabase/supabase-js';

// `gtmworks company list` and `gtmworks status` (#382, ADR 0018) run this inside the web container: it names every Company
// with the Engine it is made on and that Engine's state, and every Engine record, waiting or not. It reads the Engine
// records as server code does and asks each Engine's own /health, so an Engine that is stopped or unhealthy is said in
// plain words. It prints addresses, names and states only, never a key.
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL||'http://gateway:8080',process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const mode=process.argv[2]==='engines'?'engines':'companies';
const read=async query=>{ const {data,error}=await query; if(error) throw new Error(error.message); return data||[]; };
const companies=await read(service.from('companies').select('id,name,created_at').order('created_at'));
const engines=await read(service.from('company_engines').select('id,company_id,address,created_at').order('created_at'));
const byCompany=new Map(engines.filter(engine=>engine.company_id).map(engine=>[engine.company_id,engine]));
const state=async address=>{
 if(!address) return 'no Engine';
 try {
  const answer=await fetch(`${address}/health`,{signal:AbortSignal.timeout(5000)});
  return answer.status===200?'healthy':`not healthy (HTTP ${answer.status})`;
 } catch {
  return 'unreachable';
 }
};
let unhealthy=0;
if(mode==='engines') {
 if(!engines.length) console.log('No Engines are recorded.');
 for(const engine of engines) {
  const found=await state(engine.address);
  if(found!=='healthy') unhealthy++;
  const company=companies.find(one=>one.id===engine.company_id)?.name;
  console.log(`Engine ${engine.address}: ${found} (${company?`Company "${company}"`:'waiting for a Company'})`);
 }
} else {
 if(!companies.length) console.log('No Companies yet.');
 for(const company of companies) {
  const engine=byCompany.get(company.id);
  console.log(`Company "${company.name}": ${engine?`Engine ${engine.address} (${await state(engine.address)})`:'no Engine'}`);
 }
 for(const engine of engines.filter(engine=>!engine.company_id)) {
  console.log(`Engine ${engine.address}: waiting for a Company`);
 }
}
if(unhealthy) process.exitCode=1;
