import { createClient } from '@supabase/supabase-js';

// `gtmworks company list` and `gtmworks status` (#382, #383, ADR 0018, 0019) run this inside the web container: it names
// every Company with the Engine it is made on and that Engine's state, every Company still waiting behind a first-Owner
// link, and every Engine record. It reads the Engine records and the links as server code does and asks each Engine's own
// /health, so an Engine that is stopped or unhealthy is said in plain words. It prints addresses, names and states only,
// never a key and never a link's secret or hash.
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL||'http://gateway:8080',process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const mode=process.argv[2]==='engines'?'engines':'companies';
const read=async query=>{ const {data,error}=await query; if(error) throw new Error(error.message); return data||[]; };
const companies=await read(service.from('companies').select('id,name,created_at').order('created_at'));
const engines=await read(service.from('company_engines').select('id,company_id,address,created_at').order('created_at'));
// A link whose Company was not made yet names it; the Company itself exists nowhere until the link is used (#383).
const links=await read(service.from('company_owner_links').select('engine_id,company_name,claimed_at'));
const byCompany=new Map(engines.filter(engine=>engine.company_id).map(engine=>[engine.company_id,engine]));
const waitingName=new Map(links.filter(link=>!link.claimed_at).map(link=>[link.engine_id,link.company_name]));
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
  const waiting=waitingName.get(engine.id);
  const holds=company?`Company "${company}"`:waiting?`Company "${waiting}" waiting for its Owner`:'waiting for a Company';
  console.log(`Engine ${engine.address}: ${found} (${holds})`);
 }
} else {
 if(!companies.length) console.log('No Companies yet.');
 for(const company of companies) {
  const engine=byCompany.get(company.id);
  console.log(`Company "${company.name}": ${engine?`Engine ${engine.address} (${await state(engine.address)})`:'no Engine'}`);
 }
 for(const engine of engines.filter(engine=>!engine.company_id)) {
  const waiting=waitingName.get(engine.id);
  console.log(waiting?`Company "${waiting}": waiting for its Owner (Engine ${engine.address} (${await state(engine.address)}))`
   :`Engine ${engine.address}: waiting for a Company`);
 }
}
if(unhealthy) process.exitCode=1;
