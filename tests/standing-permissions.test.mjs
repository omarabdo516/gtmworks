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
function session({agents=rows,refuse=null,grants=[]}={}) {
 const logged=[],asked=[];
 const db={rpc:async(name,args)=>{
  asked.push(name);
  if(name==='company_app_agents') return {data:agents,error:null};
  if(name==='agent_permission_grants') return {data:grants.filter(grant=>grant.agent===args.agent).map(({agent,...grant})=>grant),error:null};
  if(name==='check_permission_revoke') return {data:null,error:refuse?{message:refuse}:null};
  if(name==='log_permission_revoked') { logged.push(args); return {data:null,error:null}; }
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
  fake.settings.managementStatus=500;
  assert.equal((await readAgentPermissions(db,{company,agent:ads,hermes:install(fake)})).state,'unreachable');
 } finally { await fake.close(); }
});

test('a revoke is asked of the database first, removes that one entry from that one profile and logs it once by its row\'s name',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,adsProfile,['mcp:notion/create_page','recursive delete']); profileOn(fake,seoProfile,['mcp:notion/create_page']);
  const {db,logged,asked}=session();
  assert.deepEqual(await revokeAgentPermission(db,{company,agent:ads,entry:'mcp:notion/create_page',hermes:install(fake)}),{state:'revoked'});
  assert.deepEqual(fake.settings.profiles.get(adsProfile).config.command_allowlist,['recursive delete']);
  assert.deepEqual(fake.settings.profiles.get(seoProfile).config.command_allowlist,['mcp:notion/create_page'],'another Agent keeps its own');
  assert.deepEqual(logged,[{c:company,agent:ads,permission:'Notion · create_page'}]);
  assert.deepEqual(asked,['company_app_agents','check_permission_revoke','log_permission_revoked']);
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
