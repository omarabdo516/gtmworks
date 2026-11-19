import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHermes } from './fake-hermes.mjs';
import { readAgent, writeAgentAbout } from '../lib/hermes.mjs';

// #161: an Agent's Name (the profile's display name) and About (its description) are the Engine's own, read from the
// profile list the driver already reads and written on the profile's description route (v0.23.0
// hermes_cli/web_routers/profiles.py: GET /api/profiles, PUT /api/profiles/{name}/description). The pinned Engine writes
// a named profile's display_name on no route, so nothing here writes one.
const connection=fake=>({address:fake.address,managementAddress:fake.managementAddress,profile:'co-one',key:fake.settings.key});
const profileOn=(fake,name,meta={})=>fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{},display_name:null,description:'',description_auto:true,bot_title:null,...meta});

test('an Agent\'s profile reads its display name, description and title from the Engine\'s list',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,'co-one',{display_name:'Meta Ads',description:'Runs the Meta ads.',description_auto:false,bot_title:'Ads agent'});
  const read=await readAgent(connection(fake),'co-one');
  assert.equal(read.state,'found');
  assert.deepEqual({...read.agent,instructions:read.agent.instructions},
   {name:'co-one',instructions:'',model:null,ready:true,displayName:'Meta Ads',description:'Runs the Meta ads.',descriptionAuto:false,botTitle:'Ads agent'});
  // A profile nobody named, described or titled reads as empty, never as words gtmworks made up.
  profileOn(fake,'co-plain');
  assert.deepEqual(await readAgent(connection(fake),'co-plain').then(read=>[read.agent.displayName,read.agent.description,read.agent.descriptionAuto,read.agent.botTitle]),
   [null,'',true,null]);
 } finally { await fake.close(); }
});

test('About is written on the profile\'s description route, and what comes back is what the Engine kept',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,'co-one',{display_name:'Meta Ads',description:'Old words.',description_auto:true});
  const written=await writeAgentAbout(connection(fake),{name:'co-one',description:'  Plans and runs the Meta ads.  '});
  assert.deepEqual(written,{state:'written',description:'Plans and runs the Meta ads.'});
  assert.equal(fake.settings.profiles.get('co-one').description,'Plans and runs the Meta ads.');
  assert.equal(fake.settings.profiles.get('co-one').description_auto,false,'a person wrote it');
  const request=fake.settings.managementRequests.filter(request=>request.method==='PUT').at(-1);
  assert.equal(request.path,'/api/profiles/co-one/description');
  assert.deepEqual(request.body,{description:'  Plans and runs the Meta ads.  '});
  // The Engine's own answer is what the page shows, not the text the browser sent: it trims, and the answer is what it kept.
  assert.notEqual(written.description,'  Plans and runs the Meta ads.  ');
 } finally { await fake.close(); }
});

test('an About the Engine refuses, does not know or cannot be reached is a state, never a throw',async()=>{
 const fake=await fakeHermes();
 try {
  profileOn(fake,'co-one');
  fake.settings.managementStatus=403;
  assert.deepEqual(await writeAgentAbout(connection(fake),{name:'co-one',description:'Words.'}),{state:'refused',description:null});
  fake.settings.managementStatus=500;
  assert.deepEqual(await writeAgentAbout(connection(fake),{name:'co-one',description:'Words.'}),{state:'failed',description:null});
  assert.deepEqual(await writeAgentAbout(connection(fake),{name:'co-missing',description:'Words.'}),{state:'failed',description:null});
  assert.deepEqual(await writeAgentAbout({...connection(fake),key:'wrong'},{name:'co-one',description:'Words.'}),{state:'refused',description:null});
  assert.deepEqual(await writeAgentAbout({address:'http://8.8.8.8:1',managementAddress:'http://8.8.8.8:2',profile:'co-one',key:'k'},{name:'co-one',description:'Words.'}),
   {state:'unreachable',description:null});
  assert.deepEqual(await writeAgentAbout(connection(fake),{name:'Not A Profile',description:'Words.'}),{state:'failed',description:null});
  assert.deepEqual(await writeAgentAbout(connection(fake),{name:'co-one',description:7}),{state:'failed',description:null});
  assert.equal(fake.settings.managementRequests.filter(request=>request.path==='/api/profiles/co-one/description'&&request.body?.description===7).length,0,'nothing is sent for a description that is not text');
 } finally { await fake.close(); }
});
