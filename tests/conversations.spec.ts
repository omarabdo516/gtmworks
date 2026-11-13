import { test, expect, type Page, type Request, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { signIn, openNavigation, closeNavigation } from './sign-in';
import { createClient } from '@supabase/supabase-js';
import { closeOpenRuns } from '../lib/conversation-runs.mjs';
import { agentFace } from '../lib/agent-face.mjs';

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
  // Opening an Agent from the sidebar: its tile leads to its empty Conversation.
  await page.locator('.sidebar .agent-tile').filter({hasText:'Nour'}).click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/chat\/[0-9a-f-]{36}$/);
  await expect(page.locator('.chat .empty-chat h2')).toHaveText('Nour');
  const text=`Plan the launch week خطة الإطلاق ${Date.now()}`;
  await page.getByLabel('Message',{exact:true}).fill(text);
  await page.evaluate(()=>{(window as unknown as {stayed:boolean}).stayed=true;});
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
  const conversation=page.url().split('/').pop()!;
  await expect(page.locator('.msg[data-author=person]')).toHaveText(new RegExp(text));
  await expect(page.locator('.msg[data-author=agent]')).toContainText(`Reply to: ${text}`);
  expect(await page.evaluate(()=>(window as unknown as {stayed?:boolean}).stayed)).toBe(true);
  const runs=fake.settings.requests.filter(request=>request.method==='POST'&&request.path?.endsWith('/v1/runs'));
  expect(runs.map(request=>[request.path,request.session])).toEqual([[`/p/${Nour.profile}/v1/runs`,conversation]]);

  await page.goto('/c/rs-learning/home');
  // New chat opens the main Agent (Mona is this company's default).
  await page.locator('.sidebar').getByRole('link',{name:'New chat',exact:true}).click();
  await expect(page.locator('.chat .empty-chat h2')).toContainText('Mona');
  await page.getByLabel('Message',{exact:true}).fill('From Home');
  await page.getByLabel('Message',{exact:true}).press('Enter');
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

test('isolation: another member and another company get not found, and a company Owner cannot read or write in another person\'s conversation',async({page,browser})=>{
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
   const refused=await send(owner,{conversation,message:'Hello',sendKey:randomUUID()});
   expect(refused.status()).toBe(404); expect((await refused.json()).error).toBe('conversationNotFound');
  } finally { await context.close(); query(`update public.members set role='manager' where company_id='${company}' and person_id='${manager}'`); }
  expect(fake.settings.runs).toHaveLength(1);
 } finally { detach(agents); await fake.close(); }
});

// #287: a Contributor (no Agency access) talks to the company's agent, whose Connection an Agency owner attached.
test('A Contributor starts a conversation and gets the reply; nobody else reads it',async({page,browser})=>{
 test.setTimeout(120000);
 const fake=await fakeHermes(); fake.settings.key=`hermes-key-${randomUUID()}`; let agents={};
 const contributor='20000000-0000-0000-0000-000000000005';
 query(`update public.members set role='contributor' where company_id='${company}' and person_id='${contributor}'`);
 try {
  await agencySignIn(page); agents=await attachAgents(page,fake);
  const {Mona}=agents as Record<string,{profile:string}>;
  const context=await browser.newContext(); const member=await context.newPage();
  try {
   await signIn(member,'multi@example.com','/c/rs-learning/home');
   await member.locator('.sidebar').getByRole('link',{name:'New chat',exact:true}).click();
   await expect(member.locator('.chat .empty-chat h2')).toContainText('Mona');
   const text=`Draft the course teaser ${Date.now()}`;
   await member.getByLabel('Message',{exact:true}).fill(text);
   await member.getByRole('button',{name:'Send',exact:true}).click();
   await expect(member).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
   const conversation=member.url().split('/').pop()!;
   await expect(member.locator('.msg[data-author=person]')).toContainText(text);
   await expect(member.locator('.msg[data-author=agent]')).toContainText(`Reply to: ${text}`);
   await expect(member.getByLabel('Message',{exact:true})).toBeVisible();
   expect(fake.settings.runs.map(run=>run.session)).toEqual([conversation]);
   expect(fake.settings.requests.filter(request=>request.method==='POST').at(-1)!.path).toBe(`/p/${Mona.profile}/v1/runs`);
   // The company's Owner (Omar here, with Agency access too) cannot read it.
   expect((await page.request.get(`/api/conversations?company=${company}&conversation=${conversation}`)).status()).toBe(404);
   expect((await page.goto(`/c/rs-learning/conversations/${conversation}`))!.status()).toBe(404);
  } finally { await context.close(); }
 } finally { query(`update public.members set role='reviewer' where company_id='${company}' and person_id='${contributor}'`); detach(agents); await fake.close(); }
});

test('A Viewer has no composer and the server refuses their message',async({page,browser})=>{
 test.setTimeout(120000);
 const fake=await fakeHermes(); let agents={};
 try {
  await agencySignIn(page); agents=await attachAgents(page,fake);
  const context=await browser.newContext(); const viewer=await context.newPage();
  try {
   await signIn(viewer,'viewer@example.com','/c/rs-learning/home');
   await viewer.locator('.sidebar').getByRole('link',{name:'New chat',exact:true}).click();
   const chat=viewer.locator('.chat');
   await expect(chat.locator('.ro-line')).toHaveText('Your account is view-only: you read without writing or approving, and you can’t ask for a new agent.');
   await expect(chat.getByLabel('Message',{exact:true})).toHaveCount(0);
   await expect(chat.getByRole('button',{name:'Send',exact:true})).toHaveCount(0);
   const refused=await send(viewer,{conversation:randomUUID(),message:'Hello',sendKey:randomUUID()});
   expect(refused.status()).toBe(403); expect((await refused.json()).error).toBe('conversationNotAllowed');
  } finally { await context.close(); }
  expect(fake.settings.runs).toHaveLength(0);
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
  await page.locator('.sidebar').getByRole('link',{name:'New chat',exact:true}).click();
  await page.getByLabel('Message',{exact:true}).fill('Draft the long launch plan');
  await page.getByRole('button',{name:'Send',exact:true}).click();
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

// #8: the shell and the Agent Conversation as in the approved reference (design-reference/), in both languages.
const omarSetting=(column:'theme'|'language',value:string)=>query(`update public.people set ${column}='${value}' where id='${omar}'`);
async function noSideScroll(page:Page,where:string) {
 const [scroll,inner]=await page.evaluate(()=>[document.documentElement.scrollWidth,window.innerWidth]);
 expect(scroll,`${where}: page width`).toBe(inner);
}

test('the shell opens an Agent, sends a message, switches language and theme, and keeps direction and width',async({page})=>{
 test.setTimeout(240000);
 const fake=await fakeHermes(); let agents={};
 try {
  await agencySignIn(page); agents=await attachAgents(page,fake);
  omarSetting('theme','light');
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/c/rs-learning/home');
  // Lead, the main Agent (the company's default), comes first and carries its mark.
  const tiles=page.locator('.sidebar .agent-tile:not(.agent-tile--new)');
  await expect(tiles.first()).toContainText('Mona');
  await expect(tiles.first().locator('.agent-tile__main')).toHaveText('Main');
  await expect(tiles.filter({hasText:'Nour'}).locator('.agent-tile__main')).toHaveCount(0);
  // Open an Agent: its tile is current and the screen is its empty Conversation.
  await tiles.filter({hasText:'Nour'}).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(tiles.filter({hasText:'Nour'})).toHaveAttribute('aria-current','true');
  await expect(page.locator('.sidebar .sb-nav a[aria-current=page]')).toHaveText('Chats');
  await expect(page.locator('.chat .head-pill')).toHaveText('New chat');
  await expect(page.getByLabel('Message',{exact:true})).toHaveAttribute('placeholder','Write to Nour…');
  // Send a message that mixes Arabic and English: it keeps its own direction inside the English shell.
  const mixed=`خطة إطلاق الكورس for the Meta campaign ${Date.now()}`;
  await page.getByLabel('Message',{exact:true}).fill(mixed);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]{36}$/);
  const conversation=page.url().split('/').pop()!;
  const mine=page.locator('.msg[data-author=person] .bubble');
  await expect(mine).toHaveText(mixed);
  await expect(page.locator('.msg[data-author=agent] .bubble')).toContainText(`Reply to: ${mixed}`);
  await expect(page.locator('html')).toHaveAttribute('dir','ltr');
  await expect(page.locator('.sidebar')).toHaveCSS('direction','ltr');
  await expect(mine).toHaveCSS('direction','rtl');
  await expect(page.locator('.chat .head-pill__title')).toHaveCSS('direction','rtl');
  // The person's turn sits on the end side of the column, the Agent's on the start side.
  const sides=()=>page.evaluate(()=>{
   const box=(selector:string)=>document.querySelector(selector)!.getBoundingClientRect();
   const column=box('.transcript__col');
   return {personRight:Math.round(box('.msg[data-author=person] .bubble').right),personLeft:Math.round(box('.msg[data-author=person] .bubble').left),agentLeft:Math.round(box('.msg[data-author=agent] .bubble').left),agentRight:Math.round(box('.msg[data-author=agent] .bubble').right),columnLeft:Math.round(column.left),columnRight:Math.round(column.right)};
  });
  let at=await sides();
  expect([at.personRight,at.agentLeft]).toEqual([at.columnRight,at.columnLeft]);
  // The new chat is the newest recent chat and is marked current.
  const recent=page.locator(`.sidebar .thread-item[href$="/conversations/${conversation}"]`);
  await expect(recent).toHaveAttribute('aria-current','true');
  await expect(recent.locator('.od-truncate')).toHaveText(mixed);
  await noSideScroll(page,'chat en 1440');
  // Switch theme: the sun/moon button flips light and dark, and the account keeps the choice.
  await expect(page.locator('.chat')).toHaveCSS('background-color','rgb(252, 252, 252)');
  await expect(page.locator('#btn-theme')).toHaveAccessibleName('Dark mode');
  await page.locator('#btn-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('.chat')).toHaveCSS('background-color','rgb(18, 18, 18)');
  await expect(page.locator('.sidebar')).toHaveCSS('background-color','rgb(14, 14, 14)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('#btn-theme')).toHaveAccessibleName('Light mode');
  await page.locator('#btn-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  // Switch language from the account menu: the shell turns right to left, the message keeps its own direction.
  await page.getByRole('button',{name:'Account menu',exact:true}).click();
  await expect(page.getByRole('menuitemradio').filter({hasText:'English'})).toHaveAttribute('aria-checked','true');
  await page.getByRole('menuitemradio').filter({hasText:'العربية'}).click();
  await expect(page.locator('html')).toHaveAttribute('lang','ar');
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  await expect(page.locator('.sidebar')).toHaveCSS('direction','rtl');
  await expect(page.locator('.sidebar .sb-nav .sb-item').first()).toHaveText('المحادثات');
  await expect(page.getByLabel('الرسالة',{exact:true})).toHaveAttribute('placeholder','اكتب لـ Nour…');
  await expect(mine).toHaveCSS('direction','rtl');
  expect((await page.locator('.sidebar').boundingBox())!.x).toBe(1440-300);
  at=await sides();
  expect([at.personLeft,at.agentRight]).toEqual([at.columnLeft,at.columnRight]);
  // An English message keeps left to right inside the Arabic shell.
  const english=`Plan the launch week ${Date.now()}`;
  await page.getByLabel('الرسالة',{exact:true}).fill(english);
  await page.getByRole('button',{name:'ابعت',exact:true}).click();
  await expect(page.locator('.msg[data-author=person] .bubble').last()).toHaveText(english);
  await expect(page.locator('.msg[data-author=person] .bubble').last()).toHaveCSS('direction','ltr');
  // No sideways scroll at 1440 and at a phone width, in both languages, with the drawer closed and open.
  for(const language of ['ar','en'] as const) {
   if(language==='en') {
    await page.setViewportSize({width:1440,height:900});
    // The page is still in Arabic here, so the account button carries its Arabic label.
    await page.getByRole('button',{name:'قائمة الحساب',exact:true}).click();
    await page.getByRole('menuitemradio').filter({hasText:'English'}).click();
    await expect(page.locator('html')).toHaveAttribute('lang','en');
   }
   for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    for(const path of [`/c/rs-learning/conversations/${conversation}`,'/c/rs-learning/chat','/c/rs-learning/work/board']) {
     await page.goto(path);
     await expect(page.locator('html')).toHaveAttribute('lang',language);
     await noSideScroll(page,`${path} ${language} ${width}`);
     await openNavigation(page);
     await noSideScroll(page,`${path} ${language} ${width} with the sidebar open`);
     await closeNavigation(page);
    }
   }
  }
  // Collapse on a narrow screen: the sidebar hides behind the menu button, and an Agent opens from the drawer.
  await page.setViewportSize({width:390,height:900});
  await page.goto('/c/rs-learning/work/board');
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.locator('.mobile-menu').click();
  await page.locator('.sidebar .agent-tile').filter({hasText:'Mona'}).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.topbar')).toHaveText('Chats');
  await expect(page.getByLabel('Message',{exact:true})).toBeVisible();
  // On a phone the send arrow keeps the reference's 28px circle, and a tap anywhere in the 44px square around it sends.
  const send=page.locator('.composer__send');
  const circle=(await send.boundingBox())!;
  expect([circle.width,circle.height]).toEqual([28,28]);
  const misses=await send.evaluate(node=>{
   const box=node.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2;
   return [[-21,-21],[0,-21],[21,-21],[-21,0],[21,0],[-21,21],[0,21],[21,21]]
    .filter(([dx,dy])=>!document.elementFromPoint(x+dx,y+dy)?.closest('.composer__send'))
    .map(point=>point.join(','));
  });
  expect(misses,'taps inside the 44px square that miss the send button').toEqual([]);
 } finally { omarSetting('theme','device'); omarSetting('language','en'); detach(agents); await fake.close(); }
});

// The Mona/Nour fixture (Mona the main Agent): each real Agent keeps one identity (name, face, colour) in the
// sidebar's grid, on the Agents page, in its empty chat and in a Conversation with it, and the grid lists the main
// Agent first, on a desktop and on a phone. Home's four role agents are another population (frame.spec.ts).
for(const width of [1440,390]) test(`a real Agent keeps one identity across the sidebar, the Agents page and its Conversation at ${width}px`,async({page})=>{
 test.setTimeout(180000);
 const fake=await fakeHermes(); let agents={};
 try {
  await agencySignIn(page); agents=await attachAgents(page,fake);
  const fixture=agents as Record<'Mona'|'Nour',{id:string,connection:string}>;
  await page.setViewportSize({width,height:900});
  const face=(svg:Locator)=>svg.evaluate(node=>({icon:node.innerHTML,color:node.querySelector(':scope > g')?.getAttribute('fill')}));
  await page.goto('/c/rs-learning/home');
  await openNavigation(page);
  const tiles=page.locator('.sidebar .agent-tile:not(.agent-tile--new)');
  // Main first: Mona leads the grid with its mark, whatever the name order.
  await expect(tiles.locator('bdi')).toHaveText(['Mona','Nour']);
  await expect(tiles.first()).toHaveAccessibleName('Mona · Main');
  await expect(tiles.first().locator('.agent-tile__main')).toHaveText('Main');
  await expect(tiles.nth(1)).toHaveAccessibleName('Nour');
  await expect(tiles.nth(1).locator('.agent-tile__main')).toHaveCount(0);
  expect(await tiles.evaluateAll(links=>links.map(link=>link.getAttribute('href')))).toEqual([`/c/rs-learning/chat/${fixture.Mona.id}`,`/c/rs-learning/chat/${fixture.Nour.id}`]);
  const shown={Mona:await face(tiles.first().locator('.agent-face')),Nour:await face(tiles.nth(1).locator('.agent-face'))};
  await closeNavigation(page);
  for(const agent of Object.values(shown)) { expect(agent.icon).toBeTruthy(); expect(agent.color).toBeTruthy(); }
  // Two Agents look different exactly when their connections draw different faces (a random pair can rarely match).
  expect(shown.Mona.icon!==shown.Nour.icon).toBe(JSON.stringify(agentFace(fixture.Mona.connection))!==JSON.stringify(agentFace(fixture.Nour.connection)));
  // The Agents page shows the same face and colour for each, and marks the same one as the default.
  await page.goto('/c/rs-learning/agents');
  for(const name of ['Mona','Nour'] as const) {
   const row=page.locator('.company-hermes-agents .detail-row').filter({has:page.locator('strong').getByText(name,{exact:true})});
   await expect(row).toHaveCount(1);
   expect(await face(row.locator('.agent-face')),`${name}: Agents page`).toEqual(shown[name]);
   await expect(row.getByText('Default agent',{exact:true})).toHaveCount(name==='Mona'?1:0);
  }
  // Each opens from the grid into its own empty chat and then a Conversation, wearing the same face throughout.
  for(const name of ['Mona','Nour'] as const) {
   await openNavigation(page);
   await tiles.filter({hasText:name}).click();
   await expect(page).toHaveURL(new RegExp(`/chat/${fixture[name].id}$`));
   await expect(page.locator('.chat .empty-chat h2 bdi')).toHaveText(name);
   expect(await face(page.locator('.chat .empty-chat__faces .agent-face')),`${name}: empty chat`).toEqual(shown[name]);
   expect(await face(page.locator('.chat .head-pill .agent-face')),`${name}: empty chat title`).toEqual(shown[name]);
   const text=`Identity check for ${name} ${Date.now()}`;
   await page.getByLabel('Message',{exact:true}).fill(text);
   await page.getByRole('button',{name:'Send',exact:true}).click();
   await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]{36}$/);
   const reply=page.locator('.msg[data-author=agent]');
   await expect(reply.locator('.bubble')).toContainText(`Reply to: ${text}`);
   await expect(reply.locator('.sender bdi')).toHaveText(name);
   expect(await face(page.locator('.chat .head-pill .agent-face')),`${name}: Conversation title`).toEqual(shown[name]);
   expect(await face(reply.locator('.sender .agent-face')),`${name}: Conversation reply`).toEqual(shown[name]);
  }
 } finally { detach(agents); await fake.close(); }
});
