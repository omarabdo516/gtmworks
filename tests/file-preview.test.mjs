import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { readAgentFile } from '../lib/hermes.mjs';
import { agentFilePreview } from '../lib/agent-files.mjs';
import { csvRows, filePreviewKind } from '../lib/file-preview.mjs';
import { fakeHermes } from './fake-hermes.mjs';

// A file of an Agent's Library opens in a read-only preview (#195): a raster picture, text or Markdown as plain text, a
// CSV as its first rows, or its icon and a download. The text is the file's first 512 KB, read from the Engine's managed
// files (`/api/files/download`, never the sandbox's `/api/fs/*` routes) with its whole size and whether more follows,
// through the same path guard and the same Roles as #194, and a vector or page is never handed any inline content.
const company='10000000-0000-0000-0000-000000000001';
const otherCompany='10000000-0000-0000-0000-000000000002';
const agent='3a000000-0000-0000-0000-000000000021';
const otherAgent='3a000000-0000-0000-0000-000000000041';
const person='9a000000-0000-0000-0000-000000000001';
const profile=`ag-${agent.replaceAll('-','')}`;
const otherProfile=`ag-${otherAgent.replaceAll('-','')}`;
const home=`/opt/data/profiles/${profile}`;
// The Agent's own folder in the Company's work folder, as the Engine sees it read-only (#395).
const work=`/opt/data/work/${profile}`;
// The folder the Engine writes a generated image into (#353; agent/provider_media.py, GENERATED_SUBDIR, cache_dir).
const images=`${home}/cache/generated/images`;
const mtime=1763500000;
const clock=new Date(mtime*1000).toISOString();
const hermes=()=>({address:process.env.BUNDLED_HERMES_URL,key:process.env.HERMES_API_KEY});

const require=createRequire(import.meta.url);
const [permissions,service]=[await import('../lib/route-permissions.mjs'),await import('../lib/agent-files.mjs')];
// Execute a real route with only its I/O replaced; no server and no database (as agent-files.test.mjs does).
function load(file,imports,globals={}) {
 const exports={};
 const {outputText}=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ESNext,esModuleInterop:true}});
 runInNewContext(outputText,{exports,require:name=>imports[name] ?? require(name),URL,URLSearchParams,Error,Response,Request,Headers,process,...globals});
 return exports;
}

async function engine() {
 const fake=await fakeHermes();
 for(const name of [profile,otherProfile]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.files.set(work,[]);
 return {fake,at:{address:fake.address,managementAddress:fake.managementAddress,profile,key:'test-only-key'}};
}
const texts=fake=>fake.settings.managementRequests.filter(request=>String(request.path).startsWith('/api/files/download'));

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
// One file in the work folder, with its bytes.
async function withFile(fake,name,body,type) {
 fake.settings.files.set(work,[{name,size:Buffer.byteLength(body),mtime}]);
 fake.settings.fileBytes.set(`${work}/${name}`,{body,type});
}

test('the preview kind: a raster is a picture, text and Markdown are text, a CSV is a table, and a vector or page is neither', () => {
 for(const type of ['image/png','image/jpeg','image/gif','image/webp']) assert.equal(filePreviewKind('shot',/** @type {any} */(type)),'image',type);
 assert.equal(filePreviewKind('shot.png','image/png'),'image');
 for(const name of ['note.txt','note.md','note.markdown']) assert.equal(filePreviewKind(name,'application/octet-stream'),'text',name);
 assert.equal(filePreviewKind('note.md','text/markdown'),'text');
 assert.equal(filePreviewKind('rows.csv','text/csv'),'table');
 assert.equal(filePreviewKind('rows.csv','application/octet-stream'),'table');
 // A vector image and a page are downloaded only: nothing of them is ever drawn.
 for(const [name,type] of [['logo.svg','image/svg+xml'],['page.html','text/html'],['data.json','application/json'],['sheet.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]) assert.equal(filePreviewKind(name,type),'none',name);
});

test('a CSV is read as its rows, quotes and all, and only its first rows are kept', () => {
 assert.deepEqual(csvRows('name,spend\nA,10\nB,20\n'),[['name','spend'],['A','10'],['B','20']]);
 assert.deepEqual(csvRows('name,note\n"Lead, Q4","says ""hi"""\n'),[['name','note'],['Lead, Q4','says "hi"']]);
 const many=Array.from({length:50},(_,at)=>`row ${at}`).join('\n');
 assert.equal(csvRows(many,5).length,5);
 assert.equal(csvRows(many,5)[4][0],'row 4');
 assert.deepEqual(csvRows(''),[]);
});

test('a file\'s first part is read through the Engine, with its type, its whole size and whether more follows, and a binary has no text', async () => {
 const {fake,at}=await engine();
 try {
  const text='# Brief\n\nSell more.\n';
  await withFile(fake,'brief.md',text,'text/markdown');
  assert.deepEqual(await readAgentFile(at,{name:'brief.md'}),{state:'found',name:'brief.md',type:'text/markdown',byteSize:Buffer.byteLength(text),truncated:false,text});
  assert.ok(fake.settings.managementRequests.some(request=>request.path===`/api/files/download?path=${encodeURIComponent(`${work}/brief.md`)}`));
  assert.deepEqual(fake.settings.workspaceReads,[],'the text is never asked of the sandbox\'s workspace routes');
  // A folder inside the work folder is read by its relative name.
  fake.settings.files.set(`${work}/reports`,[{name:'q3.csv',size:9,mtime}]);
  fake.settings.fileBytes.set(`${work}/reports/q3.csv`,{body:'a,b\n1,2\n',type:'text/csv'});
  assert.equal((await readAgentFile(at,{folder:'reports',name:'q3.csv'})).state,'found');
  // A picture is binary, and its bytes are never handed on as text.
  fake.settings.files.set(work,[{name:'shot.png',size:8,mtime}]);
  fake.settings.fileBytes.set(`${work}/shot.png`,{body:new Uint8Array([137,80,78,71,0,1,2,3]),type:'image/png'});
  const shot=await readAgentFile(at,{name:'shot.png'});
  assert.deepEqual(shot,{state:'found',name:'shot.png',type:'image/png',byteSize:8,truncated:false,text:null});
  // A long file keeps its whole size and says that more follows.
  const long='a'.repeat(600*1024);
  fake.settings.files.set(work,[{name:'long.txt',size:long.length,mtime}]);
  fake.settings.fileBytes.set(`${work}/long.txt`,{body:long,type:'text/plain'});
  const cut=await readAgentFile(at,{name:'long.txt'});
  assert.equal(cut.state,'found');
  if(cut.state==='found') { assert.equal(cut.byteSize,long.length); assert.equal(cut.truncated,true); assert.equal(cut.text?.length,512*1024); }
  // A file no longer holds, an Engine that cannot be read and a refused key are each told apart from empty text.
  fake.settings.files.set(work,[]);
  assert.deepEqual(await readAgentFile(at,{name:'brief.md'}),{state:'missing'});
  assert.deepEqual(await readAgentFile({...at,key:'another-key'},{name:'brief.md'}),{state:'refused'});
  assert.deepEqual(await readAgentFile({...at,profile:'ag-nothing'},{name:'brief.md'}),{state:'missing'});
 } finally { await fake.close(); }
});

test('a file that became a link out of the Engine\'s files after the listing is missing, and its text is never handed on', async () => {
 const {fake,at}=await engine();
 try {
  const text='# Brief\n\nSell more.\n';
  await withFile(fake,'brief.md',text,'text/markdown');
  // The link was swapped between the folder's listing and the read: the Engine refuses a path outside its root.
  fake.settings.resolved.set(`${work}/brief.md`,'/etc/passwd');
  assert.deepEqual(await readAgentFile(at,{name:'brief.md'}),{state:'missing'});
  fake.settings.resolved.delete(`${work}/brief.md`);
  assert.equal((await readAgentFile(at,{name:'brief.md'})).state,'found');
 } finally { await fake.close(); }
});

test('a path or name that could leave the work folder is refused before the Engine is asked for its text', async () => {
 const {fake,at}=await engine();
 try {
  for(const bad of ['..','../..','a/../b','/etc/passwd','C:\\\\windows','a\\\\b','.hidden','a\u0000b','x'.repeat(129),'a/b',42,null,{}]) {
   assert.deepEqual(await readAgentFile(at,{name:/** @type {any} */(bad)}),{state:'invalid'},String(bad));
  }
  for(const bad of ['..','../..','a/../b','/etc/passwd','C:\\\\windows','a\\\\b','.hidden','a\u0000b','x'.repeat(129),42,null,{}]) {
   assert.deepEqual(await readAgentFile(at,{folder:/** @type {any} */(bad),name:'brief.md'}),{state:'invalid'},String(bad));
  }
  assert.equal(texts(fake).length,0,'the Engine was never asked');
  // A link out of the folder, and a folder named as a file, are not a file to read.
  fake.settings.files.set(work,[{name:'passwd',size:9,mtime,resolves:'/etc/passwd'},{name:'reports',isFolder:true}]);
  assert.deepEqual(await readAgentFile(at,{name:'passwd'}),{state:'missing'});
  assert.deepEqual(await readAgentFile(at,{name:'reports'}),{state:'invalid'});
  assert.equal(texts(fake).length,0);
 } finally { await fake.close(); }
});

test('the preview service reads one Agent\'s file for the Company that sees it, and hands on no content it would not draw', async () => {
 const {fake,at}=await engine();
 try {
  const text='# Brief\n\nSell more.\n';
  await withFile(fake,'brief.md',text,'text/markdown');
  assert.deepEqual(await agentFilePreview(database().db,{company,agent,hermes:at,name:'brief.md'}),{state:'found',preview:{name:'brief.md',kind:'text',type:'text/markdown',byteSize:Buffer.byteLength(text),truncated:false,text}});
  // A CSV is a table; a picture is drawn from the download route and carries no text here.
  await withFile(fake,'q3.csv','name,spend\nA,10\n','text/csv');
  assert.equal((await agentFilePreview(database().db,{company,agent,hermes:at,name:'q3.csv'})).preview?.kind,'table');
  await withFile(fake,'shot.png',new Uint8Array([137,80,78,71,0,1]),'image/png');
  assert.deepEqual((await agentFilePreview(database().db,{company,agent,hermes:at,name:'shot.png'})).preview,{name:'shot.png',kind:'image',type:'image/png',byteSize:6,truncated:false,text:null});
  // A raster over the Engine's read ceiling is still drawn: its listed size answers, and no read is asked for it.
  fake.settings.files.set(work,[{name:'big.png',size:700*1024,mtime}]);
  const before=texts(fake).length;
  assert.deepEqual((await agentFilePreview(database().db,{company,agent,hermes:at,name:'big.png'})).preview,{name:'big.png',kind:'image',type:'image/png',byteSize:700*1024,truncated:false,text:null});
  assert.equal(texts(fake).length,before,'a picture is answered from the listing, with no read');
  // A vector image and a page are never handed content; their answer is the listing's too, so no read is asked.
  await withFile(fake,'logo.svg','<svg onload="alert(1)"></svg>','image/svg+xml');
  assert.deepEqual((await agentFilePreview(database().db,{company,agent,hermes:at,name:'logo.svg'})).preview,{name:'logo.svg',kind:'none',type:'application/octet-stream',byteSize:29,truncated:false,text:null});
  await withFile(fake,'page.html','<script>alert(1)</script>','text/html');
  assert.deepEqual((await agentFilePreview(database().db,{company,agent,hermes:at,name:'page.html'})).preview,{name:'page.html',kind:'none',type:'application/octet-stream',byteSize:25,truncated:false,text:null});
  assert.equal(texts(fake).length,before,'none of the three asks the Engine for text');
  // A hidden Agent, another Company's Agent and no Engine each find nothing.
  assert.deepEqual(await agentFilePreview(database({agents:[]}).db,{company,agent,hermes:at,name:'brief.md'}),{state:'missing',preview:null});
  assert.deepEqual(await agentFilePreview(database().db,{company:otherCompany,agent,hermes:at,name:'brief.md'}),{state:'missing',preview:null});
  assert.deepEqual(await agentFilePreview(database().db,{company,agent,hermes:null,name:'brief.md'}),{state:'missing',preview:null});
  // A generated image (#353) previews from its own root as any other raster does, with no read of its bytes.
  fake.settings.images.set(profile,[{name:'promo.png',size:8,mtime}]);
  const reads=texts(fake).length;
  assert.deepEqual((await agentFilePreview(database().db,{company,agent,root:'images',hermes:at,name:'promo.png'})).preview,{name:'promo.png',kind:'image',type:'image/png',byteSize:8,truncated:false,text:null});
  assert.equal(texts(fake).length,reads,'a picture is answered from the listing');
  // A root that is neither work nor images is refused before the Engine is asked.
  assert.deepEqual(await agentFilePreview(database().db,{company,agent,root:'elsewhere',hermes:at,name:'promo.png'}),{state:'invalid',preview:null});
 } finally { await fake.close(); }
});

test('the read route answers an Owner and a Manager, and a Contributor, a Viewer, another Company\'s Agent and a path outside the folder get no content', async () => {
 const {fake,at}=await engine();
 try {
  const text='# Brief\n\nSell more.\n';
  await withFile(fake,'brief.md',text,'text/markdown');
  process.env.BUNDLED_HERMES_URL=fake.address; process.env.HERMES_API_KEY='test-only-key';
  const {NextRequest}=require('next/server');
  const drivers={agentFilePreview:(/** @type {any} */ db,/** @type {any} */ request)=>service.agentFilePreview(db,{...request,hermes:{...hermes(),managementAddress:fake.managementAddress}})};
  const route=(/** @type {any} */ db)=>load('app/api/agent-files/preview/route.ts',{
   '@/lib/supabase':{supabase:async()=>db},
   '@/lib/route-permissions.mjs':permissions,
   '@/lib/agent-files.mjs':drivers,
  }).GET;
  const ask=(/** @type {Function} */ GET,/** @type {Record<string,string>} */ query)=>GET(new NextRequest(`http://app.test/api/agent-files/preview?${new URLSearchParams(query)}`));
  for(const role of ['owner','manager']) {
   const response=await ask(route(database({role}).db),{company,agent,name:'brief.md'});
   assert.equal(response.status,200,role);
   assert.deepEqual(await response.json(),{name:'brief.md',kind:'text',type:'text/markdown',byteSize:Buffer.byteLength(text),truncated:false,text});
   assert.equal(response.headers.get('cache-control'),'no-store');
  }
  assert.equal((await ask(route(database().db),{company,agent,name:'brief.md'})).status,200);
  // An SVG's answer carries no inline content at all.
  await withFile(fake,'logo.svg','<svg onload="alert(1)"></svg>','image/svg+xml');
  const svg=await ask(route(database().db),{company,agent,name:'logo.svg'});
  assert.equal(svg.status,200);
  assert.deepEqual(await svg.json(),{name:'logo.svg',kind:'none',type:'application/octet-stream',byteSize:29,truncated:false,text:null});
  // A Contributor and a Viewer are refused before the Agent list is read.
  for(const role of ['contributor','viewer']) {
   const given=database({role});
   assert.equal((await ask(route(given.db),{company,agent,name:'brief.md'})).status,403,role);
   assert.deepEqual(given.asked,[],'a Role below Manager never reaches the Agent list');
  }
  // A signed-out reader, a hidden Agent and another Company's Agent get nothing.
  assert.equal((await ask(route(database({signedIn:null}).db),{company,agent,name:'brief.md'})).status,401);
  assert.equal((await ask(route(database({agents:[]}).db),{company,agent,name:'brief.md'})).status,404);
  const elsewhere=database({companyRow:{id:otherCompany},agents:[{agent,name:'Elsewhere',connection:'c',profile:otherProfile,main:true,own:true}]});
  assert.equal((await ask(route(elsewhere.db),{company:otherCompany,agent,name:'brief.md'})).status,404);
  // A missing name, a name that could leave the folder and a folder that could too are refused with no text read.
  const before=texts(fake).length;
  // A generated image (#353) previews by its own root, and a root that is neither of the Library's is refused with no
  // Engine answer and no text read.
  fake.settings.images.set(profile,[{name:'promo.png',size:8,mtime}]);
  const generated=await ask(route(database().db),{company,agent,root:'images',name:'promo.png'});
  assert.equal(generated.status,200);
  assert.deepEqual(await generated.json(),{name:'promo.png',kind:'image',type:'image/png',byteSize:8,truncated:false,text:null});
  assert.equal(texts(fake).length,before,'a picture is answered from the listing');
  assert.equal((await ask(route(database().db),{company,agent,root:'elsewhere',name:'promo.png'})).status,400);
  assert.equal(texts(fake).length,before);
  assert.equal((await ask(route(database().db),{company,agent})).status,400);
  assert.equal((await ask(route(database().db),{company,agent,name:'../../etc/passwd'})).status,400);
  assert.equal((await ask(route(database().db),{company,agent,folder:'../secret',name:'brief.md'})).status,400);
  assert.equal(texts(fake).length,before,'the Engine was never asked for text');
  // No answer carries an Engine address or a path on its disk.
  const answer=JSON.stringify(await (await ask(route(database().db),{company,agent,name:'brief.md'})).json());
  assert.ok(!answer.includes(fake.address)&&!answer.includes('/opt/'),'no address and no path');
 } finally { await fake.close(); }
});
