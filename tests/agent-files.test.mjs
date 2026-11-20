import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { downloadAgentFile, libraryRoot, listAgentFiles, readAgentFile, workSegments } from '../lib/hermes.mjs';
import { agentFileDownload, agentLibrary } from '../lib/agent-files.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// The Library of an Agent (#194, #395): the Agent's own folder in the Company's work folder, read through the Engine's
// file routes and never copied into gtmworks. The Engine sees that folder read-only under its own data root
// (scripts/engine-template.yml), which is where its file routes serve from. A Contributor or a Viewer is refused on the
// server, a hidden Agent and another Company's Agent are not found, and no answer carries an Engine address or a path.
const company='10000000-0000-0000-0000-000000000001';
const otherCompany='10000000-0000-0000-0000-000000000002';
const agent='3a000000-0000-0000-0000-000000000021';
const otherAgent='3a000000-0000-0000-0000-000000000041';
const person='9a000000-0000-0000-0000-000000000001';
const profile=`ag-${agent.replaceAll('-','')}`;
const otherProfile=`ag-${otherAgent.replaceAll('-','')}`;
const home=`/opt/data/profiles/${profile}`;
// The Agent's folder in the Company's work folder, as the Engine sees it read-only: the Library's `work` root.
const work=`/opt/data/work/${profile}`;
// The per-profile folder of the Engine's own disk the Library showed until #395: nothing could write to it, so it is no
// part of the Library any more.
const oldWork=`${home}/workspace`;
// The folder the Engine writes a generated image into (#353; agent/provider_media.py, GENERATED_SUBDIR, cache_dir).
const images=`${home}/cache/generated/images`;
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

// A fake Engine with one Agent's profile and the Company's work folder mounted read-only under its data root, holding
// the Agent's own folder (scripts/engine-template.yml, #393, #395).
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

test('an Agent\'s library is the folders and files in its own folder in the Company\'s work folder, read from the Engine with no path in the answer', async () => {
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
  // It is the Agent's folder in the work folder, as the Engine sees it read-only, that the Engine is asked about.
  assert.ok(fake.settings.managementRequests.some(request=>request.path===`/api/files?path=${encodeURIComponent(work)}`));
  // The per-profile folder on the Engine's own disk is no longer shown, and is never asked about (#395).
  fake.settings.files.set(oldWork,[{name:'stale.md',size:9,mtime}]);
  assert.ok(!fake.settings.managementRequests.some(request=>request.path===`/api/files?path=${encodeURIComponent(oldWork)}`));
  assert.deepEqual((await listAgentFiles(at)).entries?.map(entry=>entry.name),['reports','brief.md','shot.png']);
  fake.settings.files.delete(oldWork);

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

test('a brand-new Agent whose folder in the work folder is not made yet has an empty Library, not a missing one', async () => {
 const {fake,at}=await engine();
 try {
  // The sandbox's login shell makes an Agent's folder with its first command (sandbox/work-shell, #393): before that the
  // Engine answers 404 for it, and the Library reads that as the empty folder it is.
  fake.settings.files.delete(work);
  assert.deepEqual(await listAgentFiles(at),{state:'found',entries:[]});
  assert.ok(fake.settings.managementRequests.some(request=>request.path===`/api/files?path=${encodeURIComponent(work)}`),'the Engine was asked, and answered 404');
  // A folder inside it is not made for it: only the Agent's own folder itself is empty rather than missing.
  assert.deepEqual(await listAgentFiles(at,'gone'),{state:'missing',entries:null});
  assert.deepEqual(await downloadAgentFile(at,{name:'brief.md'}),{state:'missing'});
 } finally { await fake.close(); }
});

test('the Engine sees the Company\'s work folder read-only where the Library reads it', async () => {
 const template=readFileSync('scripts/engine-template.yml','utf8');
 assert.match(template,/^      - work:\/opt\/data\/work:ro$/m,'the work volume is mounted read-only at the path the Library reads');
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

test('the generated images folder is the Library\'s second root, listed, downloaded and previewed from the Agent\'s own profile', async () => {
 const {fake,at}=await engine();
 try {
  const png=new Uint8Array([137,80,78,71,0,1,2,3]);
  fake.settings.images.set(profile,[{name:'promo.png',size:png.length,mtime}]);
  fake.settings.fileBytes.set(`${images}/promo.png`,{body:png,type:'image/png'});
  // The root is a name gtmworks chooses, never a path a browser sent: it builds `<profile home>/cache/generated/images`.
  assert.deepEqual(await listAgentFiles(at,'','images'),{state:'found',entries:[{name:'promo.png',isFolder:false,size:png.length,time:clock}]});
  assert.ok(fake.settings.managementRequests.some(request=>request.path===`/api/files?path=${encodeURIComponent(images)}`));
  assert.ok(!JSON.stringify(await listAgentFiles(at,'','images')).includes('/opt/'),'no Engine path in the answer');
  // One image is fetched through gtmworks, with its type and size, from the same guarded listing.
  const file=await downloadAgentFile(at,{root:'images',name:'promo.png'});
  assert.equal(file.state,'found');
  if(file.state!=='found') return;
  assert.equal(file.name,'promo.png');
  assert.equal(file.type,'image/png');
  assert.equal(file.size,png.length);
  assert.deepEqual([...file.body], [...png]);
  assert.ok(fake.settings.managementRequests.some(request=>request.path===`/api/fs/download?path=${encodeURIComponent(`${images}/promo.png`)}&profile=${profile}`));
  // A picture has no text to preview: its bytes are the Engine's and its answer carries none of them as text.
  assert.deepEqual(await readAgentFile(at,{root:'images',name:'promo.png'}),{state:'found',name:'promo.png',type:'image/png',byteSize:png.length,truncated:false,text:null});
  // The two roots are read apart: the work folder never carries the generated image.
  fake.settings.files.set(work,[{name:'brief.md',size:2,mtime}]);
  assert.deepEqual((await listAgentFiles(at)).entries?.map(entry=>entry.name),['brief.md']);
 } finally { await fake.close(); }
});

test('a profile with no generated image has an empty generated images folder, not a missing one', async () => {
 const {fake,at}=await engine();
 try {
  // The Engine makes `<profile home>/cache/generated/images` when its first image lands, and `/api/files` answers a
  // profile with none 404; the Library still reads it as the empty folder it is.
  assert.equal(fake.settings.images.get(profile),undefined);
  assert.deepEqual(await listAgentFiles(at,'','images'),{state:'found',entries:[]});
  assert.ok(fake.settings.managementRequests.some(request=>request.path===`/api/files?path=${encodeURIComponent(images)}`),'the Engine was asked, and answered 404');
  // A folder inside it is not made for it: only the generated images root itself is empty rather than missing.
  assert.deepEqual(await listAgentFiles(at,'gone','images'),{state:'missing',entries:null});
 } finally { await fake.close(); }
});

test('an unknown Library root is refused before the Engine is asked, and a work folder named images stays in the work folder', async () => {
 const {fake,at}=await engine();
 try {
  for(const bad of ['workspace','/etc/passwd','Images','cache/generated/images','..','work/../images',42,null,{}]) {
   assert.equal(libraryRoot(bad),null,`${String(bad)} is not a Library root`);
   assert.deepEqual(await listAgentFiles(at,'',/** @type {any} */(bad)),{state:'invalid',entries:null});
   assert.deepEqual(await downloadAgentFile(at,{root:/** @type {any} */(bad),name:'promo.png'}),{state:'invalid'});
   assert.deepEqual(await readAgentFile(at,{root:/** @type {any} */(bad),name:'promo.png'}),{state:'invalid'});
  }
  assert.equal(fake.settings.managementRequests.length,0,'the Engine was never asked');
  assert.equal(libraryRoot(undefined),'work','the work folder is the Library the reader opens first');
  assert.equal(libraryRoot('work'),'work');
  assert.equal(libraryRoot('images'),'images');
  // The root is a parameter of its own, never a path segment: a work folder called `images` is read as that folder.
  fake.settings.files.set(work,[{name:'images',isFolder:true}]);
  fake.settings.files.set(`${work}/images`,[{name:'brief.md',size:2,mtime}]);
  assert.deepEqual((await listAgentFiles(at,'images')).entries?.map(entry=>entry.name),['brief.md']);
  assert.ok(fake.settings.managementRequests.some(request=>request.path===`/api/files?path=${encodeURIComponent(`${work}/images`)}`));
  assert.ok(!fake.settings.managementRequests.some(request=>request.path===`/api/files?path=${encodeURIComponent(images)}`),'the generated images folder was never asked about');
 } finally { await fake.close(); }
});

test('a generated images folder that is a link somewhere else is missing for the list, the download and the preview', async () => {
 const {fake,at}=await engine();
 try {
  fake.settings.images.set(profile,[{name:'promo.png',size:8,mtime}]);
  fake.settings.fileBytes.set(`${images}/promo.png`,{body:new Uint8Array(8),type:'image/png'});
  fake.settings.resolved.set(images,'/etc');
  assert.deepEqual(await listAgentFiles(at,'','images'),{state:'missing',entries:null});
  assert.deepEqual(await downloadAgentFile(at,{root:'images',name:'promo.png'}),{state:'missing'});
  assert.deepEqual(await readAgentFile(at,{root:'images',name:'promo.png'}),{state:'missing'});
  assert.equal(downloaded(fake).length,0,'no bytes were asked for');
  assert.ok(!fake.settings.managementRequests.some(request=>String(request.path).startsWith('/api/fs/read-text')),'no text was asked for');
  // A folder the Engine does not have is still empty rather than missing once the link is gone, and not before.
  fake.settings.resolved.delete(images);
  assert.deepEqual(await listAgentFiles(at,'','images'),{state:'found',entries:[{name:'promo.png',isFolder:false,size:8,time:clock}]});
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
  // The generated images folder (#353) is asked for by its own root, and it lists like any other folder.
  fake.settings.images.set(profile,[{name:'promo.png',size:8,mtime}]);
  const generated=await ask(route(database().db),{company,agent,root:'images'});
  assert.equal(generated.status,200);
  assert.deepEqual(await generated.json(),{folder:'',entries:[{name:'promo.png',isFolder:false,size:8,time:clock,files:null,latest:null}]});
  assert.ok(!JSON.stringify(await (await ask(route(database().db),{company,agent,root:'images'})).json()).includes('/opt/'),'no path in the images answer');
  const before=fake.settings.managementRequests.length;
  assert.equal((await ask(route(database().db),{company,agent,folder:'../secret'})).status,400);
  assert.equal((await ask(route(database().db),{company,agent,root:'elsewhere'})).status,400,'a root that is neither work nor images');
  assert.equal((await ask(route(database().db),{company,agent,root:'cache/generated/images'})).status,400,'a path is never a root');
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
  // A generated image downloads through the same route, inline as a raster is, and only by its own root (#353).
  fake.settings.images.set(profile,[{name:'promo.png',size:3,mtime}]);
  fake.settings.fileBytes.set(`${images}/promo.png`,{body:new Uint8Array([1,2,3]),type:'image/png'});
  const shot=await ask(route(database().db),{name:'promo.png',root:'images'});
  assert.equal(shot.status,200);
  assert.equal(shot.headers.get('content-type'),'image/png');
  assert.equal(shot.headers.get('content-disposition'),"inline; filename*=UTF-8''promo.png");
  assert.deepEqual([...new Uint8Array(await shot.arrayBuffer())],[1,2,3]);
  // A root that is neither work nor images is refused, and no bytes are asked for.
  const imagesBefore=downloaded(fake).length;
  assert.equal((await ask(route(database().db),{name:'promo.png',root:'elsewhere'})).status,400);
  assert.equal(downloaded(fake).length,imagesBefore);
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
  // The generated images folder (#353) is the Library's second root, read for the Company that sees the Agent and only
  // there: it lists its images, and one of them downloads.
  fake.settings.images.set(profile,[{name:'promo.png',size:8,mtime}]);
  assert.deepEqual(await agentLibrary(database().db,{company,agent,root:'images',hermes:at}),{state:'found',entries:[{name:'promo.png',isFolder:false,size:8,time:clock,files:null,latest:null}]});
  const before=fake.settings.managementRequests.length;
  assert.deepEqual(await agentLibrary(database().db,{company,agent,root:'elsewhere',hermes:at}),{state:'invalid',entries:null});
  assert.deepEqual(await agentFileDownload(database().db,{company,agent,root:'elsewhere',name:'promo.png',hermes:at}),{state:'invalid'});
  assert.equal(fake.settings.managementRequests.length,before,'a root that is not one of the Library\'s never reaches the Engine');
 } finally { await fake.close(); }
});
