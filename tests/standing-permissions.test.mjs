import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAgentPermissions, revokeAgentPermission, standingEntry, standingLabel } from '../lib/standing-permissions.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// #166: an Agent's standing permissions are its own profile's entries in the Engine, each with who allowed it and when
// from gtmworks's record; an Agent the reader does not see is not found, one on the Company's shared profile has none
// of its own, and a revoke is asked of the database first, written to that one profile only, and logged once.
const company='10000000-0000-0000-0000-000000000001';
const [ads,seo,lead]=['3b000000-0000-0000-0000-000000000011','3b000000-0000-0000-0000-000000000021','3b000000-0000-0000-0000-000000000031'];
const hex=id=>id.replaceAll('-','');
const adsProfile=`ag-${hex(ads)}`; const seoProfile=`ag-${hex(seo)}`; const shared=`co-${hex(company)}`;
const install=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'});
const profileOn=(fake,name,list)=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{command_allowlist:list},credentials:{}});
const rows=[
 {agent:ads,name:'Ads',connection:'f1000000-0000-0000-0000-000000000011',profile:adsProfile,main:false,own:true},
 {agent:seo,name:'SEO',connection:'f1000000-0000-0000-0000-000000000021',profile:seoProfile,main:false,own:true},
 {agent:lead,name:'Writer',connection:'f1000000-0000-0000-0000-000000000031',profile:shared,main:false,own:false},
];
// `shared` is the database every server process reads: two sessions given the same one are two processes of one install.
function session({agents=rows,refuse=null,grants=[],grantsFail=false,logFail=false,noteFail=false,inflight=[],logDelay=0,hold=null,shared=null}={}) {
 const logged=[],asked=[]; const holder=hold??{held:false}; const store=shared??{noted:new Map()};
 const db={rpc:async(name,args)=>{
  asked.push(name);
  if(name==='company_app_agents') return {data:agents,error:null};
  if(name==='agent_permission_grants') return grantsFail?{data:null,error:{message:'down'}}:{data:grants.filter(grant=>grant.agent===args.agent).map(grant=>({entry:grant.entry,allowed_by:grant.allowed_by,allowed_at:grant.allowed_at})),error:null};
  // As the database answers: what is in flight, less what a revoke has kept as revoked since (agent_permission_revoked).
  if(name==='agent_permission_inflight') return {data:inflight.filter(entry=>!store.noted.has(entry)),error:null};
  if(name==='check_permission_revoke') return {data:null,error:refuse?{message:refuse}:null};
  if(name==='begin_permission_revoke') { if(refuse) return {data:null,error:{message:refuse}}; if(holder.held) return {data:false,error:null}; holder.held=true; return {data:true,error:null}; }
  if(name==='end_permission_revoke') { holder.held=false; return {data:null,error:null}; }
  if(name==='note_permission_revoked') { if(noteFail) return {data:null,error:{message:'down'}}; const kept=new Date().toISOString(); store.noted.set(args.entry,kept); return {data:kept,error:null}; }
  if(name==='forget_permission_revoked') { if(store.noted.get(args.entry)===args.kept) store.noted.delete(args.entry); return {data:null,error:null}; }
  if(name==='log_permission_revoked') { if(logDelay) await new Promise(resolve=>setTimeout(resolve,logDelay)); logged.push(args); return {data:null,error:logFail?{message:'refused',code:'22023'}:null}; }
  return {data:null,error:{message:`unexpected ${name}`}};
 }};
 return {db,logged,asked};
}

test('an app\'s tool is named by the app and the tool, and anything else as the Engine wrote it',()=>{
 assert.deepEqual(standingEntry('mcp:meta-ads/create_campaign'),{entry:'mcp:meta-ads/create_campaign',app:{key:'meta-ads',name:'Meta Ads'},tool:'create_campaign'});
 assert.equal(standingEntry('mcp:notion/create_page').app?.name,'Notion','a catalogue app reads by its name');
 assert.equal(standingEntry('mcp:my-crm/add_lead').app?.name,'my-crm','an app outside the catalogue reads by its key');
 assert.deepEqual(standingEntry('recursive delete'),{entry:'recursive delete',app:null,tool:null});
 assert.deepEqual(standingEntry('mcp:no-tool'),{entry:'mcp:no-tool',app:null,tool:null});
 assert.equal(standingLabel('mcp:notion/create_page'),'Notion · create_page');
 assert.equal(standingLabel('recursive delete'),'recursive delete');
 const long=`${'a'.repeat(298)}😀😀😀`;
 assert.equal(standingLabel(long),`${'a'.repeat(298)}😀…`,'a long label is cut at a character, never half of one');
});

test('the rows are the Agent\'s own entries with who allowed each, none for an Agent on a shared profile, and none for one the reader does not see',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,adsProfile,['mcp:meta-ads/create_campaign','recursive delete']); profileOn(fake,seoProfile,['mcp:wordpress/publish_post']); profileOn(fake,shared,['shared entry']);
  const {db}=session({grants:[{agent:ads,entry:'mcp:meta-ads/create_campaign',allowed_by:'Omar',allowed_at:'2026-11-20T10:00:00Z'},{agent:seo,entry:'recursive delete',allowed_by:'Mona',allowed_at:'2026-11-20T11:00:00Z'}]});
  assert.deepEqual(await readAgentPermissions(db,{company,agent:ads,hermes:install(fake)}),{state:'found',permissions:[
   {entry:'mcp:meta-ads/create_campaign',app:{key:'meta-ads',name:'Meta Ads'},tool:'create_campaign',allowedBy:'Omar',allowedAt:'2026-11-20T10:00:00Z'},
   {entry:'recursive delete',app:null,tool:null,allowedBy:null,allowedAt:null}]},'an entry with no record of who allowed it has no second line, even when another Agent has one');
  assert.deepEqual((await readAgentPermissions(db,{company,agent:seo,hermes:install(fake)})).permissions?.map(each=>each.entry),['mcp:wordpress/publish_post']);
  assert.deepEqual(await readAgentPermissions(db,{company,agent:lead,hermes:install(fake)}),{state:'found',permissions:[]},'a shared profile\'s list is not this Agent\'s');
  assert.deepEqual(await readAgentPermissions(session({agents:[rows[1]]}).db,{company,agent:ads,hermes:install(fake)}),{state:'missing',permissions:null});
  assert.equal((await readAgentPermissions(db,{company,agent:ads,hermes:null})).state,'noEngine');
  assert.equal((await readAgentPermissions(db,{company,agent:'nope',hermes:install(fake)})).state,'invalid');
  assert.deepEqual(await readAgentPermissions(session({grantsFail:true}).db,{company,agent:ads,hermes:install(fake)}),{state:'failed',permissions:null},'a record that cannot be read is never drawn as nobody');
  fake.settings.managementStatus=500;
  assert.equal((await readAgentPermissions(db,{company,agent:ads,hermes:install(fake)})).state,'unreachable');
 } finally { await fake.close(); }
});

test('a revoke is asked of the database first, removes that one entry from that one profile and logs it once by its row\'s name',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,adsProfile,['mcp:notion/create_page','recursive delete']); profileOn(fake,seoProfile,['mcp:notion/create_page']);
  const {db,logged,asked}=session();
  assert.deepEqual(await revokeAgentPermission(db,{company,agent:ads,entry:'mcp:notion/create_page',hermes:install(fake)}),{state:'revoked',logged:true});
  assert.deepEqual(fake.settings.profiles.get(adsProfile).config.command_allowlist,['recursive delete']);
  assert.deepEqual(fake.settings.profiles.get(seoProfile).config.command_allowlist,['mcp:notion/create_page'],'another Agent keeps its own');
  assert.deepEqual(logged,[{c:company,agent:ads,permission:'Notion · create_page',entry:'mcp:notion/create_page'}]);
  assert.deepEqual(asked,['company_app_agents','check_permission_revoke','begin_permission_revoke','agent_permission_inflight','note_permission_revoked','log_permission_revoked','end_permission_revoke']);
  assert.deepEqual(await revokeAgentPermission(db,{company,agent:ads,entry:'mcp:notion/create_page',hermes:install(fake)}),{state:'gone'});
  assert.equal(logged.length,1,'an entry already gone is not logged again');
 } finally { await fake.close(); }
});

test('a Role the database refuses, a hidden Agent or a malformed entry changes nothing and logs nothing',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,adsProfile,['recursive delete']);
  const refused=session({refuse:'permissionNotAllowed'});
  assert.deepEqual(await revokeAgentPermission(refused.db,{company,agent:ads,entry:'recursive delete',hermes:install(fake)}),{state:'notAllowed'});
  const hidden=session({agents:[]});
  assert.deepEqual(await revokeAgentPermission(hidden.db,{company,agent:ads,entry:'recursive delete',hermes:install(fake)}),{state:'missing'});
  const odd=session();
  assert.deepEqual(await revokeAgentPermission(odd.db,{company,agent:ads,entry:7,hermes:install(fake)}),{state:'invalid'});
  assert.deepEqual(await revokeAgentPermission(odd.db,{company,agent:lead,entry:'recursive delete',hermes:install(fake)}),{state:'gone'},'nothing of a shared profile is revoked through another Agent');
  assert.deepEqual(fake.settings.profiles.get(adsProfile).config.command_allowlist,['recursive delete']);
  assert.deepEqual([...refused.logged,...hidden.logged,...odd.logged],[]);
  fake.settings.managementStatus=401;
  assert.deepEqual(await revokeAgentPermission(odd.db,{company,agent:ads,entry:'recursive delete',hermes:install(fake)}),{state:'refused'});
  assert.equal(odd.logged.length,0);
 } finally { await fake.close(); }
});

test('a revoke the Engine took is done even when its log row is refused, and says so to the server\'s log',async()=>{
 const fake=await fakeHermes(); const errors=[]; const error=console.error; console.error=line=>errors.push(line);
 try {
  profileOn(fake,adsProfile,['recursive delete']);
  const {db,logged}=session({logFail:true});
  assert.deepEqual(await revokeAgentPermission(db,{company,agent:ads,entry:'recursive delete',hermes:install(fake)}),{state:'revoked',logged:false});
  assert.deepEqual(fake.settings.profiles.get(adsProfile).config.command_allowlist,[]);
  assert.equal(logged.length,1);
  assert.deepEqual(errors.map(line=>JSON.parse(line).event),['standing_permission_log_failed']);
 } finally { console.error=error; await fake.close(); }
});

test('what an Always allow may be adding right now is written back with the list, and two revokes at once never restore each other\'s entry',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,adsProfile,['recursive delete','mcp:notion/create_page']);
  // A grant the Engine has not saved yet: the revoke writes it with the list.
  const {db}=session({inflight:['mcp:canva/create_design']});
  assert.equal((await revokeAgentPermission(db,{company,agent:ads,entry:'recursive delete',hermes:install(fake)})).state,'revoked');
  assert.deepEqual(fake.settings.profiles.get(adsProfile).config.command_allowlist,['mcp:notion/create_page','mcp:canva/create_design']);
  // Two revokes of the same profile at once: each one's entry stays gone.
  const both=session();
  const results=await Promise.all([revokeAgentPermission(both.db,{company,agent:ads,entry:'mcp:notion/create_page',hermes:install(fake)}),revokeAgentPermission(both.db,{company,agent:ads,entry:'mcp:canva/create_design',hermes:install(fake)})]);
  assert.deepEqual(results.map(result=>result.state),['revoked','revoked']);
  assert.deepEqual(fake.settings.profiles.get(adsProfile).config.command_allowlist,[]);
 } finally { await fake.close(); }
});

test('two grants taken just now and revoked together both stay revoked: the hold lasts until the log row is written (Codex on #499)',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,adsProfile,['mcp:notion/create_page','mcp:canva/create_design']);
  const both=session({inflight:['mcp:notion/create_page','mcp:canva/create_design'],logDelay:300});
  const results=await Promise.all([revokeAgentPermission(both.db,{company,agent:ads,entry:'mcp:notion/create_page',hermes:install(fake)}),revokeAgentPermission(both.db,{company,agent:ads,entry:'mcp:canva/create_design',hermes:install(fake)})]);
  assert.deepEqual(results.map(result=>result.state),['revoked','revoked']);
  assert.deepEqual(fake.settings.profiles.get(adsProfile).config.command_allowlist,[],'the second revoke never writes the first one back');
 } finally { await fake.close(); }
});

test('a refused log row undoes nothing: another server process\'s next revoke never writes the entry back (CodeRabbit on #499)',async()=>{
 const fake=await fakeHermes(); const error=console.error; console.error=()=>{};
 try {
  profileOn(fake,adsProfile,['mcp:notion/create_page','mcp:canva/create_design']);
  // One database, two server processes: the first one's log row is refused.
  const shared={noted:new Map()};
  const first=session({shared,inflight:['mcp:notion/create_page','mcp:canva/create_design'],logFail:true});
  const second=session({shared,inflight:['mcp:notion/create_page','mcp:canva/create_design']});
  assert.deepEqual(await revokeAgentPermission(first.db,{company,agent:ads,entry:'mcp:notion/create_page',hermes:install(fake)}),{state:'revoked',logged:false});
  assert.deepEqual(await revokeAgentPermission(second.db,{company,agent:ads,entry:'mcp:canva/create_design',hermes:install(fake)}),{state:'revoked',logged:true});
  assert.deepEqual(fake.settings.profiles.get(adsProfile).config.command_allowlist,[],'the first entry stays revoked');
 } finally { console.error=error; await fake.close(); }
});

test('a revoke whose record cannot be kept changes nothing, and one the Engine does not take withdraws its record',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,adsProfile,['recursive delete']);
  const noRecord=session({noteFail:true});
  assert.deepEqual(await revokeAgentPermission(noRecord.db,{company,agent:ads,entry:'recursive delete',hermes:install(fake)}),{state:'failed'});
  assert.deepEqual(fake.settings.profiles.get(adsProfile).config.command_allowlist,['recursive delete'],'the Engine is never touched');
  assert.equal(noRecord.asked.includes('log_permission_revoked'),false);
  assert.equal(noRecord.asked.at(-1),'end_permission_revoke','its hold still ends');
  const shared={noted:new Map()};
  const engineDown=session({shared}); fake.settings.managementStatus=500;
  assert.equal((await revokeAgentPermission(engineDown.db,{company,agent:ads,entry:'recursive delete',hermes:install(fake)})).state,'unreachable');
  assert.equal(shared.noted.has('recursive delete'),false,'the record is withdrawn, so its grant names its person again');
  assert.equal(engineDown.asked.includes('log_permission_revoked'),false);
 } finally { await fake.close(); }
});

test('a revoke waits for another one\'s hold, and says busy when it never ends; the hold always ends',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,adsProfile,['recursive delete']);
  const stuck=session({hold:{held:true}});
  const started=Date.now();
  assert.deepEqual(await revokeAgentPermission(stuck.db,{company,agent:ads,entry:'recursive delete',hermes:install(fake)}),{state:'busy'});
  assert.ok(Date.now()-started>=5000,'it waited for the hold');
  assert.deepEqual(fake.settings.profiles.get(adsProfile).config.command_allowlist,['recursive delete'],'nothing was written');
  const failing=session(); fake.settings.managementStatus=500;
  assert.equal((await revokeAgentPermission(failing.db,{company,agent:ads,entry:'recursive delete',hermes:install(fake)})).state,'unreachable');
  assert.equal(failing.asked.at(-1),'end_permission_revoke','a failed revoke ends its hold');
 } finally { await fake.close(); }
});

test('a revoke whose write may have landed keeps its record, so another server process never writes the entry back (CodeRabbit on #499)',async()=>{
 const fake=await fakeHermes(); const engineFetch=globalThis.fetch;
 try {
  profileOn(fake,adsProfile,['mcp:notion/create_page','mcp:canva/create_design']);
  const shared={noted:new Map()};
  const first=session({shared,inflight:['mcp:notion/create_page','mcp:canva/create_design']});
  const second=session({shared,inflight:['mcp:notion/create_page','mcp:canva/create_design']});
  // The first process's write lands, then its read-back fails.
  let written=false;
  globalThis.fetch=async(url,init)=>{ if(init?.method==='PUT') { written=true; return engineFetch(url,init); } if(written) return new Response('down',{status:500}); return engineFetch(url,init); };
  assert.equal((await revokeAgentPermission(first.db,{company,agent:ads,entry:'mcp:notion/create_page',hermes:install(fake)})).state,'unreachable');
  globalThis.fetch=engineFetch;
  assert.equal(shared.noted.has('mcp:notion/create_page'),true,'the record is kept while the outcome is unknown');
  assert.equal(first.asked.includes('forget_permission_revoked'),false);
  assert.equal((await revokeAgentPermission(second.db,{company,agent:ads,entry:'mcp:canva/create_design',hermes:install(fake)})).state,'revoked');
  assert.deepEqual(fake.settings.profiles.get(adsProfile).config.command_allowlist,[],'the first entry is not written back');
  // A read-back that still shows the entry is a sure failure: the record is withdrawn.
  profileOn(fake,adsProfile,['recursive delete']); fake.settings.staleConfig=true;
  const stale=session({shared});
  assert.equal((await revokeAgentPermission(stale.db,{company,agent:ads,entry:'recursive delete',hermes:install(fake)})).state,'failed');
  assert.equal(shared.noted.has('recursive delete'),false);
 } finally { globalThis.fetch=engineFetch; await fake.close(); }
});

test('a write that timed out before the Engine applied it keeps the record and the hold, so the late write never lets a later revoke restore the entry (CodeRabbit on #499)',async()=>{
 const fake=await fakeHermes(); const engineFetch=globalThis.fetch;
 try {
  profileOn(fake,adsProfile,['mcp:notion/create_page','mcp:canva/create_design']);
  const shared={noted:new Map()}; const hold={held:false};
  const first=session({shared,hold,inflight:['mcp:notion/create_page','mcp:canva/create_design']});
  let late=null;
  globalThis.fetch=async(url,init)=>{ if(init?.method==='PUT') { late=()=>engineFetch(url,init); return Promise.reject(new Error('timeout')); } return engineFetch(url,init); };
  assert.equal((await revokeAgentPermission(first.db,{company,agent:ads,entry:'mcp:notion/create_page',hermes:install(fake)})).state,'unreachable');
  globalThis.fetch=engineFetch;
  assert.equal(shared.noted.has('mcp:notion/create_page'),true,'the record stays');
  assert.equal(first.asked.includes('end_permission_revoke'),false,'the hold is left to end by itself');
  assert.equal(hold.held,true);
  // The Engine applies the late write; the hold then ends by itself and another process revokes the other entry.
  await late();
  hold.held=false;
  const second=session({shared,hold,inflight:['mcp:notion/create_page','mcp:canva/create_design']});
  assert.equal((await revokeAgentPermission(second.db,{company,agent:ads,entry:'mcp:canva/create_design',hermes:install(fake)})).state,'revoked');
  assert.deepEqual(fake.settings.profiles.get(adsProfile).config.command_allowlist,[],'the first entry is never written back');
 } finally { globalThis.fetch=engineFetch; await fake.close(); }
});
