import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #880: files move through a Conversation on the Engine with no copy kept in gtmworks. A person's images go to the Agent
// in the Run's input and come back from the session; a file the Agent's reply names by a MEDIA line (ADR 0028) is read
// from the Agent's own work folder in the Company's work sandbox through the Engine's file routes each time it is opened.
// The fake Engine keeps a Run's images in its session as the pinned release does (tests/fake-hermes.mjs).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const list=(sql:string)=>{ const read=JSON.parse(query(sql)) as Record<string,unknown>[]|{rows:Record<string,unknown>[]}; return Array.isArray(read)?read:read.rows; };
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
// A one-pixel PNG.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
let fake:Awaited<ReturnType<typeof laneHermes>>;
// Every place a person's image or an Agent's file was ever kept: the old record's file rows and the private bucket.
const kept=()=>list(`select (select count(*) from public.conversation_attachments) as rows,(select count(*) from public.conversation_messages) as messages,
 (select count(*) from storage.objects where bucket_id='creatives') as objects`)[0];

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 query(`update public.people set language='en' where id='${omar}'`);
 query(`do $$ begin
  update public.companies set engine_conversations=true where id='${company}';
  update public.hermes_agents set is_default=false where company_id='${company}' and is_default;
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${profile}');
  insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
 end $$;`);
 // The Agent's own work folder in the work sandbox, as the Engine's read-only mount lists it.
 fake.settings.files.set(`/opt/data/work/${profile}`,[{name:'report.pdf',size:14},{name:'cover.png',size:png.length}]);
 fake.settings.fileBytes.set(`/opt/data/work/${profile}/report.pdf`,{body:'%PDF the plan',type:'application/pdf'});
 fake.settings.fileBytes.set(`/opt/data/work/${profile}/cover.png`,{body:new Uint8Array(png),type:'image/png'});
});
test.afterAll(async()=>{ await fake?.close(); });

const openConversation=async(page:Page,messages:object[]=[])=>{
 const conversation=randomUUID(); const session=`gtmworks-${randomUUID()}`;
 query(`insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${conversation}','${company}','${omar}','${lead}','Lead','${session}')`);
 fake.settings.sessions.set(session,{profile,messages});
 await signIn(page,'omar@example.com',`/c/rs-learning/conversations/${conversation}`);
 await expect(page.getByLabel('Message',{exact:true})).toBeVisible({timeout:20000});
 return {conversation,session};
};
const named=[{role:'user',content:'Make the plan',timestamp:1},
 {role:'assistant',content:`Here is the plan and its cover.\nMEDIA:/work/${profile}/report.pdf\nMEDIA:/work/${profile}/cover.png\nMEDIA:/opt/data/secrets.txt`,finish_reason:'stop',timestamp:2}];

test('an image a person attaches reaches the Agent\'s Run and is drawn in the Conversation after a reload, kept nowhere in gtmworks',async({page})=>{
 test.setTimeout(180000);
 const {conversation}=await openConversation(page,[{role:'user',content:'Hello',timestamp:1},{role:'assistant',content:'Hi Omar.',timestamp:2}]);
 await expect(page.locator('.msg[data-author=agent]')).toHaveText(/Hi Omar\./,{timeout:20000});
 const before=kept();
 const starts=fake.settings.counts().runStart??0;
 await page.locator('.composer input[type=file]').setInputFiles({name:'logo.png',mimeType:'image/png',buffer:png});
 const box=page.getByLabel('Message',{exact:true});
 await box.fill('Our logo'); await box.press('Enter');
 await expect.poll(()=>fake.settings.counts().runStart??0).toBe(starts+1);
 // The Agent's Run holds the image as the part the Engine reads, the person's own bytes.
 const run=fake.settings.runs.at(-1)!;
 const parts=(run.input as {content:{type:string,text?:string,image_url?:{url:string}}[]}[]).at(-1)!.content;
 expect(parts.map(part=>part.type)).toEqual(['text','image_url']);
 expect(parts[0].text).toBe('Our logo');
 expect(parts[1].image_url?.url).toBe(`data:image/png;base64,${png.toString('base64')}`);
 await expect(page.locator('.msg[data-author=agent]').last()).toHaveText(/Reply to: Our logo/,{timeout:30000});
 await page.reload();
 const sent=page.locator('.msg[data-author=person]').last();
 await expect(sent.locator('.bubble--user')).toHaveText('Our logo',{timeout:20000});
 // Drawn from the session that carried it, through gtmworks's own address.
 const image=sent.locator('.msg-files .file-thumb img');
 await expect(image).toHaveCount(1);
 await expect.poll(()=>image.evaluate(element=>(element as HTMLImageElement).naturalWidth)).toBe(1);
 const href=(await sent.locator('.msg-files a.file-thumb').getAttribute('href'))!;
 expect(href).toMatch(new RegExp(`^/c/rs-learning/files/conversation/${conversation}/i\\d+-0$`));
 const opened=await page.request.get(href);
 expect(opened.status()).toBe(200);
 expect(opened.headers()['content-type']).toBe('image/png');
 expect(opened.headers()['content-disposition']).toMatch(/^inline;/);
 expect(Buffer.from(await opened.body())).toEqual(png);
 expect(kept(),'no row and no stored object for the image').toEqual(before);
});

test('Try again on an image message with no reply sends its words as they were and its images again, read back from the session',async({page})=>{
 test.setTimeout(180000);
 const url=`data:image/png;base64,${png.toString('base64')}`;
 // The person's words end with a new line of their own; the Run that carried them left no reply.
 await openConversation(page,[{role:'user',content:[{type:'text',text:'Look at this\n'},{type:'image_url',image_url:{url}}],timestamp:1}]);
 const sent=page.locator('.msg[data-author=person]');
 await expect(sent.locator('.msg-files .file-thumb img')).toHaveCount(1,{timeout:20000});
 const starts=fake.settings.counts().runStart??0;
 await page.locator('[data-outcome=no-reply]').getByRole('button',{name:'Try again'}).click();
 await expect.poll(()=>fake.settings.counts().runStart??0).toBe(starts+1);
 const parts=(fake.settings.runs.at(-1)!.input as {content:{type:string,text?:string,image_url?:{url:string}}[]}[]).at(-1)!.content;
 expect(parts).toEqual([{type:'text',text:'Look at this\n'},{type:'image_url',image_url:{url}}]);
 await expect(page.locator('.msg[data-author=agent]')).toHaveText(/Reply to: Look at this/,{timeout:30000});
 // The message sent again is drawn once, as the session holds it.
 await expect(sent).toHaveCount(2);
});

test('the limits on a person\'s images are as today: a kind the Agent cannot read and too many are refused before anything is sent',async({page})=>{
 test.setTimeout(120000);
 const {conversation}=await openConversation(page);
 const starts=fake.settings.counts().runStart??0;
 const composer=page.locator('.composer');
 await composer.locator('input[type=file]').setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('notes')});
 await expect(composer.getByRole('alert')).toHaveText(/can’t read that kind of file/);
 await composer.locator('input[type=file]').setInputFiles(Array.from({length:6},(_,n)=>({name:`p${n}.png`,mimeType:'image/png',buffer:png})));
 await expect(composer.getByRole('alert')).toHaveText(/up to 5 images/);
 // The route refuses a kind the Agent cannot read again, with nothing sent.
 const vector=await page.request.post('/api/conversations',{headers:{Origin:new URL(page.url()).origin},multipart:{company,conversation,sendKey:randomUUID(),message:'Look',files:{name:'logo.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')}}});
 expect(vector.status()).toBe(400);
 expect(await vector.json()).toEqual({error:'attachTypeRefused'});
 expect(fake.settings.counts().runStart??0,'no Run started').toBe(starts);
});

test('a file the Agent named is listed under its reply and downloads, read from its work folder in the work sandbox',async({page})=>{
 test.setTimeout(120000);
 const before=kept();
 const {conversation}=await openConversation(page,named);
 const reply=page.locator('.msg[data-author=agent]');
 await expect(reply.locator('.bubble--agent')).toHaveText('Here is the plan and its cover.',{timeout:20000});
 await expect(reply).not.toContainText('MEDIA:');
 await expect(reply.locator('.msg-files--reply bdi')).toHaveText(['report.pdf','cover.png']);
 // A tag that names anything but the Agent's own folder is told by its name, and never read.
 await expect(reply.locator('[data-outcome=file-missed]')).toContainText('secrets.txt');
 expect(await reply.innerHTML()).not.toMatch(/\/work\/|\/opt\/data|co-/);
 const pdf=reply.locator('a.file-chip',{hasText:'report.pdf'});
 const href=(await pdf.getAttribute('href'))!;
 expect(href).toMatch(new RegExp(`^/c/rs-learning/files/conversation/${conversation}/f\\d+-0$`));
 const download=await page.request.get(href);
 expect(download.status()).toBe(200);
 expect(download.headers()['content-disposition']).toMatch(/^attachment;/);
 expect(download.headers()['content-type']).toBe('application/octet-stream');
 expect(await download.text()).toBe('%PDF the plan');
 const cover=reply.locator('.file-thumb img');
 await expect.poll(()=>cover.evaluate(element=>(element as HTMLImageElement).naturalWidth)).toBe(1);
 // An address the reply does not hold is the missing page.
 expect((await page.request.get(href.replace(/-0$/,'-7'))).status()).toBe(404);
 expect(kept(),'no copy of the Agent\'s files').toEqual(before);
});

test('with the work sandbox stopped the Agent\'s file is listed and says it cannot be read now',async({page})=>{
 test.setTimeout(120000);
 fake.settings.sandboxDown=true;
 try {
  const {conversation}=await openConversation(page,named);
  const reply=page.locator('.msg[data-author=agent]');
  await expect(reply.locator('.msg-files--reply bdi')).toHaveText(['report.pdf','cover.png'],{timeout:20000});
  await expect(reply.locator('.msg-files--reply a')).toHaveCount(0);
  await expect(reply.locator('[data-outcome=file-not-now]').first()).toHaveText('report.pdf can’t be read now: the work sandbox is stopped.');
  const key=(await reply.locator('.msg-files--reply [data-file]').first().getAttribute('data-file'))!;
  expect((await page.request.get(`/c/rs-learning/files/conversation/${conversation}/${key}`)).status()).toBe(503);
 } finally { fake.settings.sandboxDown=false; }
});

test('only the Conversation\'s own person downloads its files',async({page,browser})=>{
 test.setTimeout(120000);
 const {conversation}=await openConversation(page,named);
 const href=(await page.locator('.msg[data-author=agent] a.file-chip',{hasText:'report.pdf'}).getAttribute('href',{timeout:20000}))!;
 expect((await page.request.get(href)).status()).toBe(200);
 for(const email of ['manager@example.com','viewer@example.com']) {
  const context=await browser.newContext(); const other=await context.newPage();
  await signIn(other,email,'/c/rs-learning/home');
  expect((await other.request.get(href)).status(),email).toBe(404);
  await context.close();
 }
 const outside=await browser.newContext();
 expect((await outside.request.get(new URL(href,page.url()).toString())).status(),'signed out').toBe(404);
 await outside.close();
 expect(list(`select count(*)::int as n from public.conversations where id='${conversation}' and person_id='${omar}'`)[0].n).toBe(1);
});
