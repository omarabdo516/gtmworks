import { test, expect, type Page, type Request } from './fresh-seed';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';
import { idle } from './navigation-measure';
import { asAdmin, holdPages, watchPlaceholders, whileSlow, wholePages } from './slow-reads';

const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
// Omar signs in as the Owner of RS Learning, who connects and attaches its agents.
async function ownerSignIn(page:Page) {
 query(`update public.people set language='en' where id='20000000-0000-0000-0000-000000000001'`);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
}

const company='10000000-0000-0000-0000-000000000001';
const other='10000000-0000-0000-0000-000000000002';
const manager='20000000-0000-0000-0000-000000000002';

// Two agents on two profiles of the lane's fake Hermes, the install's one Hermes (#342): Mona is the company's default.
function attachAgents() {
 const stamp=randomUUID().slice(0,8); const agents:Record<string,{id:string,profile:string,connection:string}>={};
 query(`update public.hermes_agents set is_default=false where company_id='${company}' and is_default`);
 for(const [name,makeDefault] of [['Mona',true],['Nour',false]] as const) {
  const [profile,id,connection]=[`${name.toLowerCase()}-${stamp}`,randomUUID(),randomUUID()];
  query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${id}','${company}','${connection}','${name}','Marketing',${makeDefault},'${profile}')`);
  agents[name]={id,profile,connection};
 }
 return agents;
}
function detach(agents:Record<string,{id:string,connection:string}>) {
 const list=(key:'id'|'connection')=>Object.values(agents).map(agent=>`'${agent[key]}'`).join(',');
 if(!Object.keys(agents).length) return;
 query(`delete from public.hermes_agents where id in (${list('id')})`);
}
// A stuck click fails with its locator instead of running into the test timeout.
test.use({actionTimeout:15000});
// Five minutes of tests in one file held one worker of one shard, longer than any other shard's tests (#653): each test
// signs in, attaches Agents of its own and detaches them, on its lane's own stack, so they spread over the shard's workers.
test.describe.configure({mode:'parallel'});
const send=(page:Page,data:object)=>page.request.post('/api/conversations',{data:{company,...data}});

test('The Owner starts a private conversation from the board and from Home, and the reply arrives without a reload',async({page})=>{
 test.setTimeout(120000);
 const fake=await laneHermes(); fake.settings.pendingReads=2;
 let agents={};
 const responses:Promise<string>[]=[];
 const placeholders=await watchPlaceholders(page);
 await wholePages(page,url=>url.pathname.startsWith('/c/rs-learning/conversations/'));
 try {
  await ownerSignIn(page); agents=attachAgents();
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
  // While the Run is open its Agent's tile thinks; when it ends the face is done for a moment, then idle, its dot too
  // (#184, #697).
  const face=page.locator('.sidebar .agent-tile').filter({hasText:'Nour'}).locator('.fw');
  await expect(face.locator('.face')).toHaveAttribute('data-state','thinking');
  await expect(face.locator('.dot')).toHaveClass('dot dot--thinking');
  await expect(face.locator('.face')).toHaveAttribute('data-state','done');
  await expect(face.locator('.face')).toHaveAttribute('data-state','idle');
  await expect(face.locator('.dot')).toHaveClass('dot dot--idle');
  await expect(page.locator('.msg[data-author=person]')).toHaveText(new RegExp(text));
  await expect(page.locator('.msg[data-author=agent]')).toContainText(`Reply to: ${text}`);
  expect(await page.evaluate(()=>(window as unknown as {stayed?:boolean}).stayed)).toBe(true);
  const runs=fake.settings.requests.filter(request=>request.method==='POST'&&request.path?.endsWith('/v1/runs'));
  expect(runs.map(request=>[request.path,request.session])).toEqual([[`/p/${Nour.profile}/v1/runs`,conversation]]);
  // A chat that arrives whole shows no placeholder (#172): opened, or reached from the sidebar.
  await page.reload();
  await expect(page.locator('.msg[data-author=agent]')).toContainText(`Reply to: ${text}`);
  await page.locator('.nav a[href$="/work/board"]').click();
  await expect(page.locator('.board')).toBeVisible();
  await page.locator(`#sb-recent a[href="/c/rs-learning/conversations/${conversation}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/conversations/${conversation}$`));
  await expect(page.locator('.msg[data-author=agent]')).toContainText(`Reply to: ${text}`);

  await page.goto('/c/rs-learning/home');
  await expect(page.locator('.sidebar #btn-apps')).toHaveAttribute('aria-haspopup','dialog');
  await expect(page.locator('.sidebar #btn-apps'),'Connect apps opens its sheet (#201)').not.toHaveAttribute('aria-disabled');
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
  await expect.poll(placeholders.waiting).toBe(0);
  expect(placeholders.seen()).toEqual([]);
 } finally { detach(agents); await fake.close(); }
});

// The sidebar's Connect apps and the account menu's item open the apps as a sheet over the page (#201); each way out
// gives the keyboard back to what opened it.
test('Connect apps opens its sheet from the sidebar and the account menu, and its close button, Escape and the backdrop each close it back to its opener',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await ownerSignIn(page);
 const sheet=page.locator('dialog.apps-sheet');
 const opened=async(open:()=>Promise<void>)=>{ await open(); await expect(sheet).toBeVisible(); await expect(sheet.locator('#apps-q')).toBeFocused(); };
 const closedTo=async(opener:string)=>{ await expect(sheet).toBeHidden(); await expect(page.locator(opener)).toBeFocused(); };
 const fromSidebar=()=>page.locator('.sidebar #btn-apps').click();
 const fromMenu=async()=>{ await page.locator('.sidebar #btn-me').click(); await page.getByRole('menuitem',{name:/^Connect apps/}).click(); };
 await opened(fromSidebar);
 await sheet.locator('#apps-close').click();
 await closedTo('.sidebar #btn-apps');
 await opened(fromSidebar);
 await page.keyboard.press('Escape');
 await closedTo('.sidebar #btn-apps');
 // The backdrop is the window the sheet leaves uncovered, at the inline start.
 await opened(fromSidebar);
 await page.mouse.click(20,450);
 await closedTo('.sidebar #btn-apps');
 await opened(fromMenu);
 await expect(page.getByRole('menu')).toHaveCount(0);
 await page.keyboard.press('Escape');
 await closedTo('.sidebar #btn-me');
 await opened(fromMenu);
 await sheet.locator('#apps-close').click();
 await closedTo('.sidebar #btn-me');
 await opened(fromMenu);
 await page.mouse.click(20,450);
 await closedTo('.sidebar #btn-me');
 await expect(page).toHaveURL(/\/c\/rs-learning\/home$/);
});

test('isolation: another member and another company get not found, and a company Owner cannot read or write in another person\'s conversation',async({page,browser})=>{
 test.setTimeout(120000);
 const fake=await laneHermes(); let agents={};
 try {
  await ownerSignIn(page); agents=attachAgents();
  const conversation=randomUUID();
  expect((await send(page,{conversation,message:'Private plan',sendKey:randomUUID()})).status()).toBe(200);
  const messages=`intent=read&offset=0&limit=50`;
  expect((await page.request.get(`/api/conversations?company=${company}&conversation=${conversation}&${messages}`)).status(),'its own person reads its messages').toBe(200);
  expect((await page.request.get(`/api/conversations?company=${other}&conversation=${conversation}&${messages}`)).status()).toBe(404);
  expect((await page.request.get(`/api/conversations?company=${other}&conversation=${conversation}`)).status()).toBe(404);
  expect((await page.goto(`/c/rs-consultations/conversations/${conversation}`))!.status()).toBe(404);
  expect((await send(page,{company:other,conversation,message:'Elsewhere',sendKey:randomUUID()})).status()).toBe(404);
  query(`update public.members set role='owner' where company_id='${company}' and person_id='${manager}'`);
  const context=await browser.newContext(); const owner=await context.newPage();
  try {
   await signIn(owner,'manager@example.com','/c/rs-learning/home');
   expect((await owner.request.get(`/api/conversations?company=${company}&conversation=${conversation}&${messages}`)).status()).toBe(404);
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
 const fake=await laneHermes(); let agents={};
 const contributor='20000000-0000-0000-0000-000000000005';
 query(`update public.members set role='contributor' where company_id='${company}' and person_id='${contributor}'`);
 try {
  await ownerSignIn(page); agents=attachAgents();
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
 const fake=await laneHermes(); let agents={};
 try {
  await ownerSignIn(page); agents=attachAgents();
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
const endRows=(conversation:string)=>JSON.parse(query(`select outcome from public.conversation_run_ends where conversation_id='${conversation}' order by run_id`));

test('integration: a run unknown to Hermes is recorded as lost and the conversation accepts a new message',async({page})=>{
 const fake=await laneHermes(); fake.settings.pendingReads=1e9; let agents={};
 try {
  await ownerSignIn(page); agents=attachAgents();
  const conversation=randomUUID();
  expect((await send(page,{conversation,message:'First try',sendKey:randomUUID()})).status()).toBe(200);
  // The message is stored first and its Run starts after the answer (#764).
  await expect.poll(()=>fake.settings.runs.length).toBe(1);
  // Hermes forgets the run: it now answers not found for it.
  fake.settings.runs[0].id='forgotten-by-hermes';
  const read=async()=>(await (await page.request.get(`/api/conversations?company=${company}&conversation=${conversation}`)).json());
  // The worker closes it as lost (#767: a read closes nothing).
  await expect.poll(async()=>(await read()).failed,{timeout:15000}).toBe(true);
  const lost=await read();
  expect(lost.pending).toBe(false);
  expect(lost.failed).toBe(true);
  expect(lost.messages.map((row:{author:string,lost:boolean})=>[row.author,row.lost])).toEqual([['person',true]]);
  expect(agentRows(conversation)).toEqual([]);
  expect(endRows(conversation)).toEqual([{outcome:'lost'}]);
  await page.goto(`/c/rs-learning/conversations/${conversation}`);
  await expect(page.locator('[data-outcome=lost]')).toContainText('Lost');
  fake.settings.pendingReads=0;
  expect((await send(page,{conversation,message:'Second try',sendKey:randomUUID()})).status()).toBe(200);
  await expect.poll(async()=>(await read()).messages.at(-1).body).toBe('Reply to: Second try');
  expect(fake.settings.runs).toHaveLength(2);
 } finally { detach(agents); await fake.close(); }
});

// Omar's Conversation with Ads, six turns long, each with its end, as the engine leaves them; written with triggers off
// and taken away after (#172).
const slowChat=(n:number)=>`6f000000-0000-0000-0000-00000000000${n}`;
const omar='20000000-0000-0000-0000-000000000001';
const slowChatPath=`/c/rs-learning/conversations/${slowChat(3)}`;
const slowChatRows={
 set:`  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,profile) values ('${slowChat(2)}','${company}','${slowChat(1)}','Ads','Runs the ads.','slow-chat');
  insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${slowChat(3)}','${company}','${omar}','${slowChat(2)}','Ads');
  insert into public.conversation_messages(company_id,conversation_id,author,person_id,agent_id,author_name,body,send_key,run_id,created_at)
   select '${company}','${slowChat(3)}',author,case when author='person' then '${omar}'::uuid end,case when author='agent' then '${slowChat(2)}'::uuid end,
    case when author='person' then 'Omar' else 'Ads' end,'Turn '||n||E'\\n'||repeat('About the launch week. ',30),case when author='person' then gen_random_uuid() end,
    'slow-chat-'||n,now()-interval '1 hour'+n*interval '2 minutes'+case when author='agent' then interval '1 minute' else interval '0' end
   from generate_series(1,6) n cross join unnest(array['person','agent']) author;
  insert into public.conversation_run_ends(company_id,conversation_id,run_id,outcome,recorded_at)
   select '${company}','${slowChat(3)}','slow-chat-'||n,'completed',now()-interval '1 hour'+n*interval '2 minutes'+interval '1 minute' from generate_series(1,6) n;`,
 unset:`delete from public.conversation_run_ends where conversation_id='${slowChat(3)}';
  delete from public.conversation_messages where conversation_id='${slowChat(3)}';
  delete from public.conversations where id='${slowChat(3)}';
  delete from public.hermes_agents where id='${slowChat(2)}';`,
};
const where=async(page:Page,selector:string)=>{ const box=(await page.locator(selector).boundingBox())!; return {x:Math.round(box.x),y:Math.round(box.y),width:Math.round(box.width),height:Math.round(box.height)}; };

test('a Conversation whose record is slow shows the placeholder in its transcript, under its title and over its composer, then its messages at the newest',async({page})=>{
 const placeholders=await watchPlaceholders(page);
 // Only the record reads the Run ends (lib/conversation-record.ts); the page's frame and the sidebar never do. Only this
 // chat's record waits: the other chats the sidebar prefetches read theirs at once (tests/slow-reads.ts).
 const held=await holdPages(page,url=>url.pathname===slowChatPath);
 asAdmin(slowChatRows.unset); asAdmin(slowChatRows.set);
 try {
  await ownerSignIn(page);
  const link=page.locator(`#sb-recent a[href="${slowChatPath}"]`);
  await expect(link).toBeVisible();
  await whileSlow('conversation_run_ends',3,async()=>{
   await link.click(); held.letGo();
   const placeholder=page.locator('.chat .transcript[aria-busy="true"]');
   await expect(placeholder).toBeVisible();
   await expect(placeholder).toHaveText('Loading the chat');
   await expect(placeholder.locator('.sk-msg')).toHaveCount(3);
   await expect(page).toHaveURL(new RegExp(`${slowChatPath}$`));
   await expect(page.locator('.sidebar')).toBeVisible();
   await expect(page.locator('.chat .head-pill__title')).toHaveText('Turn 1');
   await expect(page.locator('.chat .composer-area').getByLabel('Message',{exact:true})).toBeVisible();
   const frame=[await where(page,'.chat .transcript'),await where(page,'.chat .composer-area')];
   const messages=page.locator('.chat .turns > .msg');
   await expect(messages).toHaveCount(12);
   await expect(placeholder).toHaveCount(0);
   expect([await where(page,'.chat .transcript'),await where(page,'.chat .composer-area')],'the transcript and the composer keep their places').toEqual(frame);
   const transcript=page.locator('.chat .transcript');
   expect(await transcript.evaluate(box=>box.scrollHeight>box.clientHeight),'the messages are taller than the transcript').toBe(true);
   await expect.poll(()=>transcript.evaluate(box=>box.scrollHeight-box.scrollTop-box.clientHeight)).toBeLessThan(2);
   await expect(messages.last()).toBeInViewport();
  },`conversation_id='${slowChat(3)}'`);
  expect(placeholders.seen()).toEqual(['Loading the chat']);
 } finally { held.letGo(); await held.stop(); asAdmin(slowChatRows.unset); }
});

// An Agent's face is alive (#133, #697): a pressed tile's face hops on the page it opens, a hovered tile and the chat
// head lift their face, and while the Run is held open the chat head's face and the details' face think, then are done.
test('An Agent face hops when its tile is pressed, lifts on hover, and shows its Run thinking and then done',async({page})=>{
 test.setTimeout(120000);
 const fake=await laneHermes();
 let agents={};
 try {
  await ownerSignIn(page); agents=attachAgents();
  await page.goto('/c/rs-learning/work/board');
  const tile=page.locator('.sidebar .agent-tile').filter({hasText:'Nour'});
  const tileFace=tile.locator('.face');
  // The chat a hovered tile leads to is prepared before the press, as navigation.spec.ts opens its pages. The hop carries
  // to that page however long it takes to draw (#529), so a busy runner changes nothing here.
  await tile.hover(); await idle(page);
  // Each hop as it starts, with where its face is; a face that hops twice for one press is counted. A batch of records
  // can hold several changes of one face (a greeting the hop then replaces, #700): each record's new value is the next
  // record's old value for that face, and the face's own value after its last.
  await page.evaluate(()=>{ const hops:string[]=[]; (window as unknown as {hops:string[]}).hops=hops;
   const seen=new Map<Element,number>(); (window as unknown as {twice:()=>number}).twice=()=>[...seen.values()].filter(count=>count>1).length;
   new MutationObserver(records=>{ for(const [index,record] of records.entries()) { const face=record.target as HTMLElement;
    const next=records.slice(index+1).find(later=>later.target===face), value=next?next.oldValue:face.getAttribute('data-moment');
    if(value!=='press'||record.oldValue==='press') continue;
    seen.set(face,(seen.get(face)??0)+1);
    hops.push(face.closest('.agent-tile')?'tile':face.closest('.empty-chat')?'chat':face.closest('.head-pill')?'pill':'other'); } })
    .observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-moment'],attributeOldValue:true}); });
  await tile.click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/chat\/[0-9a-f-]{36}$/);
  // The tile's face hops as the press opens its chat, and every copy of the same Agent's face drawn on that page (its
  // tile, the empty chat's face, the chat head's) hops once too; each hop is over after 620ms.
  const hops=()=>page.evaluate(()=>(window as unknown as {hops:string[]}).hops);
  await expect.poll(async()=>(await hops()).includes('chat')).toBe(true);
  expect((await hops())[0]).toBe('tile');
  expect(await page.evaluate(()=>(window as unknown as {twice:()=>number}).twice())).toBe(0);
  await expect(page.locator('.face[data-moment]')).toHaveCount(0);
  // Hovering a tile lifts its face 2px, after its 200ms transition.
  expect(await tileFace.evaluate(element=>getComputedStyle(element).transition)).toContain('transform 0.2s cubic-bezier(0.2, 0, 0, 1)');
  await page.locator('.sidebar .agent-tile').filter({hasText:'Mona'}).hover();
  await expect.poll(()=>page.locator('.sidebar .agent-tile').filter({hasText:'Mona'}).locator('.face').evaluate(element=>getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, -2)');
  // The Run held open: the chat head's face and the details' face think, their light swirling.
  fake.settings.pendingReads=1_000_000;
  const text=`Alive ${Date.now()}`;
  await page.getByLabel('Message',{exact:true}).fill(text);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
  const pill=page.locator('#btn-details');
  await expect(pill.locator('.face')).toHaveAttribute('data-state','thinking');
  await pill.hover();
  await expect.poll(()=>pill.locator('.face').evaluate(element=>getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, -1)');
  if(await pill.getAttribute('aria-expanded')!=='true') await pill.click();
  const face=page.locator('#details .fw--lg .face');
  await expect(face).toHaveAttribute('data-state','thinking');
  await expect(page.locator('#details .fw--lg > .dot')).toHaveClass(/\bdot--thinking\b/);
  expect(await face.locator('.f-swirl').evaluate(element=>{ const style=getComputedStyle(element); return [style.animationName,style.animationDuration,style.animationIterationCount].join(' '); })).toBe('gw-face-swirl 3.4s infinite');
  expect(await page.locator('#details .dp-id__state').textContent()).toBeTruthy();
  // The Run ends: the face is done for 1600ms, its eyes smiling and a hop, timed in the page as it starts and ends.
  await page.evaluate(()=>{ const times:number[]=[]; (window as unknown as {done:number[]}).done=times; const face=document.querySelector<HTMLElement>('#details .fw--lg .face')!;
   new MutationObserver(()=>{ const shown=face.dataset.state==='done'; if(shown!==(times.length%2===1)) times.push(performance.now()); }).observe(face,{attributes:true,attributeFilter:['data-state']}); });
  fake.settings.pendingReads=0;
  await expect(face).toHaveAttribute('data-state','done',{timeout:20000});
  await expect(face).toHaveAttribute('data-moment','done');
  await expect(face).not.toHaveAttribute('data-state','done');
  const [added,removed]=await page.evaluate(()=>(window as unknown as {done:number[]}).done);
  expect(removed-added).toBeGreaterThanOrEqual(1550); expect(removed-added).toBeLessThan(1800);
  await expect(page.locator('.msg[data-author=agent]')).toContainText(`Reply to: ${text}`);
 } finally { fake.settings.pendingReads=0; detach(agents as Record<string,{id:string,connection:string}>); await fake.close(); }
});

test('With reduced motion an Agent at work still shows its state and its end, and no face moves',async({page})=>{
 test.setTimeout(120000);
 const fake=await laneHermes();
 let agents={};
 try {
  await page.emulateMedia({reducedMotion:'reduce'});
  await ownerSignIn(page); agents=attachAgents();
  await page.goto('/c/rs-learning/work/board');
  const tile=page.locator('.sidebar .agent-tile').filter({hasText:'Nour'});
  await tile.click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/chat\/[0-9a-f-]{36}$/);
  await tile.hover();
  expect(await tile.locator('.face').evaluate(element=>getComputedStyle(element).transform)).toBe('none');
  fake.settings.pendingReads=1_000_000;
  await page.getByLabel('Message',{exact:true}).fill(`Still ${Date.now()}`);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  const pill=page.locator('#btn-details');
  await expect(pill.locator('.face')).toHaveAttribute('data-state','thinking');
  if(await pill.getAttribute('aria-expanded')!=='true') await pill.click();
  const face=page.locator('#details .fw--lg .face');
  await expect(face).toHaveAttribute('data-state','thinking');
  // Nothing of any face moves: no animation runs on it, and the dot sends no ring.
  const still=await page.evaluate(()=>[...document.querySelectorAll('.face')].every(face=>face.getAnimations({subtree:true}).every(animation=>animation.playState!=='running'))
   &&[...document.querySelectorAll('.face *')].every(element=>getComputedStyle(element).animationName==='none'));
  expect(still).toBe(true);
  fake.settings.pendingReads=0;
  await expect(face).toHaveAttribute('data-state','done',{timeout:20000});
 } finally { fake.settings.pendingReads=0; detach(agents as Record<string,{id:string,connection:string}>); await fake.close(); }
});
