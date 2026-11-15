import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provideProfile, readApps, startAppSignIn, pollAppSignIn, cancelAppSignIn, finishAppSignIn, disconnectApp } from '../lib/hermes.mjs';
import { levelConfig, alwaysOff, companyProfile } from '../lib/agent-levels.mjs';
import { changeCompanyApp, readCompanyApps, finishCompanyAppSignIn } from '../lib/company-apps.mjs';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// The service behind /api/company-apps and the vendor's way back (#30): only the Owner changes an app, checked for
// every step; a Member reads the states; the browser gets the vendor's page and states, never the Engine's flow; the
// way back is handed on only for the person's own open sign-in, and each connect and disconnect is logged once.
const encryptionKey=Buffer.alloc(32,9).toString('base64');
const company='10000000-0000-0000-0000-000000000002';
const [owner,member]=['20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005'];

// The person's own session as the database answers it: is_company_owner, company_engine_target, the three app
// functions, and the sign-ins row-level security shows an Owner. The service role only reads the Connection's key.
function sessions(fake,{person,isOwner,signIns}) {
 const asked=[];
 const db={rpc:async(name,args)=>{
   asked.push(name);
   if(name==='is_company_owner') return {data:isOwner,error:null};
   if(name==='company_engine_target') return {data:[{connection:'f0000000-0000-0000-0000-000000000002',address:fake.address,profile:companyProfile(args.c)}],error:null};
   if(!isOwner) return {data:null,error:{code:'42501'}};
   if(name==='start_app_sign_in') { signIns.push({company_id:args.c,app:args.app_key,flow_id:args.flow,started_by:person,finished_at:null,started_at:signIns.length,companies:{slug:'rs-consultations'}}); return {data:null,error:null}; }
   if(name==='finish_app_sign_in') { const open=signIns.find(row=>row.app===args.app_key&&row.flow_id===args.flow&&row.started_by===person&&!row.finished_at); if(open) open.finished_at='now'; return {data:open?[{company_id:open.company_id,slug:'rs-consultations'}]:[],error:null}; }
   if(name==='record_app_disconnected') return {data:null,error:null};
   return {data:null,error:{message:'unexpected'}};
  },
  from:table=>{
   assert.equal(table,'company_app_sign_ins');
   const filters=[];
   const chain={select:()=>chain,eq:(column,value)=>{filters.push([column,value]);return chain;},order:()=>chain,limit:()=>chain,
    maybeSingle:async()=>({data:isOwner?signIns.filter(row=>filters.every(([column,value])=>row[column]===value)).sort((a,b)=>b.started_at-a.started_at)[0]??null:null,error:null})};
   return chain;
  }};
 const key=encryptSecret('test-only-key',encryptionKey);
 const service={from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{key_encrypted:key},error:null})})})})})};
 return {db,service,asked};
}

test('only an Owner connects, follows or disconnects an app; a Member reads the states', async () => {
 const fake=await fakeHermes();
 try {
  const install={address:fake.address,managementAddress:fake.managementAddress,profile:'default',key:'test-only-key'};
  await provideProfile(install,{name:companyProfile(company),soul:'',config:levelConfig(1),forbidden:alwaysOff});
  // The fake's management listener is not on port 9119 of the run address, so the driver is pointed at it.
  const at=target=>({...target,managementAddress:fake.managementAddress});
  const driver={read:target=>readApps(at(target)),start:(target,key,back)=>startAppSignIn(at(target),key,back),poll:(target,flow)=>pollAppSignIn(at(target),flow),
   cancel:(target,flow)=>cancelAppSignIn(at(target),flow),finish:(target,signIn)=>finishAppSignIn(at(target),signIn),disconnect:(target,key)=>disconnectApp(at(target),key)};
  const signIns=[];
  const someone=sessions(fake,{person:member,isOwner:false,signIns});
  for(const action of ['connect','poll','cancel','disconnect']) {
   assert.deepEqual(await changeCompanyApp(someone.db,someone.service,{company,person:member,app:'klaviyo',action,encryptionKey,driver}),{status:403,body:{error:'appsNotAllowed'}});
  }
  assert.equal(fake.settings.appFlows.size,0,'a member never reaches the Engine');
  assert.equal((await readCompanyApps(someone.db,someone.service,{company,encryptionKey,driver}))?.find(app=>app.key==='klaviyo')?.state,'off');

  const omar=sessions(fake,{person:owner,isOwner:true,signIns});
  const change=(action,app='klaviyo')=>changeCompanyApp(omar.db,omar.service,{company,person:owner,app,action,encryptionKey,driver});
  assert.deepEqual(await change('connect','figma'),{status:400,body:{error:'appsInvalid'}});
  const started=await change('connect');
  assert.equal(started.status,200);
  assert.deepEqual(Object.keys(started.body),['url']);
  const url=new URL(String(started.body.url));
  assert.equal(url.searchParams.get('redirect_uri'),'http://localhost:3000/api/apps/callback/klaviyo');
  assert.deepEqual(await change('poll'),{status:200,body:{status:'waiting'}});
  const again=await change('connect');
  assert.equal(again.status,200);
  assert.equal([...fake.settings.appFlows.values()].filter(flow=>flow.status==='authorization_required').length,1,'a sign-in left open gives way to the new one');
  const vendorState=new URL(String(again.body.url)).searchParams.get('state');

  assert.deepEqual(await finishCompanyAppSignIn(someone.db,someone.service,{person:member,app:'klaviyo',answer:{code:'c',state:vendorState},encryptionKey,driver}),{slug:null,outcome:'failed'});
  assert.equal(fake.settings.appCallbacks.length,0,'nothing reaches the Engine without the person\'s own sign-in');
  assert.deepEqual(await finishCompanyAppSignIn(omar.db,omar.service,{person:owner,app:'klaviyo',answer:{code:'c',state:vendorState},encryptionKey,driver}),{slug:'rs-consultations',outcome:'connected'});
  assert.deepEqual(await change('poll'),{status:200,body:{status:'connected'}});
  assert.equal(omar.asked.filter(name=>name==='finish_app_sign_in').length,1);
  assert.equal((await readCompanyApps(omar.db,omar.service,{company,encryptionKey,driver}))?.find(app=>app.key==='klaviyo')?.state,'connected');

  assert.deepEqual(await change('disconnect'),{status:200,body:{status:'off'}});
  assert.deepEqual(omar.asked.filter(name=>name==='record_app_disconnected'),['record_app_disconnected']);
  assert.equal((await readCompanyApps(omar.db,omar.service,{company,encryptionKey,driver}))?.find(app=>app.key==='klaviyo')?.state,'off');
  assert.doesNotMatch(JSON.stringify([started,again]),/flow|hermes|opt\//i);
 } finally { await fake.close(); }
});
