import { test, expect, type Page } from './fresh-seed';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';

// #155: "Attach a file" in the composer. An image goes with the message and the Agent's Run reads it; a chat started
// with an image and no text is named by the image; a file the Agent cannot read is refused before anything is stored;
// and a Conversation's file opens only for the person whose Conversation it is.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=<T>(sql:string):T[]=>JSON.parse(query(sql)) as T[];
const company='10000000-0000-0000-0000-000000000001';
// A one-pixel PNG: the Engine is given the bytes and the type the browser names, and reads the part.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const image={name:'cover.png',mimeType:'image/png',buffer:png};

async function ownerSignIn(page:Page) {
 rows(`update public.people set language='en' where id='20000000-0000-0000-0000-000000000001'`);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
}
// The default Agent is the one the chat opens on; the seed's own Lead is detached so the fake Hermes's profile is used.
function defaultAgent() {
 const stamp=randomUUID().slice(0,8); const id=randomUUID(); const connection=randomUUID();
 rows(`update public.hermes_agents set is_default=false where company_id='${company}' and is_default`);
 rows(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${id}','${company}','${connection}','Mona','Marketing',true,'mona-${stamp}')`);
 return {id,connection};
}
const conversationsOf=()=>rows<{n:number}>(`select count(*)::int as n from public.conversations where company_id='${company}'`)[0].n;
const conversationFiles=()=>rows<{n:number}>(`select count(*)::int as n from public.conversation_attachments where company_id='${company}'`)[0].n;
const storedConversationFiles=()=>rows<{n:number}>(`select count(*)::int as n from storage.objects where bucket_id='creatives' and name like '${company}/conversations/%'`)[0].n;

test.use({actionTimeout:15000});

test('an image with no text is sent, shows under the Member\'s message and names the chat, and the Run carries it',async({page})=>{
 test.setTimeout(120000);
 const fake=await laneHermes();
 try {
  await ownerSignIn(page); defaultAgent();
  await page.goto('/c/rs-learning/chat');
  const composer=page.locator('.composer');
  await composer.locator('input[type=file]').setInputFiles(image);
  // The chip above the field, and Send is on with no text at all.
  await expect(composer.locator('.composer__files .file-chip')).toHaveText(/cover\.png/);
  const send=page.getByRole('button',{name:'Send',exact:true});
  await expect(send).toBeEnabled();
  await expect(composer.getByRole('alert')).toHaveCount(0);
  await send.click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
  const conversation=page.url().split('/').pop()!;
  // The message keeps the image under its bubble, and the chat is named by the image (the sidebar and its own title).
  const turn=page.locator('.msg[data-author=person]');
  await expect(turn.locator('.msg-files .file-chip')).toHaveText(/cover\.png/);
  await expect(turn.locator('.bubble--user')).toHaveCount(0);
  await expect(page.locator('.sidebar .thread-item').filter({hasText:'cover.png'})).toBeVisible();
  await expect(page.locator('.head-pill')).toContainText('cover.png');
  const href=await turn.locator('.msg-files a.file-chip').getAttribute('href');
  expect(href).toMatch(new RegExp(`^/c/rs-learning/files/conversation/\\d+$`));
  // The Run the Agent got holds one image part, and no text.
  const run=fake.settings.runs.at(-1);
  expect(run?.input).toEqual([{role:'user',content:[{type:'image_url',image_url:{url:`data:image/png;base64,${png.toString('base64')}`}}]}]);
  // After a reload, the record still carries the image.
  await page.reload();
  await expect(page.locator('.msg[data-author=person] .msg-files .file-chip')).toHaveText(/cover\.png/);
  await expect(page.locator('.msg[data-author=person] .msg-files a.file-chip')).toHaveAttribute('href',href!);
  expect([conversationsOf(),conversationFiles(),storedConversationFiles()].every(count=>count>0)).toBe(true);
  expect(rows<{id:string}>(`select id from public.conversation_attachments where conversation_id='${conversation}'`).length).toBe(1);
 } finally { await fake.close(); }
});

test('a file the Agent cannot read is refused before anything is sent, and nothing is stored',async({page})=>{
 const fake=await laneHermes();
 try {
  await ownerSignIn(page); defaultAgent();
  await page.goto('/c/rs-learning/chat');
  const [conversations,files,stored]=[conversationsOf(),conversationFiles(),storedConversationFiles()];
  await page.locator('.composer input[type=file]').setInputFiles({name:'brief.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 a page')});
  await expect(page.locator('.composer .composer-error')).toHaveText('The agent can’t read that kind of file yet. Attach a PNG, JPEG, GIF or WebP image.');
  await expect(page.locator('.composer .composer__files .file-chip')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
  // The same refusal on the server: the request is answered before the Agent is asked, and stores nothing.
  const answer=await page.request.post('/api/conversations',{multipart:{company,conversation:randomUUID(),sendKey:randomUUID(),message:'',files:{name:'brief.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 a page')}}});
  expect(answer.status()).toBe(400);
  expect(await answer.json()).toEqual({error:'attachTypeRefused'});
  expect(fake.settings.runs.length).toBe(0);
  expect([conversationsOf(),conversationFiles(),storedConversationFiles()]).toEqual([conversations,files,stored]);
 } finally { await fake.close(); }
});

test('a Conversation\'s file opens for its own person and for nobody else',async({page})=>{
 const fake=await laneHermes();
 try {
  await ownerSignIn(page); defaultAgent();
  const conversation=randomUUID();
  const sent=await page.request.post('/api/conversations',{multipart:{company,conversation,sendKey:randomUUID(),message:'',files:image}});
  expect(sent.ok()).toBe(true);
  const [file]=rows<{id:number}>(`select id from public.conversation_attachments where conversation_id='${conversation}'`);
  const address=`/c/rs-learning/files/conversation/${file.id}`;
  // Its own person reads it, with the headers every attachment leaves with.
  const own=await page.request.get(address);
  expect(own.status()).toBe(200);
  expect(own.headers()['content-type']).toBe('image/png');
  expect(own.headers()['content-disposition']).toMatch(/^inline;/);
  expect(own.headers()['x-content-type-options']).toBe('nosniff');
  // Another Member of the Company, and a visitor with no sign-in, find nothing.
  await signIn(page,'manager@example.com','/c/rs-learning/home');
  expect((await page.request.get(address)).status()).toBe(404);
  await page.context().clearCookies();
  expect((await page.request.get(address)).status()).toBe(404);
 } finally { await fake.close(); }
});
