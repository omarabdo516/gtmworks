import { test, expect, type Page } from './fresh-seed';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';

// #155: "Attach a file" in the composer. An image goes with the message and the Agent's Run reads it; a chat started
// with an image and no text is named by the image; a file the Agent cannot read is refused before anything is stored;
// and a Conversation's file opens only for the person whose Conversation it is.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
// A read answers an array (or `{rows}` on a newer CLI); a write answers no rows, so it goes through `query`.
const rows=<T>(sql:string):T[]=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as T[]; };
const company='10000000-0000-0000-0000-000000000001';
// A one-pixel PNG: the Engine is given the bytes and the type the browser names, and reads the part.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const image={name:'cover.png',mimeType:'image/png',buffer:png};

async function ownerSignIn(page:Page) {
 query(`update public.people set language='en' where id='20000000-0000-0000-0000-000000000001'`);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
}
// The default Agent is the one the chat opens on; the seed's own Lead is detached so the fake Hermes's profile is used.
function defaultAgent() {
 const stamp=randomUUID().slice(0,8); const id=randomUUID(); const connection=randomUUID();
 query(`update public.hermes_agents set is_default=false where company_id='${company}' and is_default`);
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${id}','${company}','${connection}','Mona','Marketing',true,'mona-${stamp}')`);
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
  // The newest person turn is this send, so a retry of this test reads its own message and not the attempt before it.
  const turn=page.locator('.msg[data-author=person]').last();
  await expect(turn.locator('.msg-files .file-chip')).toHaveText(/cover\.png/);
  await expect(turn.locator('.bubble--user')).toHaveCount(0);
  await expect(page.locator(`.sidebar .thread-item[href$="/conversations/${conversation}"]`)).toContainText('cover.png');
  await expect(page.locator('.head-pill')).toContainText('cover.png');
  const href=await turn.locator('.msg-files a.file-chip').getAttribute('href');
  expect(href).toMatch(new RegExp(`^/c/rs-learning/files/conversation/\\d+$`));
  // The Run the Agent got holds one image part, and no text.
  const run=fake.settings.runs.at(-1);
  expect(run?.input).toEqual([{role:'user',content:[{type:'image_url',image_url:{url:`data:image/png;base64,${png.toString('base64')}`}}]}]);
  // After a reload, the record still carries the image.
  await page.reload();
  await expect(page.locator('.msg[data-author=person] .msg-files .file-chip').last()).toHaveText(/cover\.png/);
  await expect(page.locator('.msg[data-author=person] .msg-files a.file-chip').last()).toHaveAttribute('href',href!);
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
  await page.context().clearCookies();
  await signIn(page,'manager@example.com','/c/rs-learning/home');
  expect((await page.request.get(address)).status()).toBe(404);
  await page.context().clearCookies();
  expect((await page.request.get(address)).status()).toBe(404);
 } finally { await fake.close(); }
});

// #465: a turn with an image that waits behind a busy Agent, whose start was attempted and its answer lost, keeps its
// image while it may still need it: its sender's resend of the same key finds it waiting and removes or replaces nothing, and once
// the Agent is free the worker starts it as a retry with the same image (the service role reads the waiting turn's
// files). supabase/tests/queued_turn_files_kept.sql proves the discard rule case by case.
test('an image turn that waited, its start unknown, keeps its image and starts with it once the Agent is free',async({page})=>{
 test.setTimeout(120000);
 const fake=await laneHermes();
 try {
  await ownerSignIn(page); const agent=defaultAgent();
  const conversation=randomUUID(); const key=randomUUID(); const blocker=randomUUID();
  expect((await page.request.post('/api/conversations',{multipart:{company,conversation,sendKey:randomUUID(),message:'First, the plan'}})).ok()).toBe(true);
  // The Agent is busy with another Run of this Conversation, already attempted.
  const reserve=(sendKey:string,message:string,unknown:boolean)=>query(`insert into public.conversation_run_reservations(conversation_id,send_key,company_id,connection_id,person_id,agent_id,message,profile,start_attempts,start_unknown_at)
   select '${conversation}','${sendKey}','${company}',a.connection_id,'20000000-0000-0000-0000-000000000001',a.id,'${message}',a.profile,1,${unknown?'now()':'null'} from public.hermes_agents a where a.id='${agent.id}'`);
  reserve(blocker,'busy',false);
  const send=()=>page.request.post('/api/conversations',{multipart:{company,conversation,sendKey:key,message:'Look at this chart',files:image}});
  const queued=await send();
  expect(await queued.json()).toEqual({conversation,queued:true});
  // The worker attempted its start and the answer was lost: the start is marked unknown, and a Run may exist.
  reserve(key,'Look at this chart',true);
  const files=()=>rows<{path:string}>(`select path from public.conversation_attachments where send_key='${key}'`);
  const stored=()=>rows<{n:number}>(`select count(*)::int as n from storage.objects o join public.conversation_attachments a on o.name=a.path where o.bucket_id='creatives' and a.send_key='${key}'`)[0].n;
  expect([files().length,stored()]).toEqual([1,1]);
  // Its sender sends it again, even with other and more images under the same key: it is still waiting, its image stays,
  // and nothing is written beside it (no object without a row, which nothing would read or remove).
  const objects=()=>rows<{n:number}>(`select count(*)::int as n from storage.objects where bucket_id='creatives' and name like '${company}/conversations/${conversation}/${key}-%'`)[0].n;
  const again=new FormData();
  for(const [name,value] of Object.entries({company,conversation,sendKey:key,message:'Look at this chart'})) again.append(name,value);
  for(const extra of ['another image','a third image']) again.append('files',new Blob([Buffer.concat([png,Buffer.from(extra)])],{type:'image/png'}),'cover.png');
  expect(await (await page.request.post('/api/conversations',{multipart:again})).json()).toEqual({conversation,queued:true});
  expect([files().length,stored(),objects()]).toEqual([1,1,1]);
  // The Run ahead of it settles: the worker starts the turn as a retry, with the image it was sent with.
  query(`delete from public.conversation_run_reservations where send_key='${blocker}'`);
  await expect.poll(async()=>{ await page.request.get(`/api/conversations?company=${company}&conversation=${conversation}`);
   return rows<{n:number}>(`select count(*)::int as n from public.conversation_messages m join public.conversation_attachments a on a.message_id=m.id where m.send_key='${key}'`)[0].n; },{timeout:60000}).toBe(1);
  const run=fake.settings.runs.find(each=>JSON.stringify(each.input).includes('Look at this chart'));
  expect(run?.input).toEqual([{role:'user',content:[{type:'text',text:'Look at this chart'},{type:'image_url',image_url:{url:`data:image/png;base64,${png.toString('base64')}`}}]}]);
  expect(stored()).toBe(1);
 } finally { await fake.close(); }
});
