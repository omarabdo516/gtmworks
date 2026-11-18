import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { downloadAgentFile, listAgentFiles, readAgentFile, workSegments } from '../lib/hermes.mjs';
import { agentFileDownload, agentLibrary } from '../lib/agent-files.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// The Library of an Agent (#194): one folder of the Agent's work folder in its own Engine profile, read through the
// dashboard's file routes and never copied into gtmworks. A Contributor or a Viewer is refused on the server, a hidden
// Agent and another Company's Agent are not found, and no answer carries an Engine address or a path on its disk.
const company='10000000-0000-0000-0000-000000000001';
const otherCompany='10000000-0000-0000-0000-000000000002';
const agent='3a000000-0000-0000-0000-000000000021';
const otherAgent='3a000000-0000-0000-0000-000000000041';
const person='9a000000-0000-0000-0000-000000000001';
const profile=`ag-${agent.replaceAll('-','')}`;
const otherProfile=`ag-${otherAgent.replaceAll('-','')}`;
const home=`/opt/data/profiles/${profile}`;
const work=`${home}/workspace`;
const mtime=1763500000;
const clock=new Date(mtime*1000).toISOString();
const hermes=()=>({address:process.env.BUNDLED_HERMES_URL,key:process.env.HERMES_API_KEY});

const require=createRequire(import.meta.url);
const [permissions,service,attachments]=[await import('../lib/route-permissions.mjs'),await import('../lib/agent-files.mjs'),await import('../lib/attachments.mjs')];
// Execute a real route with only its I/O replaced; no server and no database (as first-run-diagnostics.test.mjs does).
function load(file,imports,globals={}) {
 const exports={};
 const {outputText}=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ESNext,esModuleInterop:true}});
 runInNewContext(outputText,{exports,require:name=>imports[name] ?? require(name),URL,URLSearchParams,Error,Response,Request,Headers,process,...globals});
 return exports;
}

// A fake Engine with one Agent's profile and the work folder the Engine makes in every profile (hermes_cli/profiles.py
// line 40, _PROFILE_DIRS).
async function engine() {
 const fake=await fakeHermes();
 for(const name of [profile,otherProfile]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.files.set(work,[]);
 return {fake,at:{address:fake.address,managementAddress:fake.managementAddress,profile,key:'test-only-key'}};
}
const downloaded=fake=>fake.settings.managementRequests.filter(request=>String(request.path).startsWith('/api/fs/download'));

// The database as the signed-in person reaches it: their Role in the Company, and the Agents they see there.
function database({role='owner',agents=[{agent,name:'Lead',connection:'c',profile,main:true,own:true}],signedIn=person,companyRow={id:company}}={}) {
 const asked=[];
 const chain=(/** @type {string} */ table)=>{ const at={select:()=>at,eq:()=>at,is:()=>at,maybeSingle:async()=>({data:table==='members'&&role?{role}:table==='companies'?companyRow:null,error:null})}; return at; };
 const db={auth:{getUser:async()=>({data:{user:signedIn?{id:signedIn}:null}})},
  from:(/** @type {string} */ table)=>chain(table),
  rpc:async(/** @type {string} */ name,/** @type {any} */ given)=>{ asked.push(name);
   if(name==='company_app_agents') return {data:given.c===company?agents:[],error:null};
   return {data:null,error:{message:`unexpected ${name}`}}; }};
 return {db,asked};
}

test('an Agent\'s library is the folders and files in its profile\'s work folder, read from the Engine with no path in the answer', async () => {
 const {fake,at}=await engine();
 try {
  fake.settings.files.set(work,[{name:'reports',isFolder:true},{name:'brief.md',size:2048,mtime},{name:'shot.png',size:4096,mtime}]);
  const read=await listAgentFiles(at);
  assert.deepEqual(read,{state:'found',entries:[
   {name:'reports',isFolder:true,size:null,time:null},
   {name:'brief.md',isFolder:false,size:2048,time:clock},
   {name:'shot.png',isFolder:false,size:4096,time:clock},
  ]});
  // The folder's own path and the profile's home never leave the contract.
  assert.ok(!JSON.stringify(read).includes('/opt/'),'no Engine path in the answer');
  assert.ok(!JSON.stringify(read).includes(fake.address),'no Engine address in the answer');
  // It is the profile's own work folder the Engine is asked about.
  assert.ok(fake.settings.managementRequests.some(request=>request.path===`/api/files?path=${encodeURIComponent(work)}`));

  // A folder inside it is asked about by its relative name.
  fake.settings.files.set(`${work}/reports`,[{name:'q3.csv',size:12,mtime}]);
  assert.deepEqual(await listAgentFiles(at,'reports'),{state:'found',entries:[{name:'q3.csv',isFolder:false,size:12,time:clock}]});
  assert.ok(fake.settings.managementRequests.some(request=>request.path===`/api/files?path=${encodeURIComponent(`${work}/reports`)}`));

  // A folder the Engine does not have is missing, and an Engine that cannot be read is not an empty folder.
  assert.deepEqual(await listAgentFiles(at,'gone'),{state:'missing',entries:null});
  fake.settings.filesUnreadable.add(work);
  assert.deepEqual(await listAgentFiles(at),{state:'unreachable',entries:null});
  assert.deepEqual(await listAgentFiles({...at,key:'another-key'}),{state:'refused',entries:null});
  assert.deepEqual(await listAgentFiles({...at,profile:'ag-nothing'}),{state:'missing',entries:null});
 } finally { await fake.close(); }
});

test('a name that could leave the work folder is refused in gtmworks before the Engine is asked', async () => {
 const {fake,at}=await engine();
 try {
  for(const bad of ['..','../..','a/../b','/etc/passwd','//opt/data','C:\\\\windows','a\\\\b','.hidden','a/.ssh','a//b','a/','a\u0000b',42,null,{},'x'.repeat(129),'a/b/c/d/e/f/g/h/i']) {
   assert.equal(workSegments(bad),null,`${String(bad)} is not a path inside the work folder`);
   assert.deepEqual(await listAgentFiles(at,/** @type {any} */(bad)),{state:'invalid',entries:null});
   assert.deepEqual(await downloadAgentFile(at,{folder:/** @type {any} */(bad),name:'brief.md'}),{state:'invalid'});
   assert.deepEqual(await downloadAgentFile(at,{name:/** @type {any} */(bad)}),{state:'invalid'});
  }
  assert.equal(fake.settings.managementRequests.length,0,'the Engine was never asked');
  assert.equal(downloaded(fake).length,0);
  assert.deepEqual(workSegments(''),[]);
  assert.deepEqual(workSegments('reports'),['reports']);
  assert.deepEqual(workSegments('reports/2026'),['reports','2026']);
 } finally { await fake.close(); }
});

test('a file that resolves outside the work folder, or a broken link, is not listed and cannot be downloaded', async () => {
 const {fake,at}=await engine();
 try {
  fake.settings.files.set(work,[{name:'brief.md',size:2,mtime},{name:'passwd',size:9,mtime,resolves:'/etc/passwd'},{name:'elsewhere',size:9,mtime,resolves:`/opt/data/profiles/${otherProfile}/workspace/x`},{name:'dangling',broken:true}]);
  const read=await listAgentFiles(at);
  assert.deepEqual(read.entries.map(entry=>entry.name),['brief.md'],'only what is in this folder, and no broken link');
  assert.deepEqual(await downloadAgentFile(at,{name:'passwd'}),{state:'missing'});
  assert.deepEqual(await downloadAgentFile(at,{name:'elsewhere'}),{state:'missing'});
  assert.equal(downloaded(fake).length,0,'no bytes were asked for');
 } finally { await fake.close(); }
});

test('a folder that the Engine resolves outside the work folder is missing, for the list, the download and the preview', async () => {
 const {fake,at}=await engine();
 try {
  fake.settings.files.set(work,[{name:'reports',isFolder:true},{name:'brief.md',size:2,mtime}]);
  fake.settings.fileBytes.set(`${work}/brief.md`,{body:'Sell it',type:'text/markdown'});
  // The work folder itself is a link out of the Agent's profile: what the Engine resolved is not what gtmworks asked for.
  fake.settings.resolved.set(work,`/etc`);
  assert.deepEqual(await listAgentFiles(at),{state:'missing',entries:null});
  assert.deepEqual(await downloadAgentFile(at,{name:'brief.md'}),{state:'missing'});
  assert.deepEqual(await readAgentFile(at,{name:'brief.md'}),{state:'missing'});
  assert.equal(downloaded(fake).length,0,'no bytes were asked for');
  assert.ok(!fake.settings.managementRequests.some(request=>String(request.path).startsWith('/api/fs/read-text')),'no text was asked for');
  // A folder inside it that is a link somewhere else is refused the same way, and its entries are never used.
  fake.settings.resolved.delete(work);
  fake.settings.files.set(`${work}/reports`,[{name:'q3.csv',size:12,mtime}]);
  fake.settings.resolved.set(`${work}/reports`,'/srv/reports');
  assert.deepEqual(await listAgentFiles(at,'reports'),{state:'missing',entries:null});
  assert.deepEqual(await downloadAgentFile(at,{folder:'reports',name:'q3.csv'}),{state:'missing'});
  assert.deepEqual(await readAgentFile(at,{folder:'reports',name:'q3.csv'}),{state:'missing'});
  assert.equal(downloaded(fake).length,0);
 } finally { await fake.close(); }
});

test('one file of the work folder is fetched through gtmworks, with its type and size, and never by a path the browser sent', async () => {
 const {fake,at}=await engine();
 try {
  const text='# Brief\n\nSell more.\n';
  fake.settings.files.set(work,[{name:'reports',isFolder:true},{name:'brief.md',size:Buffer.byteLength(text),mtime}]);
  fake.settings.fileBytes.set(`${work}/brief.md`,{body:text,type:'text/markdown'});
  const file=await downloadAgentFile(at,{name:'brief.md'});
  assert.equal(file.state,'found');
  if(file.state!=='found') return;
  assert.equal(file.name,'brief.md');
  assert.equal(file.type,'text/markdown');
  assert.equal(file.size,Buffer.byteLength(text));
  assert.equal(Buffer.from(file.body).toString(),text);
  assert.ok(fake.settings.managementRequests.some(request=>request.path===`/api/fs/download?path=${encodeURIComponent(`${work}/brief.md`)}&profile=${profile}`));
  assert.deepEqual(await downloadAgentFile(at,{name:'reports'}),{state:'invalid'},'a folder is not a file');
  assert.deepEqual(await downloadAgentFile(at,{name:'nothing.md'}),{state:'missing'});
  // A file the Engine no longer has, in a folder that still lists it, is missing rather than a failure.
  fake.settings.files.set(work,[]);
  assert.deepEqual(await downloadAgentFile(at,{name:'brief.md'}),{state:'missing'});
  assert.equal(downloaded(fake).length,1,'only the one real download was asked for');
 } finally { await fake.close(); }
});

test('the list route answers an Owner and a Manager, refuses a Contributor and a Viewer, and does not find a hidden Agent or another Company\'s', async () => {
 const {fake}=await engine();
 try {
  fake.settings.files.set(work,[{name:'brief.md',size:2,mtime}]);
  process.env.BUNDLED_HERMES_URL=fake.address; process.env.HERMES_API_KEY='test-only-key';
  const {NextRequest}=require('next/server');
  // The service reaches the Engine as the app reaches the bundled one, with the fake's management listener where
  // port 9119 sits in an install.
  const drivers={agentLibrary:(/** @type {any} */ db,/** @type {any} */ request)=>service.agentLibrary(db,{...request,hermes:{...hermes(),managementAddress:fake.managementAddress}}),
   agentFileDownload:(/** @type {any} */ db,/** @type {any} */ request)=>service.agentFileDownload(db,{...request,hermes:{...hermes(),managementAddress:fake.managementAddress}})};
  const route=(/** @type {any} */ db)=>load('app/api/agent-files/route.ts',{
   '@/lib/supabase':{supabase:async()=>db},
   '@/lib/route-permissions.mjs':permissions,
   '@/lib/agent-files.mjs':drivers,
  }).GET;
  const ask=(/** @type {ReturnType<typeof route>} */ GET,/** @type {Record<string,string>} */ query)=>GET(new NextRequest(`http://app.test/api/agent-files?${new URLSearchParams(query)}`));
  for(const role of ['owner','manager']) {
   const response=await ask(route(database({role}).db),{company,agent});
   assert.equal(response.status,200,role);
   const body=await response.json();
   assert.deepEqual(body,{folder:'',entries:[{name:'brief.md',isFolder:false,size:2,time:clock,files:null,latest:null}]});
   assert.ok(!JSON.stringify(body).includes(fake.address)&&!JSON.stringify(body).includes('/opt/'),'no address and no path');
   assert.equal(response.headers.get('cache-control'),'no-store');
  }
  for(const role of ['contributor','viewer']) {
   const given=database({role});
   const response=await ask(route(given.db),{company,agent});
   assert.equal(response.status,403,role);
   assert.deepEqual(given.asked,[],'a Role that may not open the Library never reaches the Agent list');
  }
  // A hidden Agent is not in the list the database answers, and another Company's Agent is not either.
  for(const hidden of [{agents:[]},{agents:[{agent:otherAgent,name:'Helper',connection:'c',profile:otherProfile,main:false,own:true}]}]) {
   assert.equal((await ask(route(database(hidden).db),{company,agent})).status,404);
   assert.equal((await ask(route(database({...hidden,companyRow:{id:otherCompany}}).db),{company:otherCompany,agent})).status,404);
  }
  // A signed-out reader, a bad folder name and a missing parameter are refused before any Engine call.
  assert.equal((await ask(route(database({signedIn:null}).db),{company,agent})).status,401);
  const before=fake.settings.managementRequests.length;
  assert.equal((await ask(route(database().db),{company,agent,folder:'../secret'})).status,400);
  assert.equal((await ask(route(database().db),{agent})).status,400);
  assert.equal(fake.settings.managementRequests.length,before,'the Engine was never asked');
 } finally { await fake.close(); }
});

test('the download route serves the bytes as an attachment to an Owner and a Manager, and refuses everyone else', async () => {
 const {fake}=await engine();
 try {
  fake.settings.files.set(work,[{name:'brief.md',size:7,mtime},{name:'shot.png',size:3,mtime}]);
  fake.settings.fileBytes.set(`${work}/brief.md`,{body:'Sell it',type:'text/markdown'});
  process.env.BUNDLED_HERMES_URL=fake.address; process.env.HERMES_API_KEY='test-only-key';
  const {NextRequest}=require('next/server');
  const drivers={agentFileDownload:(/** @type {any} */ db,/** @type {any} */ request)=>service.agentFileDownload(db,{...request,hermes:{...hermes(),managementAddress:fake.managementAddress}})};
  const route=(/** @type {any} */ db)=>load('app/c/[slug]/agent-files/[agent]/route.ts',{
   '@/lib/supabase':{supabase:async()=>db},
   '@/lib/route-permissions.mjs':permissions,
   '@/lib/agent-files.mjs':drivers,
   '@/lib/attachments.mjs':attachments,
  }).GET;
  const ask=(/** @type {ReturnType<typeof route>} */ GET,/** @type {Record<string,string>} */ query,/** @type {string} */ named=agent)=>{
   const params=Promise.resolve({slug:'rs-learning',agent:named});
   return GET(new NextRequest(`http://app.test/c/rs-learning/agent-files/${named}?${new URLSearchParams(query)}`),{params});
  };
  for(const role of ['owner','manager']) {
   const response=await ask(route(database({role}).db),{name:'brief.md'});
   assert.equal(response.status,200,role);
   assert.equal(await response.text(),'Sell it');
   assert.equal(response.headers.get('content-disposition'),"attachment; filename*=UTF-8''brief.md");
   assert.equal(response.headers.get('content-type'),'application/octet-stream');
   assert.equal(response.headers.get('x-content-type-options'),'nosniff');
   assert.equal(response.headers.get('cache-control'),'private, no-store');
   const headers=JSON.stringify([...response.headers]);
   assert.ok(!headers.includes(fake.address)&&!headers.includes('/opt/'),'no address and no path');
  }
  // A Viewer is refused, a person outside the Company finds nothing, and a hidden Agent is not found.
  assert.equal((await ask(route(database({role:'viewer'}).db),{name:'brief.md'})).status,403);
  assert.equal((await ask(route(database({role:null}).db),{name:'brief.md'})).status,404);
  assert.equal((await ask(route(database({agents:[]}).db),{name:'brief.md'})).status,404);
  // Another Company's Agent is not found: its Company answers for its own Agents only.
  const elsewhere=database({companyRow:{id:otherCompany},agents:[{agent,name:'Elsewhere',connection:'c',profile:otherProfile,main:true,own:true}]});
  assert.equal((await ask(route(elsewhere.db),{name:'brief.md'})).status,404);
  // A name that could leave the folder is not a file, and the Engine is never asked for bytes.
  const before=downloaded(fake).length;
  assert.equal((await ask(route(database().db),{name:'../../etc/passwd'})).status,404);
  assert.equal(downloaded(fake).length,before);
 } finally { await fake.close(); }
});

test('the Library service reads one Agent\'s folder for the Company that sees it, and never another Agent\'s profile', async () => {
 const {fake,at}=await engine();
 try {
  fake.settings.files.set(work,[{name:'reports',isFolder:true},{name:'brief.md',size:1,mtime}]);
  fake.settings.files.set(`${work}/reports`,[{name:'q3.csv',size:12,mtime},{name:'q4.csv',size:13,mtime:mtime+86400}]);
  // A folder's row carries how many files it holds and the day of the newest of them; a file's row carries neither.
  assert.deepEqual(await agentLibrary(database().db,{company,agent,hermes:at}),{state:'found',entries:[
   {name:'reports',isFolder:true,size:null,time:null,files:2,latest:new Date((mtime+86400)*1000).toISOString()},
   {name:'brief.md',isFolder:false,size:1,time:clock,files:null,latest:null},
  ]});
  // A folder that cannot be read keeps no count, which is not the same as Empty.
  fake.settings.filesUnreadable.add(`${work}/reports`);
  assert.deepEqual((await agentLibrary(database().db,{company,agent,hermes:at})).entries?.[0],{name:'reports',isFolder:true,size:null,time:null,files:null,latest:null});
  fake.settings.filesUnreadable.delete(`${work}/reports`);
  assert.deepEqual(await agentLibrary(database({agents:[]}).db,{company,agent,hermes:at}),{state:'missing',entries:null});
  assert.deepEqual(await agentLibrary(database({agents:[]}).db,{company:otherCompany,agent,hermes:at}),{state:'missing',entries:null});
  assert.deepEqual(await agentLibrary(database().db,{company,agent,hermes:null}),{state:'missing',entries:null},'no Engine on a hosted install');
  const file=await agentFileDownload(database().db,{company,agent,hermes:at,name:'brief.md'});
  assert.equal(file.state,'found');
  assert.deepEqual(await agentFileDownload(database({agents:[]}).db,{company,agent,hermes:at,name:'brief.md'}),{state:'missing'});
 } finally { await fake.close(); }
});
