import { test, expect, type Page, type Request } from './fresh-seed';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';

const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
// Omar signs in as the Owner of RS Learning, who connects and attaches its agents.
async function ownerSignIn(page:Page) {
 query(`update public.people set language='en' where id='20000000-0000-0000-0000-000000000001'`);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
}

const company='10000000-0000-0000-0000-000000000001';
const other='10000000-0000-0000-0000-000000000002';
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

test('The Owner starts a private conversation from the board and from Home, and the reply arrives without a reload',async({page})=>{
 test.setTimeout(120000);
 const fake=await fakeHermes(); fake.settings.key=`hermes-key-${randomUUID()}`; fake.settings.pendingReads=2;
 let agents={};
 const responses:Promise<string>[]=[];
 try {
  await ownerSignIn(page); agents=await attachAgents(page,fake);
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

test('isolation: another member and another company get not found, and a company Owner cannot read or write in another person\'s conversation',async({page,browser})=>{
 test.setTimeout(120000);
 const fake=await fakeHermes(); let agents={};
 try {
  await ownerSignIn(page); agents=await attachAgents(page,fake);
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

// #287: a Contributor talks to the company's agent, whose Connection the company's Owner attached.
test('A Contributor starts a conversation and gets the reply; nobody else reads it',async({page,browser})=>{
 test.setTimeout(120000);
 const fake=await fakeHermes(); fake.settings.key=`hermes-key-${randomUUID()}`; let agents={};
 const contributor='20000000-0000-0000-0000-000000000005';
 query(`update public.members set role='contributor' where company_id='${company}' and person_id='${contributor}'`);
 try {
  await ownerSignIn(page); agents=await attachAgents(page,fake);
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
   // The company's Owner (Omar here) cannot read it.
   expect((await page.request.get(`/api/conversations?company=${company}&conversation=${conversation}`)).status()).toBe(404);
   expect((await page.goto(`/c/rs-learning/conversations/${conversation}`))!.status()).toBe(404);
  } finally { await context.close(); }
 } finally { query(`update public.members set role='contributor' where company_id='${company}' and person_id='${contributor}'`); detach(agents); await fake.close(); }
});

test('A Viewer has no composer and the server refuses their message',async({page,browser})=>{
 test.setTimeout(120000);
 const fake=await fakeHermes(); let agents={};
 try {
  await ownerSignIn(page); agents=await attachAgents(page,fake);
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
