import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { deflateRawSync, crc32 } from 'node:zlib';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #871 (spec #866): on the Owner's own Hermes dashboard everything is open but four things that break gtmworks itself
// (Omar, 2026-11-26). Each is refused at the gate, on its route, before anything reaches the Engine, with a page that
// says gtmworks manages it and where: showing a key (the Engine's own key is in its profiles' .env files, and the route
// that shows a key cannot tell it from a model key), updating Hermes off the install's pin, importing a backup over the
// Engine's data, and making, renaming or deleting a profile (an Agent). No answer of the dashboard holds the Engine's
// key, whichever route is asked: one that would is refused the same way. Every other change an Owner makes there
// reaches the Engine and takes.
const owner='20000000-0000-0000-0000-000000000001';
const key='test-only-key';
let fake:Awaited<ReturnType<typeof fakeHermes>>;
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{ freshSeed(testInfo); fake=await laneHermes(); });
test.afterAll(async()=>{ await fake?.close(); });

// A request the dashboard's own code makes, from its page: its status, its type and its body.
async function ask(page:Page,path:string,{method='GET',body}:{method?:string,body?:unknown}={}) {
 return page.evaluate(async([path,method,body])=>{
  const answer=await fetch(`/c/rs-learning/hermes${path}`,{method,headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:answer.status,type:answer.headers.get('content-type')??'',text:await answer.text()};
 },[path,method,body] as const);
}
const reached=(path:string)=>fake.settings.managementRequests.some(request=>new URL(request.path??'/','http://engine').pathname===path);

// The four, each on its route as the dashboard asks it (hermes_cli/web_routers on the pinned Engine), with where gtmworks
// does it instead: the Settings section the page links to.
const refused=[
 {what:'showing a key',method:'POST',path:'/api/env/reveal',body:{key:'API_SERVER_KEY',profile:'default'},section:'models',en:/key stays on the server/,ar:/المفتاح/},
 {what:'showing a model key',method:'POST',path:'/api/env/reveal',body:{key:'OPENROUTER_API_KEY',profile:'default'},section:'models',en:/key stays on the server/,ar:/المفتاح/},
 {what:'downloading a backup, which holds the key',method:'GET',path:'/api/ops/backup/download?archive=/opt/data/backups/hermes-backup.zip',section:'backup',en:/key stays on the server/,ar:/المفتاح/},
 {what:'updating Hermes',method:'POST',path:'/api/hermes/update',body:{},section:'about',en:/gtmworks update/,ar:/gtmworks update/},
 {what:'importing a backup',method:'POST',path:'/api/ops/import',body:{archive:'/opt/data/backups/hermes-backup.zip',force:true},section:'backup',en:/gtmworks restore/,ar:/gtmworks restore/},
 {what:'uploading a backup to import',method:'POST',path:'/api/ops/import-upload',body:{},section:'backup',en:/gtmworks restore/,ar:/gtmworks restore/},
 {what:'making a profile',method:'POST',path:'/api/profiles',body:{name:'made-here'},section:'agents',en:/Agents are made/,ar:/الوكلاء/},
 {what:'importing a profile',method:'POST',path:'/api/profiles/import',body:{},section:'agents',en:/Agents are made/,ar:/الوكلاء/},
 {what:'renaming a profile',method:'PATCH',path:'/api/profiles/rs-learning-agent',body:{new_name:'renamed'},section:'agents',en:/Agents are made/,ar:/الوكلاء/},
 {what:'deleting a profile',method:'DELETE',path:'/api/profiles/rs-learning-agent',section:'agents',en:/Agents are made/,ar:/الوكلاء/},
] as const;

test('each of the four is refused for an Owner on its route, reaches nothing of the Engine, and names where gtmworks does it',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings'); await page.goto('/c/rs-learning/hermes/');
 await expect(page.getByRole('heading',{name:'Hermes dashboard'})).toBeVisible();
 for(const asked of refused) {
  const before=fake.settings.managementRequests.length;
  // From the dashboard's own code: a refusal its pages show in their own error line.
  const answer=await ask(page,asked.path,{method:asked.method,body:'body' in asked?asked.body:undefined});
  expect(answer.status,asked.what).toBe(403);
  expect(answer.type,asked.what).toMatch(/json/);
  const said=JSON.parse(answer.text);
  expect(said.detail,asked.what).toMatch(asked.en);
  expect(said.where,asked.what).toBe(`/c/rs-learning/settings?section=${asked.section}`);
  expect(fake.settings.managementRequests.length,`${asked.what} reached nothing of the Engine`).toBe(before);
 }
 // The same route asked another way is the same route: a trailing slash, a doubled slash, an escaped letter.
 for(const path of ['/api/hermes/update/','//api/hermes/update','/api/hermes/%75pdate','/api/x/../hermes/update']) {
  const answer=await ask(page,path,{method:'POST',body:{}});
  expect(answer.status,path).toBe(403);
 }
 expect(reached('/api/hermes/update')).toBe(false);
 expect(fake.settings.reveals).toEqual([]);
 // Opened as a page, the refusal is a page of gtmworks's: what gtmworks manages, and a link to where.
 await page.goto('/c/rs-learning/hermes/api/ops/backup/download?archive=/opt/data/backups/hermes-backup.zip');
 await expect(page.getByRole('heading',{name:'gtmworks manages this'})).toBeVisible();
 await expect(page.getByText(/key stays on the server/)).toBeVisible();
 await page.getByRole('link',{name:'Settings › Backups'}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings\?section=backup/);
});

test('the refusal is in the person\'s own language',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings'); await page.goto('/c/rs-learning/hermes/');
 query(`update public.people set language='ar' where id='${owner}'`);
 try {
  for(const asked of refused) {
   const answer=await ask(page,asked.path,{method:asked.method,body:'body' in asked?asked.body:undefined});
   expect(JSON.parse(answer.text).detail,asked.what).toMatch(asked.ar);
  }
  await page.goto('/c/rs-learning/hermes/api/ops/backup/download?archive=x.zip');
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  await expect(page.getByRole('heading',{name:'ده gtmworks اللي بيديره'})).toBeVisible();
 } finally { query(`update public.people set language='en' where id='${owner}'`); }
});

// A zip of one file, as a backup archive holds the profile's .env: deflated, so the key is not in its bytes as written.
function zipOf(name:string,content:string) {
 const data=Buffer.from(content); const packed=deflateRawSync(data); const named=Buffer.from(name); const sum=crc32(data);
 const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(20,4); local.writeUInt16LE(8,8);
 local.writeUInt32LE(sum,14); local.writeUInt32LE(packed.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(named.length,26);
 const central=Buffer.alloc(46); central.writeUInt32LE(0x02014b50,0); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(8,10);
 central.writeUInt32LE(sum,16); central.writeUInt32LE(packed.length,20); central.writeUInt32LE(data.length,24); central.writeUInt16LE(named.length,28);
 const at=30+named.length+packed.length;
 const end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(46+named.length,12); end.writeUInt32LE(at,16);
 return Buffer.concat([local,named,packed,central,named,end]);
}

test('the Engine\'s own key appears in no answer, whichever key route is asked, and writing a key stays open',async({page})=>{
 const env=`OPENROUTER_API_KEY=sk-or-model\nAPI_SERVER_KEY=${key}\n`;
 // Files of the Engine's data that hold its key, which a file route could serve: as text, as base64, and in an archive.
 fake.settings.files.set('/opt/data/backups',[{name:'notes.txt'},{name:'hermes-backup.zip'},{name:'plain.txt'}]);
 fake.settings.fileBytes.set('/opt/data/backups/notes.txt',{body:`copied by hand\n${env}`,type:'text/plain'});
 fake.settings.fileBytes.set('/opt/data/backups/hermes-backup.zip',{body:zipOf('.env',env),type:'application/zip'});
 fake.settings.fileBytes.set('/opt/data/backups/plain.txt',{body:'nothing secret here\n',type:'text/plain'});
 const answers:string[]=[];
 page.on('response',async response=>{ try { answers.push(`${response.url()} ${JSON.stringify(response.headers())} ${(await response.body()).toString('latin1')}`); } catch { /* a redirect has no body */ } });
 await signIn(page,'omar@example.com','/c/rs-learning/settings'); await page.goto('/c/rs-learning/hermes/');
 await expect(page.getByRole('heading',{name:'Hermes dashboard'})).toBeVisible();
 const seen=[];
 for(const path of ['/api/files/download?path=/opt/data/backups/notes.txt','/api/files/read?path=/opt/data/backups/notes.txt','/api/files/download?path=/opt/data/backups/hermes-backup.zip','/api/ops/dump']) {
  const answer=await ask(page,path,{method:path==='/api/ops/dump'?'POST':'GET'});
  seen.push(answer.text);
  expect(answer.status,path).toBe(403);
  expect(JSON.parse(answer.text).detail,path).toMatch(/key stays on the server/);
 }
 // A file that holds no key is served as it is.
 const plain=await ask(page,'/api/files/download?path=/opt/data/backups/plain.txt');
 expect(plain).toMatchObject({status:200,text:'nothing secret here\n'});
 // The list of keys shows each set key's preview, never the Engine's key; setting and replacing a key stays open.
 const listed=await ask(page,'/api/env');
 expect(listed.status).toBe(200);
 const wrote=await ask(page,'/api/env',{method:'PUT',body:{key:'OPENROUTER_API_KEY',value:'sk-or-new-model-key'}});
 expect(wrote.status).toBe(200);
 expect(fake.settings.defaultEnv.OPENROUTER_API_KEY).toBe('sk-or-new-model-key');
 for(const text of [...seen,listed.text,...answers]) expect(text).not.toContain(key);
 for(const text of [...seen,...answers]) expect(text).not.toContain(Buffer.from(key).toString('base64').slice(0,12));
});

test('an Owner connects a messaging platform, adds an MCP server, installs a plugin, makes a webhook, edits a Skill and changes a model, and each takes',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings'); await page.goto('/c/rs-learning/hermes/');
 await expect(page.getByRole('heading',{name:'Hermes dashboard'})).toBeVisible();
 const wrote=async(path:string,method:string,body:unknown)=>{ const answer=await ask(page,path,{method,body}); expect(answer.status,`${method} ${path}: ${answer.text}`).toBe(200); };
 const read=async(path:string)=>{ const answer=await ask(page,path); expect(answer.status,path).toBe(200); return JSON.parse(answer.text); };
 await wrote('/api/messaging/platforms/telegram','PUT',{enabled:true,env:{TELEGRAM_BOT_TOKEN:'123:telegram-token'}});
 expect((await read('/api/messaging/platforms')).platforms.find((platform:{id:string})=>platform.id==='telegram')).toMatchObject({enabled:true,configured:true});
 await wrote('/api/mcp/servers','POST',{name:'crm',url:'https://mcp.crm.example/mcp',auth:'none'});
 expect((await read('/api/mcp/servers')).servers.map((server:{name:string})=>server.name)).toContain('crm');
 await wrote('/api/dashboard/agent-plugins/install','POST',{identifier:'hermes-plugin-calendar',enable:true});
 expect((await read('/api/dashboard/plugins')).map((plugin:{name:string})=>plugin.name)).toContain('hermes-plugin-calendar');
 await wrote('/api/webhooks/enable','POST',{});
 await wrote('/api/webhooks','POST',{name:'new-lead',prompt:'A new lead came in',deliver:'log'});
 expect((await read('/api/webhooks')).webhooks.map((hook:{name:string})=>hook.name)).toContain('new-lead');
 await wrote('/api/skills','POST',{name:'follow-up',content:'---\nname: follow-up\ndescription: Follow up\n---\nFirst words.'});
 await wrote('/api/skills/content','PUT',{name:'follow-up',content:'---\nname: follow-up\ndescription: Follow up\n---\nEdited words.'});
 expect((await read('/api/skills/content?name=follow-up')).content).toContain('Edited words.');
 await wrote('/api/model/set','POST',{scope:'main',provider:'openrouter',model:'anthropic/claude-sonnet-4'});
 expect(await read('/api/model/info')).toMatchObject({provider:'openrouter',model:'anthropic/claude-sonnet-4'});
});
