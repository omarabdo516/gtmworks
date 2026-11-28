import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { appOrigin } from './lane.mjs';
import { appByKey, appConfig } from '../lib/app-catalogue.mjs';

// #158, the "+" menu's New channel, Connect apps and Model. RS Learning, worked as a team, runs on its own profile in a
// fake Engine whose model list and Runs answer as the pinned release's do; Lead, its main Agent, keeps that profile,
// signed in to Anthropic with an OpenRouter key, and one app (Klaviyo) connected. New channel is for the Owner and
// Managers of a team Company; Connect apps counts the connected apps and opens the apps sheet over the page (#202); Model is the Owner's
// alone, in a Conversation: a pick is kept on that Conversation and sent with each of its Runs, and nothing else changes.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const manager='20000000-0000-0000-0000-000000000002';
const contributor='20000000-0000-0000-0000-000000000003';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
const inUse=randomUUID();
// The management listener is on port 9119 beside the Engine's address, as in the install, on a loopback address of
// this file's own on each lane.
let fake:Awaited<ReturnType<typeof fakeHermes>>;

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({browser},testInfo)=>{
 // A retry starts from the seed again: Lead and its Connection below are inserted once per run of this file.
 freshSeed(testInfo);
 fake=await laneHermes();
 const klaviyo={url:'https://mcp.klaviyo.example/mcp',auth:'oauth',...appConfig(appByKey('klaviyo')!,`${appOrigin}/api/apps/callback/klaviyo`).mcp_servers.klaviyo};
 fake.settings.profiles.set(profile,{soul:'',provider:'anthropic',model:'claude-opus-4-6',key:fake.settings.key,config:{mcp_servers:{klaviyo}},credentials:{anthropic:'signed-in'},env:{OPENROUTER_API_KEY:'set'}} as never);
 // The Company holds the OpenRouter key in its shared space too, as a key set writes it, so it is one of the Company's
 // Providers and its models are offered (#620).
 fake.settings.profiles.set(`cs-${company.replaceAll('-','')}`,{soul:'',provider:'openrouter',model:'openai/gpt-5.5',key:fake.settings.key,config:{},credentials:{},env:{OPENROUTER_API_KEY:'set'}} as never);
 fake.settings.appTokens.add(`${profile}:klaviyo`);
 fake.settings.sessions.set(`gtmworks-${inUse}`,{profile,messages:[{role:'user',content:'Plan the week',timestamp:1},{role:'assistant',content:'Reply to: Plan the week',timestamp:2}]});
 query(`update public.people set language='en' where id in ('${omar}','${manager}','${contributor}')`);
 query(`update public.companies set work_mode='team' where id='${company}'`);
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  const connection=randomUUID();
  query(`do $$ begin
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${connection}','Lead','General',true,'${profile}');
   -- Its profile already shares the Company's Skills folder, so a Run does not wait for that (the shared space below).
   insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) select id,'${profile}',true,true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false,skills_shared=true;
   -- The Company's shared space, where its keys are written, so the OpenRouter key is one of its Providers (#620).
   insert into public.company_shared_spaces(company_id,folder) values ('${company}','/opt/data/profiles/cs-${company.replaceAll('-','')}/skills') on conflict do nothing;
   insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','${manager}','${lead}'),('${company}','${contributor}','${lead}');
   -- The Company is in use (a Manager wrote to Lead), so Lead's chat is the empty chat these tests open, not the
   -- first Conversation Lead opens on a new Company (#434).
   insert into public.conversations(id,company_id,person_id,agent_id,agent_name,hermes_session_id) values ('${inUse}','${company}','${manager}','${lead}','Lead','gtmworks-${inUse}');
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const plus=(page:Page)=>page.locator('.composer .composer__btn[aria-haspopup="menu"]');
const menu=(page:Page)=>page.getByRole('menu');
const field=(page:Page)=>page.locator('.composer__input');
// A Conversation with Lead, begun from Lead's empty chat; its page is open when this returns.
async function conversationWith(page:Page,first:string) {
 await page.goto(`/c/rs-learning/chat/${lead}`);
 await field(page).fill(first);
 await field(page).press('Enter');
 await page.waitForURL(/\/conversations\/[0-9a-f-]{36}$/);
 return page.url().split('/').pop()!;
}
// The Runs started on the Conversation's own Engine session (#883), each with the model it was sent with.
const runsOf=(conversation:string)=>{ const session=rows(`select hermes_session_id from public.conversations where id='${conversation}'`)[0]?.hermes_session_id;
 return fake.settings.runs.filter(run=>run.sessionId===session).map(run=>{ const {provider,model}=JSON.parse(run.body!); return {input:run.input,provider,model}; }); };

test('the Owner\'s menu: New channel opens the channel dialog and gives the focus back to "+", and Connect apps counts the connected app and opens the apps sheet',async({page})=>{
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${lead}`);
 await expect(plus(page)).toHaveAttribute('aria-label','More: call someone, new channel, commands, attach');
 await plus(page).click();
 await expect(menu(page).getByRole('menuitem',{name:'New channel For the team and agents in one conversation'})).toBeVisible();
 const apps=menu(page).getByRole('menuitem',{name:/^Connect apps/});
 await expect(apps.locator('.menu__d')).toHaveText('Connect a new tool to an agent · 1 connected');
 await menu(page).getByRole('menuitem',{name:/^New channel/}).click();
 await expect(menu(page)).toHaveCount(0);
 await expect(page.getByRole('dialog',{name:'New channel'})).toBeVisible();
 await expect(page.locator('#tm-name')).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(plus(page)).toBeFocused();
 await plus(page).click();
 await menu(page).getByRole('menuitem',{name:/^Connect apps/}).click();
 await expect(page.locator('dialog.apps-sheet')).toBeVisible();
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/chat/${lead}$`));
});

test('a Manager has New channel, only the count, and no Model; a Contributor has no New channel, only the count',async({page})=>{
 await signIn(page,'manager@example.com',`/c/rs-learning/chat/${lead}`);
 await plus(page).click();
 await expect(menu(page).getByRole('menuitem',{name:/^New channel/})).toBeVisible();
 await expect(menu(page).getByRole('menuitem',{name:/^Connect apps/}).locator('.menu__d')).toHaveText('1 connected');
 await page.keyboard.press('Escape');
 const conversation=await conversationWith(page,'Plan the week');
 await plus(page).click();
 await expect(menu(page).getByRole('menuitem',{name:/^Connect apps/})).toBeVisible();
 await expect(menu(page).getByText('Model',{exact:true})).toHaveCount(0);
 await expect(menu(page).getByRole('menuitemradio')).toHaveCount(0);
 const refused=await page.request.post('/api/conversations',{data:{company,conversation,intent:'model',choice:{provider:'openrouter',model:'openai/gpt-5.5'}}});
 expect(refused.status(),'the server refuses a Manager\'s choice').toBe(403);
 expect(await (await page.request.get(`/api/conversations?company=${company}&conversation=${conversation}&intent=models`)).json()).toEqual({error:'conversationNotAllowed'});
 expect(rows(`select model from public.conversations where id='${conversation}'`)).toEqual([{model:null}]);

 await page.context().clearCookies();
 await signIn(page,'reviewer@example.com',`/c/rs-learning/chat/${lead}`);
 await expect(plus(page)).toHaveAttribute('aria-label','More: call someone, commands, attach');
 await plus(page).click();
 await expect(menu(page).getByRole('menuitem',{name:/^New channel/})).toHaveCount(0);
 await expect(menu(page).getByRole('menuitem',{name:/^Connect apps/}).locator('.menu__d')).toHaveText('1 connected');
});

// The Owner's Model is for their own Conversation only: the server reads no list and keeps no pick for another
// Member's, and answers as if it were not there.
test('the Owner reads no model list and picks no model for a Conversation that is not their own',async({page})=>{
 await signIn(page,'manager@example.com',`/c/rs-learning/chat/${lead}`);
 const conversation=await conversationWith(page,'Draft the newsletter');
 await page.context().clearCookies();
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${lead}`);
 const list=await page.request.get(`/api/conversations?company=${company}&conversation=${conversation}&intent=models`);
 expect(list.status()).toBe(404);
 expect(await list.json()).toEqual({error:'conversationNotFound'});
 const picked=await page.request.post('/api/conversations',{data:{company,conversation,intent:'model',choice:{provider:'openrouter',model:'openai/gpt-5.5'}}});
 expect(picked.status()).toBe(404);
 expect(rows(`select model from public.conversations where id='${conversation}'`)).toEqual([{model:null}]);
});

// #202 (design-reference: the open-apps case and the apps sheet's close): the sheet opens over the page with the
// keyboard in its search; the address and the message being written stay, and closing it gives the focus back to the
// "+" it was opened from, in a Conversation and in a channel.
test('Connect apps opens the sheet over a Conversation and over a channel, keeps the message, and closing it gives the focus back to that "+"',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 const conversation=await conversationWith(page,'Plan the launch');
 const sheet=page.locator('dialog.apps-sheet');
 const places=[{url:`/c/rs-learning/conversations/${conversation}`,box:field(page)},
  {url:'/c/rs-learning/channels/69000000-0000-0000-0000-000000000001',box:page.getByRole('textbox',{name:'Write your message in the channel',exact:true})}];
 for(const {url,box} of places) {
  await page.goto(url);
  await box.fill('Half a thought');
  await expect(page.locator('#btn-apps .sb-apps__n')).toHaveText('1 connected');
  await plus(page).click();
  await expect(menu(page).getByRole('menuitem',{name:/^Connect apps/}).locator('.menu__d')).toHaveText('Connect a new tool to an agent · 1 connected');
  await menu(page).getByRole('menuitem',{name:/^Connect apps/}).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(sheet).toBeVisible();
  // Docked at the inline end, as drawn from the sidebar: the sheet's own styles reach it beside the frame. Measured once
  // it has slid in, since a box read while it moves can be a fraction of a pixel off.
  await sheet.evaluate(dialog=>Promise.all(dialog.getAnimations().map(animation=>animation.finished)));
  expect((await sheet.boundingBox())?.width).toBe(580);
  await expect(page.locator('#apps-q')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(plus(page)).toBeFocused();
  await expect(box).toHaveValue('Half a thought');
  expect(page.url()).toMatch(new RegExp(`${url}$`));
 }
});

test('in a Company worked alone the Owner has no New channel',async({page})=>{
 // R&S Consultations has Omar as its only Member, so it may be worked alone; Sage is its Agent.
 const alone='10000000-0000-0000-0000-000000000002'; const [connection,sage]=[randomUUID(),randomUUID()];
 query(`do $$ begin
  update public.companies set work_mode='alone' where id='${alone}';
    insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${sage}','${alone}','${connection}','Sage','General',true,'plus-alone');
 end $$;`);
 await signIn(page,'omar@example.com',`/c/rs-consultations/chat/${sage}`);
 await expect(plus(page)).toHaveAttribute('aria-label','More: call someone, commands, attach');
 await plus(page).click();
 await expect(menu(page).getByRole('menuitem',{name:/^Connect apps/})).toBeVisible();
 await expect(menu(page).getByRole('menuitem',{name:/^New channel/})).toHaveCount(0);
});

test('the Owner picks a model: the menu closes, the field has the focus, the toast says it, both later Runs carry it, and another Conversation and the Agent do not',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 const other=await conversationWith(page,'Draft the welcome email');
 const conversation=await conversationWith(page,'Plan the launch');
 await expect(plus(page)).toHaveAttribute('aria-label','More: call someone, new channel, commands, attach, model');
 await plus(page).click();
 const models=menu(page).getByRole('menuitemradio');
 // Each row is the model and its provider, as the Engine names them.
 await expect(models).toHaveText(['claude-opus-4-6anthropic','anthropic/claude-opus-4.6OpenRouter','openai/gpt-5.5OpenRouter']);
 await expect(models.nth(0)).toHaveAttribute('aria-checked','true');
 await expect(models.nth(0).locator('.menu__check')).toBeVisible();
 await expect(models.nth(2)).toHaveAttribute('aria-checked','false');
 await models.nth(2).click();
 await expect(menu(page)).toHaveCount(0);
 await expect(field(page)).toBeFocused();
 await expect(page.locator('.toast')).toHaveText('Lead will think with openai/gpt-5.5');
 for(const message of ['Write the first post','Now the second one']) {
  await field(page).fill(message);
  await field(page).press('Enter');
  await expect(page.locator('.msg').filter({hasText:`Reply to: ${message}`})).toBeVisible({timeout:20000});
 }
 expect(runsOf(conversation)).toEqual([{input:'Plan the launch'},{input:'Write the first post',provider:'openrouter',model:'openai/gpt-5.5'},{input:'Now the second one',provider:'openrouter',model:'openai/gpt-5.5'}]);
 await plus(page).click();
 await expect(menu(page).getByRole('menuitemradio',{checked:true})).toHaveText('openai/gpt-5.5OpenRouter');
 await page.keyboard.press('Escape');

 await page.goto(`/c/rs-learning/conversations/${other}`);
 await field(page).fill('And a subject line');
 await field(page).press('Enter');
 await expect(page.locator('.msg').filter({hasText:'Reply to: And a subject line'})).toBeVisible({timeout:20000});
 expect(runsOf(other).map(run=>run.model)).toEqual([undefined,undefined]);
 await plus(page).click();
 await expect(menu(page).getByRole('menuitemradio',{checked:true})).toHaveText('claude-opus-4-6anthropic');
 // The Agent's own model, which its page in Settings shows, is the Engine profile's, and nothing asked to change it.
 expect(fake.settings.profiles.get(profile)).toMatchObject({provider:'anthropic',model:'claude-opus-4-6'});
 expect(fake.settings.managementRequests.filter(request=>request.method!=='GET'&&/model|config/.test(request.path||''))).toEqual([]);
});

test('a model the Engine refuses leaves the Conversation on its earlier model and says so in one line under the composer',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 const conversation=await conversationWith(page,'Plan the launch');
 // Lead is idle before the refused send, so it starts a Run at once rather than waiting as a queued turn.
 await expect(page.locator('.msg').filter({hasText:'Reply to: Plan the launch'})).toBeVisible({timeout:20000});
 await plus(page).click();
 await menu(page).getByRole('menuitemradio',{name:/^openai\/gpt-5\.5/}).click();
 await expect(page.locator('.toast')).toHaveText('Lead will think with openai/gpt-5.5');
 fake.settings.refusedModels.add('anthropic/claude-opus-4.6');
 await plus(page).click();
 await menu(page).getByRole('menuitemradio',{name:/^anthropic\/claude-opus-4\.6/}).click();
 // The toast says the pick was kept; a message sent before then would still go on the earlier model.
 await expect(page.locator('.toast')).toHaveText('Lead will think with anthropic/claude-opus-4.6');
 await field(page).fill('Write the first post');
 await field(page).press('Enter');
 await expect(page.locator('.composer-error')).toHaveText('The agent engine did not take that model, so this chat stays on the model it had. Your message is still in the box.');
 await expect(field(page)).toHaveValue('Write the first post');
 expect(rows(`select model from public.conversations where id='${conversation}'`)).toEqual([{model:{provider:'openrouter',model:'openai/gpt-5.5'}}]);
 await plus(page).click();
 await expect(menu(page).getByRole('menuitemradio',{checked:true})).toHaveText('openai/gpt-5.5OpenRouter');
 await page.keyboard.press('Escape');
 // The same message, sent again, goes on the earlier model.
 await field(page).press('Enter');
 await expect(page.locator('.msg').filter({hasText:'Reply to: Write the first post'})).toBeVisible({timeout:20000});
 expect(runsOf(conversation).at(-1)).toEqual({input:'Write the first post',provider:'openrouter',model:'openai/gpt-5.5'});
});
