import { test, expect, freshSeed, type Page, type Locator } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { appOrigin } from './lane.mjs';
import { apps } from '../lib/app-catalogue.mjs';
import { logoWaiting } from '../components/logos';

// #30, Settings, Apps. RS Learning runs on its own profile in a fake Engine whose MCP catalogue and sign-ins answer as the
// pinned release's do; Lead, its main Agent, keeps that profile. The list and each app's state come from that Engine; the
// Owner connects an app for Lead through the vendor's window, which returns through gtmworks, and disconnects it; both
// are in the Activity log with Lead's name. A Manager reads the
// states only, and the server refuses them. The Connect apps sheet (#201), opened from the sidebar over any page, holds
// the same list and pages; a Viewer reads it too. No screen names the Engine or shows a file path.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID();
// The driver reaches the management listener on port 9119 beside the Engine's address, as in the install; this file's
// fake takes a loopback address of its own on each lane, so it never shares that port with another file.
let fake:Awaited<ReturnType<typeof fakeHermes>>;
const servers=()=>fake.settings.profiles.get(profile)!.config.mcp_servers||{};
// An app as gtmworks leaves it after a sign-in: installed, its read tools and its way back written.
const installed=(key:string)=>({url:`https://mcp.${key}.example/mcp`,auth:'oauth',enabled:true,oauth:{redirect_uri:`${appOrigin}/api/apps/callback/${key}`}});

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 query(`update public.people set language='en' where id in ('${omar}','20000000-0000-0000-0000-000000000002')`);
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  const connection=randomUUID();
  query(`do $$ begin
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${connection}','Lead','General',true,'${profile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const card=(page:Page,name:string)=>page.locator('.app-card').filter({has:page.getByRole('heading',{name,exact:true})});
async function noEngineText(page:Page,where='.sov') {
 const shown=await page.locator(where).innerText();
 expect(shown).not.toMatch(/hermes|هيرمس|هرمس/i);
 expect(shown).not.toMatch(/\/(opt|data|home|root|tmp)\/|config\.yaml|mcp_servers/i);
}
const sheetOf=(page:Page)=>page.locator('dialog.apps-sheet');
// What a list of apps shows: its count, then each group's title with each app's name, state and button.
const catalogueOf=async(root:Locator)=>({count:await root.locator('.apps-count').innerText(),groups:await root.locator('.apps-sec').evaluateAll(sections=>sections.map(section=>[
 section.querySelector('.apps-sec__h')!.textContent,[...section.querySelectorAll('.app-card')].map(card=>[card.querySelector('.app__name')!.textContent,card.querySelector('.app__state')!.textContent,card.querySelector('.app__foot .btn')?.textContent??null])]))});
// The sheet over Home shows what Settings, Apps showed, and the sidebar's count is its badge's.
async function sheetMatches(page:Page,section:Awaited<ReturnType<typeof catalogueOf>>) {
 await page.goto('/c/rs-learning/home');
 await expect(page.locator('#btn-apps .sb-apps__n')).toHaveText(section.count);
 await page.locator('#btn-apps').click();
 await expect(sheetOf(page).locator('#apps-q')).toBeFocused();
 await expect(sheetOf(page).locator('.app-card')).toHaveCount(33);
 expect(await catalogueOf(sheetOf(page))).toEqual(section);
}

test('the apps and their states are the Engine\'s: connected, needing attention or not connected, then all off',async({page})=>{
 fake.settings.catalog=fake.settings.catalog.filter(name=>name!=='gamma');
 fake.settings.profiles.get(profile)!.config.mcp_servers={klaviyo:installed('klaviyo'),notion:installed('notion')};
 fake.settings.appTokens.add(`${profile}:klaviyo`);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await page.goto('/c/rs-learning/settings?section=apps');
 await expect(page.locator('#sov-h')).toHaveText('Connect apps');
 await expect(page.locator('.apps-count'),'the chip counts every app in the Connected group, as the reference does').toHaveText('2 connected');
 const on=page.locator('.apps-sec').filter({has:page.getByRole('heading',{name:/^Connected/})});
 await expect(on.locator('.app__name')).toHaveText(['Klaviyo','Notion']);
 await expect(card(page,'Klaviyo').locator('.app__state')).toHaveText('Connected');
 await expect(card(page,'Klaviyo').getByRole('link',{name:'Manage Klaviyo'})).toBeVisible();
 await expect(card(page,'Notion').locator('.app__state')).toHaveText('Needs attention');
 await expect(card(page,'Notion').getByRole('link',{name:'Reconnect Notion'})).toBeVisible();
 await expect(card(page,'Canva').locator('.app__state')).toHaveText('Not connected');
 await expect(page.locator('.app__name'),'every app the Engine offers, the ready-made ones and the form').toHaveCount(33);
 const section=await catalogueOf(page.locator('.sov'));
 await page.locator('#apps-q').fill('كانفا');
 await expect(page.locator('.app__name')).toHaveText(['Canva']);
 await page.locator('#apps-q').fill('');
 await page.locator('#apps-cat-analytics').click();
 await expect(page.locator('.app__name')).toHaveText(['Amplitude','Mixpanel','Semrush','Ahrefs','Supermetrics','Similarweb','Hootsuite listening']);
 await noEngineText(page);
 await page.locator('#apps-cat-all').click();
 await card(page,'Notion').getByRole('link',{name:'Reconnect Notion'}).click();
 await expect(page.locator('.sheet__meta .badge')).toHaveText('Needs attention');
 await expect(page.getByRole('button',{name:'Reconnect',exact:true})).toBeVisible();
 await noEngineText(page);

 await sheetMatches(page,section);
 const sheet=sheetOf(page);
 await sheet.locator('#apps-q').fill('كانفا');
 await expect(sheet.locator('.app__name')).toHaveText(['Canva']);
 await sheet.locator('#apps-q').fill('');
 await sheet.locator('#apps-cat-analytics').click();
 await expect(sheet.locator('.app__name')).toHaveText(['Amplitude','Mixpanel','Semrush','Ahrefs','Supermetrics','Similarweb','Hootsuite listening']);
 await sheet.locator('#apps-cat-all').click();
 await sheet.getByRole('button',{name:'Reconnect Notion'}).click();
 await expect(sheet.locator('.sheet__meta .badge')).toHaveText('Needs attention');
 await expect(sheet.locator('#apps-back')).toBeFocused();
 await noEngineText(page,'.apps-sheet');
 await sheet.locator('#apps-back').click();
 await expect(sheet.getByRole('button',{name:'Reconnect Notion'})).toBeFocused();
 await expect(page,'the sheet never changes the address').toHaveURL(/\/c\/rs-learning\/home$/);

 fake.settings.profiles.get(profile)!.config.mcp_servers={};
 await page.goto('/c/rs-learning/settings?section=apps');
 await expect(page.locator('.apps-count')).toHaveText('0 connected');
 await expect(page.locator('.app__state')).toHaveText(Array(33).fill('Not connected'));
 await sheetMatches(page,await catalogueOf(page.locator('.sov')));

 // An Engine that does not answer: the button stays, with no count, and the sheet says the apps can't be read.
 fake.settings.managementStatus=503;
 await page.reload();
 await page.locator('#btn-apps').click();
 await expect(sheetOf(page).locator('.panel-empty')).toHaveText('The apps can’t be read right now. Try again in a minute.');
 await expect(page.locator('#btn-apps')).toHaveText('Connect apps');
 fake.settings.managementStatus=200;
 fake.settings.catalog.push('gamma');
});

test('the Owner connects an app through the vendor\'s window and disconnects it; both are in the Activity log',async({page,context})=>{
 // The vendor's sign-in page approves at once and sends the browser back to the address it was given, as a vendor does.
 await context.route(/^https:\/\/auth\.[a-z-]+\.example\//,route=>{
  const asked=new URL(route.request().url());
  return route.fulfill({status:302,headers:{location:`${asked.searchParams.get('redirect_uri')}?code=vendor-code&state=${asked.searchParams.get('state')}&scope=all`}});
 });
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 await page.goto('/c/rs-learning/settings?section=apps');
 await card(page,'Canva').getByRole('link',{name:'Connect Canva'}).click();
 await expect(page.locator('#sov-h')).toHaveText('Connect Canva');
 await expect(page.locator('.app-kv')).toContainText('You sign in through Canva’s own window. The password never passes through us.');
 const [vendor]=await Promise.all([page.waitForEvent('popup'),page.getByRole('button',{name:'Connect',exact:true}).click()]);
 await expect(vendor).toHaveURL(new RegExp(`/c/rs-learning/settings\\?section=apps&app=canva$`));
 await expect(vendor.locator('.sheet__meta .badge')).toHaveText('Connected');
 await expect(page.locator('.sheet__meta .badge')).toHaveText('Connected',{timeout:20000});
 expect('tools' in servers().canva).toBe(false);
 expect(servers().canva.oauth.redirect_uri).toBe(`${appOrigin}/api/apps/callback/canva`);
 expect(fake.settings.appCallbacks.map(search=>[...new URLSearchParams(search).keys()])).toEqual([['code','state']]);
 await noEngineText(vendor);
 await vendor.close();

 await page.locator('#app-off').click();
 await expect(page.locator('#app-off-t')).toHaveText('Disconnect Canva? Lead won’t be able to reach it until you connect it again.');
 await page.locator('#app-off-go').click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings\?section=apps$/);
 await expect(card(page,'Canva').locator('.app__state')).toHaveText('Not connected');
 expect(servers().canva).toBeUndefined();

 expect(JSON.parse(query(`select actor_id,action,details->>'app' as app from public.company_log where company_id='${company}' and action in ('app_connected','app_disconnected') order by id`)))
  .toEqual([{actor_id:omar,action:'app_connected',app:'canva'},{actor_id:omar,action:'app_disconnected',app:'canva'}]);
 await page.goto('/c/rs-learning/log');
 for(const act of ['let Lead use','stopped Lead using']) {
  const row=page.locator('.lgp-body .lg-row').filter({has:page.locator('.lg-act',{hasText:new RegExp(`^${act}$`)})}).filter({has:page.locator('.lg-obj',{hasText:'Canva'})}).first();
  await expect(row.locator('.lg-name')).toHaveText('عمر');
 }
});

test('the Owner connects and disconnects an app from the sheet over a page, through the same window, into the same log',async({page,context})=>{
 await context.route(/^https:\/\/auth\.[a-z-]+\.example\//,route=>{
  const asked=new URL(route.request().url());
  return route.fulfill({status:302,headers:{location:`${asked.searchParams.get('redirect_uri')}?code=vendor-code&state=${asked.searchParams.get('state')}&scope=all`}});
 });
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 const sheet=sheetOf(page);
 await page.locator('#btn-apps').click();
 await sheet.getByRole('button',{name:'Connect Airtable'}).click();
 await expect(sheet.locator('#apps-title')).toHaveText('Connect Airtable');
 const [vendor]=await Promise.all([page.waitForEvent('popup'),sheet.getByRole('button',{name:'Connect',exact:true}).click()]);
 await expect(vendor).toHaveURL(/\/c\/rs-learning\/settings\?section=apps&app=airtable$/);
 await vendor.close();
 await expect(sheet.locator('.sheet__meta .badge')).toHaveText('Connected',{timeout:20000});
 expect('tools' in servers().airtable).toBe(false);
 await sheet.locator('#app-off').click();
 await sheet.locator('#app-off-go').click();
 await expect(sheet.getByRole('button',{name:'Connect Airtable'})).toBeFocused();
 await expect(card(page,'Airtable').locator('.app__state')).toHaveText('Not connected');
 expect(servers().airtable).toBeUndefined();
 await expect(page,'the sheet never changes the address').toHaveURL(/\/c\/rs-learning\/home$/);
 expect(JSON.parse(query(`select actor_id,action,details->>'app' as app from public.company_log where company_id='${company}' and action in ('app_connected','app_disconnected') and details->>'app'='airtable' order by id`)))
  .toEqual([{actor_id:omar,action:'app_connected',app:'airtable'},{actor_id:omar,action:'app_disconnected',app:'airtable'}]);
});

test('a Viewer opens the sheet and reads the states with no button',async({browser})=>{
 const context=await browser.newContext(); const viewer=await context.newPage();
 try {
  query(`update public.people set language='en' where id='20000000-0000-0000-0000-000000000004'`);
  await signIn(viewer,'viewer@example.com','/c/rs-learning/home');
  await viewer.locator('#btn-apps').click();
  const sheet=sheetOf(viewer);
  await expect(sheet.locator('.apps-sub')).toHaveText('Connecting apps and choosing which agents use them is done by the Owner only.');
  await expect(card(viewer,'Canva').locator('.app__state')).toHaveText('Not connected');
  await expect(sheet.locator('.app-card').getByRole('button')).toHaveCount(0);
  await noEngineText(viewer,'.apps-sheet');
 } finally { await context.close(); }
});

test('a Manager reads the states with no button, and the server refuses their connect and their way back',async({browser})=>{
 const context=await browser.newContext(); const manager=await context.newPage();
 try {
  const flows=fake.settings.appFlows.size, callbacks=fake.settings.appCallbacks.length;
  await signIn(manager,'manager@example.com','/c/rs-learning/home');
  await manager.goto('/c/rs-learning/settings?section=apps');
  // In Settings the line is the title's help (#614), behind its "i".
  await expect(manager.locator('#apps-sub')).toHaveText('Connecting apps and choosing which agents use them is done by the Owner only.');
  await expect(card(manager,'Canva').locator('.app__state')).toHaveText('Not connected');
  await expect(manager.locator('.app-card').getByRole('link')).toHaveCount(0);
  const refused=await manager.request.post('/api/company-apps',{data:{company,app:'canva',action:'connect'}});
  expect(refused.status()).toBe(403);
  await manager.goto('/api/apps/callback/canva?code=stolen&state=guess');
  await expect(manager).not.toHaveURL(/callback/);
  expect([fake.settings.appFlows.size,fake.settings.appCallbacks.length]).toEqual([flows,callbacks]);
 } finally { await context.close(); }
});

// The Shell reads no Engine (#201): a page is drawn and its sidebar shows Connect apps with no count, and the count lands
// from GET /api/company-apps after it.
test('a page is drawn with no read of the Engine, and the sidebar\'s count comes after it from the apps route',async({page})=>{
 let release=()=>{}; const held=new Promise<void>(resolve=>{ release=resolve; });
 const reads=/\/api\/company-apps\?company=/;
 await page.route(reads,async route=>{ await held; await route.continue().catch(()=>{}); });
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 const catalogueReads=()=>fake.settings.managementRequests.filter(request=>request.path?.startsWith('/api/mcp/catalog')).length;
 const before=catalogueReads();
 const drawn=await page.goto('/c/rs-learning/home');
 await expect(page.locator('#btn-apps')).toHaveText('Connect apps');
 expect(await drawn!.text(),'the page carries no count').not.toContain('sb-apps__n');
 expect(catalogueReads(),'drawing the page asked the Engine nothing').toBe(before);
 const answer=page.waitForResponse(response=>reads.test(response.url())&&response.request().method()==='GET');
 release();
 expect((await answer).headers()['cache-control']).toBe('no-store');
 await expect(page.locator('#btn-apps .sb-apps__n')).toHaveText(/^\d+ connected$/);
 expect(catalogueReads()).toBeGreaterThan(before);
});

// #577: in the Connect apps sheet's All tab every app shows its company's logo, a file of this install that loads, and
// none is fetched from outside; it stays clear on the white tile in the light and the dark theme, both attached to the run.
// Only the Owner's own server and an app whose mark is still to be taken (logoWaiting, #580) keep their first letter.
test('every app in Connect apps shows its company\'s logo from the install, in both themes',async({page},testInfo)=>{
 const origin=new URL(testInfo.project.use.baseURL!).origin;
 const outside:string[]=[];
 page.on('request',request=>{ if(request.resourceType()==='image'&&new URL(request.url()).origin!==origin) outside.push(request.url()); });
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 const sheet=sheetOf(page);
 for(const theme of ['light','dark'] as const) {
  await page.emulateMedia({colorScheme:theme});
  if(!await sheet.isVisible()) await page.locator('#btn-apps').click();
  await expect(sheet.locator('.app-card').first()).toBeVisible();
  const tiles=await sheet.locator('.app-card').evaluateAll(cards=>cards.map(card=>({name:card.querySelector('.app__name')!.textContent,logo:card.querySelector('.tool-tile img.tool-logo')?.getAttribute('src')??null,letter:card.querySelector('.tool-tile')!.textContent})));
  // The Engine's catalogue here is the fake's, beside every ready-made server and the own-tool card.
  expect(tiles.length).toBeGreaterThan(30);
  const waiting=new Set(apps.filter(app=>logoWaiting.has(app.key)).map(app=>app.name));
  expect(tiles.filter(tile=>!tile.logo&&!waiting.has(tile.name!)),'only the own-tool card keeps a letter').toEqual([{name:'Your own tool (MCP)',logo:null,letter:'Y'}]);
  await sheet.locator('.app-card img.tool-logo').last().scrollIntoViewIfNeeded();
  await expect.poll(()=>sheet.locator('.app-card img.tool-logo').evaluateAll(images=>images.filter(image=>!(image as HTMLImageElement).complete||(image as HTMLImageElement).naturalWidth===0).map(image=>image.getAttribute('src')))).toEqual([]);
  // In the dark theme the tile behind a logo stays white, so a black mark never sinks into the dark page.
  if(theme==='dark') expect(await sheet.locator('.app-card .tool-tile:has(.tool-logo)').evaluateAll(tiles=>[...new Set(tiles.map(tile=>getComputedStyle(tile).backgroundColor))])).toEqual(['rgb(255, 255, 255)']);
  await sheet.locator('.app-card').first().scrollIntoViewIfNeeded();
  await testInfo.attach(`connect-apps-${theme}`,{body:await page.screenshot(),contentType:'image/png'});
 }
 expect(outside).toEqual([]);
});
