import { test, expect, type Page, type Request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { signIn } from './sign-in';
import { createClient } from '@supabase/supabase-js';
import { closeOpenRuns } from '../lib/conversation-runs.mjs';

const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
function totp(secret:string) {
 const bits=[...secret.toUpperCase()].map(character=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character).toString(2).padStart(5,'0')).join('');
 const key=Buffer.from(bits.match(/.{8}/g)!.map(byte=>parseInt(byte,2)));
 const counter=Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac('sha1',key).update(counter).digest();
 return String((digest.readUInt32BE(digest[19]&15)&0x7fffffff)%1000000).padStart(6,'0');
}
// Omar signs in and enrols an authenticator, so the session has Agency access (two-step verified).
async function agencySignIn(page:Page) {
 query(`delete from auth.mfa_factors where user_id='20000000-0000-0000-0000-000000000001'`);
 query(`update public.people set language='en' where id='20000000-0000-0000-0000-000000000001'`);
 await signIn(page,'omar@example.com','/all-brands');
 await page.getByRole('button',{name:'Set up authenticator'}).click();
 await page.getByLabel('Verification code').fill(totp((await page.locator('code').textContent())!));
 await page.getByRole('button',{name:'Verify',exact:true}).click();
 await expect(page.locator('.company-card')).toHaveCount(3);
}

const company='10000000-0000-0000-0000-000000000001';
const other='10000000-0000-0000-0000-000000000002';
const omar='20000000-0000-0000-0000-000000000001';
const manager='20000000-0000-0000-0000-000000000002';
type Fake=Awaited<ReturnType<typeof fakeHermes>>;

// Two agents on two Hermes profiles of one fake Hermes: Mona is the company's default.
async function attachAgents(page:Page,fake:Fake) {
 const stamp=randomUUID().slice(0,8); const agents:Record<string,{id:string,profile:string,connection:string}>={};
 for(const [name,makeDefault] of [['Mona',true],['Nour',false]] as const) {
  const profile=`${name.toLowerCase()}-${stamp}`;
  const saved=await page.request.post('/api/hermes-connections',{data:{company,intent:'save',address:fake.address,profile,key:fake.settings.key}});
  expect(saved.status()).toBe(200); const connection=(await saved.json()).connection.id;
  const attached=await page.request.post('/api/hermes-agents',{data:{company,intent:'attach',connection,name,speciality:'Marketing',makeDefault}});
  expect(attached.status()).toBe(200);
  agents[name]={id:(await attached.json()).agents.find((agent:{connection_id:string})=>agent.connection_id===connection).id,profile,connection};
 }
 return agents;
}
function detach(agents:Record<string,{id:string,connection:string}>) {
 const list=(key:'id'|'connection')=>Object.values(agents).map(agent=>`'${agent[key]}'`).join(',');
 if(!Object.keys(agents).length) return;
 query(`delete from public.hermes_agents where id in (${list('id')})`);
 query(`delete from public.hermes_connections where id in (${list('connection')})`);
}
// A stuck click fails with its locator instead of running into the test timeout.
test.use({actionTimeout:15000});
const send=(page:Page,data:object)=>page.request.post('/api/conversations',{data:{company,...data}});

test('An Agency person starts a private conversation from the board and from Home, and the reply arrives without a reload',async({page})=>{
 test.setTimeout(120000);
 const fake=await fakeHermes(); fake.settings.key=`hermes-key-${randomUUID()}`; fake.settings.pendingReads=2;
 let agents={};
 const responses:Promise<string>[]=[];
 try {
  await agencySignIn(page); agents=await attachAgents(page,fake);
  const {Nour,Mona}=agents as Record<string,{profile:string}>;
  // Only finished requests: a still-open stream (the dev server's or a prefetch) has no complete body to read.
  const record=(request:Request)=>{responses.push(request.response().then(response=>response?response.text():'').catch(()=>''));};
  page.on('requestfinished',record);
  await page.goto('/c/rs-learning/work/board');
  await page.locator('.nav').getByRole('button',{name:'New',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'New conversation'});
  await expect(dialog.getByRole('button',{name:'Agent',exact:true})).toContainText('Mona');
  await dialog.getByRole('button',{name:'Agent',exact:true}).click();
  await page.getByRole('menuitemradio').filter({hasText:'Nour'}).click();
  const text=`Plan the launch week خطة الإطلاق ${Date.now()}`;
  await dialog.getByLabel('Message',{exact:true}).fill(text);
  await page.evaluate(()=>{(window as unknown as {stayed:boolean}).stayed=true;});
  await dialog.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
  const conversation=page.url().split('/').pop()!;
  await expect(page.locator('.msg[data-author=person]')).toHaveText(new RegExp(text));
  await expect(page.locator('.msg[data-author=agent]')).toContainText(`Reply to: ${text}`);
  expect(await page.evaluate(()=>(window as unknown as {stayed?:boolean}).stayed)).toBe(true);
  const runs=fake.settings.requests.filter(request=>request.method==='POST'&&request.path?.endsWith('/v1/runs'));
  expect(runs.map(request=>[request.path,request.session])).toEqual([[`/p/${Nour.profile}/v1/runs`,conversation]]);

  await page.goto('/c/rs-learning/home');
  await page.locator('.nav').getByRole('button',{name:'New',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'New conversation'}).getByRole('button',{name:'Agent',exact:true})).toContainText('Mona');
  await page.getByRole('dialog').getByLabel('Message',{exact:true}).fill('From Home');
  await page.getByRole('dialog').getByLabel('Message',{exact:true}).press('Enter');
  await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]{36}$/);
  await expect(page.locator('.msg[data-author=person]')).toContainText('From Home');
  await expect(page.locator('.msg[data-author=agent]')).toContainText('Reply to: From Home');
  expect(fake.settings.runs.at(-1)!.session).toBe(page.url().split('/').pop());
  expect(fake.settings.requests.filter(request=>request.method==='POST').at(-1)!.path).toBe(`/p/${Mona.profile}/v1/runs`);
  // The Hermes key never reaches the browser: no response while sending carries it.
  page.off('requestfinished',record);
  const bodies=await Promise.all(responses);
  expect(bodies.length).toBeGreaterThan(5);
  expect(bodies.filter(body=>body.includes(fake.settings.key))).toEqual([]);
 } finally { detach(agents); await fake.close(); }
});

test('integration: the same send runs once, and the record is append-only and names who wrote each message',async({page})=>{
 const fake=await fakeHermes(); let agents={};
 try {
  await agencySignIn(page); agents=await attachAgents(page,fake);
  const {Mona}=agents as Record<string,{id:string,profile:string}>;
  const conversation=randomUUID(); const message={conversation,agent:Mona.id,message:'Write the teaser',sendKey:randomUUID()};
  expect((await send(page,message)).status()).toBe(200);
  expect((await send(page,message)).status()).toBe(200);
  expect(fake.settings.requests.filter(request=>request.method==='POST'&&request.path===`/p/${Mona.profile}/v1/runs`)).toHaveLength(1);
  expect(fake.settings.runs).toHaveLength(1);
  expect(fake.settings.runs[0]).toMatchObject({session:conversation,input:'Write the teaser'});
  // The worker may already have stored the reply (#243): the repeated send stored one person's message.
  expect(JSON.parse(query(`select count(*)::int as n from public.conversation_messages where conversation_id='${conversation}' and author='person'`))[0].n).toBe(1);
  const read=await page.request.get(`/api/conversations?company=${company}&conversation=${conversation}`);
  expect((await read.json()).messages.map((row:{author:string,body:string})=>[row.author,row.body])).toEqual([['person','Write the teaser'],['agent','Reply to: Write the teaser']]);
  const rows=JSON.parse(query(`select author,person_id,author_name from public.conversation_messages where conversation_id='${conversation}' order by id`));
  expect(rows).toEqual([{author:'person',person_id:omar,author_name:'عمر'},{author:'agent',person_id:null,author_name:'Mona'}]);
  for(const change of [`update public.conversation_messages set body='changed' where conversation_id='${conversation}'`,`delete from public.conversation_messages where conversation_id='${conversation}'`]) {
   let refused='';
   try { query(change); } catch(error) { refused=String((error as {stderr?:string}).stderr)+String(error); }
   expect(refused).toContain('conversationAppendOnly');
  }
  expect(JSON.parse(query(`select count(*)::int as n from public.conversation_messages where conversation_id='${conversation}' and body<>'changed'`))[0].n).toBe(2);
 } finally { detach(agents); await fake.close(); }
});

test('isolation: another member and another company get not found, and a company Owner cannot start a conversation',async({page,browser})=>{
 test.setTimeout(120000);
 const fake=await fakeHermes(); let agents={};
 try {
  await agencySignIn(page); agents=await attachAgents(page,fake);
  const conversation=randomUUID();
  expect((await send(page,{conversation,message:'Private plan',sendKey:randomUUID()})).status()).toBe(200);
  expect((await page.request.get(`/api/conversations?company=${other}&conversation=${conversation}`)).status()).toBe(404);
  expect((await page.goto(`/c/rs-consultations/conversations/${conversation}`))!.status()).toBe(404);
  expect((await send(page,{company:other,conversation,message:'Elsewhere',sendKey:randomUUID()})).status()).toBe(404);
  query(`update public.members set role='owner' where company_id='${company}' and person_id='${manager}'`);
  const context=await browser.newContext(); const owner=await context.newPage();
  try {
   await signIn(owner,'manager@example.com','/c/rs-learning/home');
   expect((await owner.request.get(`/api/conversations?company=${company}&conversation=${conversation}`)).status()).toBe(404);
   expect((await owner.goto(`/c/rs-learning/conversations/${conversation}`))!.status()).toBe(404);
   const refused=await send(owner,{conversation:randomUUID(),message:'Hello',sendKey:randomUUID()});
   expect(refused.status()).toBe(403); expect((await refused.json()).error).toBe('conversationAgencyOnly');
   expect((await send(owner,{conversation,message:'Hello',sendKey:randomUUID()})).status()).toBe(403);
   await owner.goto('/c/rs-learning/home');
   await owner.locator('.nav').getByRole('button',{name:'New',exact:true}).click();
   const dialog=owner.getByRole('dialog',{name:'New conversation'});
   await expect(dialog.getByRole('note')).toContainText('Only Agency people can chat with agents for now.');
   await expect(dialog.getByLabel('Message',{exact:true})).toHaveCount(0);
  } finally { await context.close(); query(`update public.members set role='manager' where company_id='${company}' and person_id='${manager}'`); }
  expect(fake.settings.runs).toHaveLength(1);
 } finally { detach(agents); await fake.close(); }
});

// The reconciler as the worker runs it, with the local stack's service key (scripts/web.sh reads it the same way).
function reconciler() {
 const status=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'});
 const value=(name:string)=>status.match(new RegExp(`^${name}="(.*)"$`,'m'))![1];
 const db=createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),{auth:{persistSession:false}});
 return (conversation:string)=>closeOpenRuns(db,{encryptionKey:process.env.WEBHOOK_ENCRYPTION_KEY||'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',conversation});
}
const agentRows=(conversation:string)=>JSON.parse(query(`select body from public.conversation_messages where conversation_id='${conversation}' and author='agent' order by id`));
const usageRows=(conversation:string)=>JSON.parse(query(`select outcome,input_tokens,output_tokens from public.conversation_usage where conversation_id='${conversation}' order by run_id`));

test('Closing the page mid-reply and reopening the conversation shows the complete reply',async({page,context})=>{
 test.setTimeout(120000);
 const fake=await fakeHermes(); fake.settings.key=`hermes-key-${randomUUID()}`; fake.settings.pendingReads=1e9; let agents={};
 try {
  await agencySignIn(page); agents=await attachAgents(page,fake);
  await page.goto('/c/rs-learning/home');
  await page.locator('.nav').getByRole('button',{name:'New',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'New conversation'});
  await dialog.getByLabel('Message',{exact:true}).fill('Draft the long launch plan');
  await dialog.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]{36}$/);
  const address=page.url(); const conversation=address.split('/').pop()!;
  await expect(page.locator('.convo-status')).toContainText('Mona is working on a reply');
  await page.close();
  // Hermes finishes while no page is open: gtmworks's worker collects the reply by itself.
  fake.settings.pendingReads=0;
  await expect.poll(()=>agentRows(conversation),{timeout:30000}).toEqual([{body:'Reply to: Draft the long launch plan'}]);
  // The worker records the run's usage with its reply (#245).
  expect(usageRows(conversation)).toEqual([{outcome:'completed',input_tokens:14000,output_tokens:12}]);
  const again=await context.newPage(); await again.goto(address);
  await expect(again.locator('.msg[data-author=agent]')).toHaveText(/Reply to: Draft the long launch plan/);
  await expect(again.locator('.convo-status')).toHaveCount(0);
 } finally { detach(agents); await fake.close(); }
});

test('integration: after gtmworks restarts during a run, the reconciler completes the record from Hermes once',async({page})=>{
 const fake=await fakeHermes(); fake.settings.pendingReads=1e9; let agents={};
 try {
  await agencySignIn(page); agents=await attachAgents(page,fake);
  const conversation=randomUUID(); const reconcile=reconciler();
  expect((await send(page,{conversation,message:'Write the long report',sendKey:randomUUID()})).status()).toBe(200);
  expect(await reconcile(conversation)).toBe(0);
  // The consumer stops here mid-run: no page reads the conversation. Hermes finishes, gtmworks starts again and
  // the reconciler runs twice (the background worker may also run it at the same moment).
  fake.settings.pendingReads=0;
  const closed=[await reconcile(conversation),await reconcile(conversation)];
  expect(closed[0]).toBeLessThanOrEqual(1); expect(closed[1]).toBe(0);
  expect(agentRows(conversation)).toEqual([{body:'Reply to: Write the long report'}]);
  expect(usageRows(conversation)).toEqual([{outcome:'completed',input_tokens:14000,output_tokens:12}]);
  const read=await (await page.request.get(`/api/conversations?company=${company}&conversation=${conversation}`)).json();
  expect(read.messages.map((row:{author:string})=>row.author)).toEqual(['person','agent']); expect(read.pending).toBe(false);
 } finally { detach(agents); await fake.close(); }
});

test('integration: a run unknown to Hermes is recorded as lost and the conversation accepts a new message',async({page})=>{
 const fake=await fakeHermes(); fake.settings.pendingReads=1e9; let agents={};
 try {
  await agencySignIn(page); agents=await attachAgents(page,fake);
  const conversation=randomUUID();
  expect((await send(page,{conversation,message:'First try',sendKey:randomUUID()})).status()).toBe(200);
  // Hermes forgets the run: it now answers not found for it.
  fake.settings.runs[0].id='forgotten-by-hermes';
  const read=async()=>(await (await page.request.get(`/api/conversations?company=${company}&conversation=${conversation}`)).json());
  const lost=await read();
  expect(lost.pending).toBe(false);
  expect(lost.failed).toBe(true);
  expect(lost.messages.map((row:{author:string,lost:boolean})=>[row.author,row.lost])).toEqual([['person',true]]);
  expect(agentRows(conversation)).toEqual([]);
  expect(usageRows(conversation)).toEqual([{outcome:'lost',input_tokens:null,output_tokens:null}]);
  await page.goto(`/c/rs-learning/conversations/${conversation}`);
  await expect(page.locator('[data-outcome=lost]')).toContainText('Lost');
  fake.settings.pendingReads=0;
  expect((await send(page,{conversation,message:'Second try',sendKey:randomUUID()})).status()).toBe(200);
  await expect.poll(async()=>(await read()).messages.at(-1).body).toBe('Reply to: Second try');
  expect(fake.settings.runs).toHaveLength(2);
 } finally { detach(agents); await fake.close(); }
});

test('With Hermes unreachable, sending keeps the text in the composer and says so, and the board and approvals still work',async({page})=>{
 test.setTimeout(120000);
 const fake=await fakeHermes(); let agents={};
 try {
  await agencySignIn(page); agents=await attachAgents(page,fake);
  const conversation=randomUUID();
  expect((await send(page,{conversation,message:'Before the outage',sendKey:randomUUID()})).status()).toBe(200);
  await expect.poll(()=>agentRows(conversation).length,{timeout:30000}).toBe(1);
  await fake.close();
  await page.goto(`/c/rs-learning/conversations/${conversation}`);
  await expect(page.locator('.msg[data-author=agent]')).toContainText('Reply to: Before the outage');
  const box=page.getByLabel('Message',{exact:true});
  await box.fill('Are you there?');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('.composer-error')).toHaveText('The agent engine could not be reached. Your message was not sent; it is still in the box.');
  await expect(box).toHaveValue('Are you there?');
  expect(JSON.parse(query(`select count(*)::int as n from public.conversation_messages where conversation_id='${conversation}' and author='person'`))[0].n).toBe(1);
  await page.goto('/c/rs-learning/work/board');
  await page.locator('.card[data-card-id="1"] a').click();
  await expect(page.locator('.card-stage-line')).toBeVisible();
  await page.goto('/c/rs-learning/approvals');
  await expect(page.locator('.approval-count')).toBeVisible();
  await page.goto('/c/rs-learning/work/calendar');
  await expect(page.locator('.calendar')).toBeVisible();
 } finally { detach(agents); await fake.close(); }
});
