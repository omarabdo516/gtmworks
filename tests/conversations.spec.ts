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
  await expect(page.locator('.sidebar #btn-apps')).toHaveAttribute('aria-disabled','true');
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

const agentRows=(conversation:string)=>JSON.parse(query(`select body from public.conversation_messages where conversation_id='${conversation}' and author='agent' order by id`));
const usageRows=(conversation:string)=>JSON.parse(query(`select outcome,input_tokens,output_tokens from public.conversation_usage where conversation_id='${conversation}' order by run_id`));

test('integration: a run unknown to Hermes is recorded as lost and the conversation accepts a new message',async({page})=>{
 const fake=await fakeHermes(); fake.settings.pendingReads=1e9; let agents={};
 try {
  await ownerSignIn(page); agents=await attachAgents(page,fake);
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

// #145: a Card with an Agent and no chat is where its chat starts. The Contributor who writes from its sheet owns the
// chat, which is the same in Chats; the Card moves from Ideas to In progress with its log row and stays the only one.
// The Owner and another Contributor get the lock and the Log, and no message of the chat reaches their page; a Viewer
// gets no composer and the view-only line.
test('A Contributor starts a Card\'s chat from its sheet; the Owner, another Contributor and a Viewer get the lock and no message',async({page,browser})=>{
 test.setTimeout(240000);
 const fake=await fakeHermes(); let agents={};
 const reviewer='20000000-0000-0000-0000-000000000003';
 const people=`'${reviewer}','20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000005'`;
 query(`update public.people set language='en' where id in (${people})`);
 const member=async(email:string,path:string)=>{ const context=await browser.newContext(); const opened=await context.newPage(); await signIn(opened,email,path); return {context,page:opened}; };
 try {
  await ownerSignIn(page); agents=await attachAgents(page,fake);
  const {Nour}=agents as Record<string,{id:string,profile:string}>;
  query(`insert into public.member_agent_access(company_id,person_id,agent_id) select company_id,person_id,'${Nour.id}' from public.members where company_id='${company}' and removed_at is null and role<>'owner' on conflict do nothing`);
  const [{id:card}]=JSON.parse(query(`insert into public.work_cards(company_id,stage_id,title,agent_id) select '${company}',id,'Ideas for the June course','${Nour.id}' from public.work_stages where company_id='${company}' and board_column='ideas' order by position,id limit 1 returning id`)) as {id:number}[];
  const sheetPath=`/c/rs-learning/work/board?card=${card}`;
  const chatTab=(on:Page)=>on.locator('.sheet').getByRole('tab',{name:'Chat'}), logTab=(on:Page)=>on.locator('.sheet #sh-tab-log');

  const viewer=await member('viewer@example.com',sheetPath);
  try {
   const sheet=viewer.page.locator('.sheet[open]');
   await expect(chatTab(viewer.page)).toHaveAttribute('aria-selected','true');
   await expect(sheet.getByRole('heading',{name:'No chat on this card yet'})).toBeVisible();
   await expect(sheet.getByLabel('Message',{exact:true})).toHaveCount(0);
   await expect(sheet.locator('.ro-line')).toHaveText('Your account is view-only: you can read everything you’re allowed to, without writing, approving or changing anything.');
  } finally { await viewer.context.close(); }

  const text=`Plan three posts for the course ${Date.now()}`;
  const writer=await member('reviewer@example.com',sheetPath);
  let conversation='';
  try {
   const sheet=writer.page.locator('.sheet[open]');
   await expect(chatTab(writer.page)).toHaveAttribute('aria-selected','true');
   await expect(sheet.getByText('Write to Nour below and it’ll start working on it and keep the card updated.')).toBeVisible();
   await sheet.getByLabel('Message',{exact:true}).fill(text);
   await sheet.getByLabel('Message',{exact:true}).press('Enter');
   await expect(sheet.locator('.msg[data-author=person]')).toContainText(text);
   await expect(sheet.locator('.msg[data-author=agent]')).toContainText(`Reply to: ${text}`);
   const chats=sheet.getByRole('link',{name:'Open in Chats'});
   await expect(chats).toHaveAttribute('href',/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
   conversation=(await chats.getAttribute('href'))!.split('/').pop()!;
   expect(fake.settings.runs.map(run=>run.session)).toEqual([conversation]);
   expect(fake.settings.requests.filter(request=>request.method==='POST').at(-1)!.path).toBe(`/p/${Nour.profile}/v1/runs`);
   await chats.click();
   await expect(writer.page).toHaveURL(new RegExp(`/c/rs-learning/conversations/${conversation}$`));
   await expect(writer.page.locator('.chat .msg[data-author=person]')).toContainText(text);
   await expect(writer.page.locator('.chat .msg[data-author=agent]')).toContainText(`Reply to: ${text}`);
  } finally { await writer.context.close(); }
  expect(JSON.parse(query(`select (select count(*) from public.conversations where person_id='${reviewer}' and agent_id='${Nour.id}')::int as chats,
   (select count(*) from public.work_cards where conversation_id='${conversation}')::int as cards,(select count(*) from public.work_cards where title='Ideas for the June course')::int as titled,
   (select s.board_column from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.id=${card}) as board_column`))).toEqual([{chats:1,cards:1,titled:1,board_column:'progress'}]);
  expect(JSON.parse(query(`select action,actor_id,details->>'field' as field from public.company_log where card_id=${card} and action<>'card_created' order by id`))).toEqual([{action:'card_changed',actor_id:reviewer,field:'stage_id'}]);

  const reply=`Reply to: ${text}`;
  const locked=async(on:Page)=>{
   const sheet=on.locator('.sheet[open]');
   await expect(logTab(on)).toHaveAttribute('aria-selected','true');
   await expect(sheet.getByRole('link',{name:'Open in Chats'})).toHaveCount(0);
   await chatTab(on).click();
   await expect(sheet.getByRole('heading',{name:'This chat is between مراجع and Nour only'})).toBeVisible();
   await expect(sheet.getByLabel('Message',{exact:true})).toHaveCount(0);
   expect(await on.content()).not.toContain(text);
   expect(await on.content()).not.toContain(reply);
   await sheet.getByRole('button',{name:'Open the log'}).click();
   await expect(logTab(on)).toHaveAttribute('aria-selected','true');
   await expect(logTab(on)).toBeFocused();
  };
  await page.goto(sheetPath);
  await locked(page);
  const other=await member('multi@example.com',sheetPath);
  try { await locked(other.page); } finally { await other.context.close(); }
  const reader=await member('viewer@example.com',sheetPath);
  try { await locked(reader.page); } finally { await reader.context.close(); }
  expect(fake.settings.runs).toHaveLength(1);
 } finally { detach(agents); await fake.close(); }
});
