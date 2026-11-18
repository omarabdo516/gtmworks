import { test, expect, type Page } from './offline-browser';
import { localQuery, localStatement, resetFirstRun } from '../scripts/first-run-db.mjs';
import { encryptSecret } from '../lib/agent-crypto.mjs';
import { fakeHermes } from './fake-hermes.mjs';
import { signIn } from './sign-in';
import { lane } from './lane.mjs';
import { agency, engineName } from './ui-words.mjs';

// #329: the whole journey on a fresh install, as a person who just ran the one-line install walks it. It starts from an
// empty install as first-run.spec.ts does, in the same project (after every seeded test), and puts the seed back after.
// The Engine is the fake one (tests/fake-hermes.mjs) on a loopback address of this file's own, its management listener
// on 9119 beside it as in the install. The browser suite runs without the bundled Engine, so the worker's step that
// gives the new Company its profile and Lead is done through the same database function (attach_company_profile).
const code=process.env.SETUP_CODE!;
const owner={name:'Journey owner',email:'journey-owner@example.test',company:'Journey Company',password:'journey-owner-password'};
const encryptionKey=process.env.WEBHOOK_ENCRYPTION_KEY||'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const reason='Without it I can’t tell which leads bought. Connected, I can work out the return.';
const asks:Record<string,string>={
 'Clean up the exports':'',
 'Write the weekly report':`I wrote it without the sales.\n\n\`\`\`gtmworks-tool\n${JSON.stringify({name:'ask_for_app',arguments:{app:'amplitude',reason}})}\n\`\`\``,
};
let fake:Awaited<ReturnType<typeof fakeHermes>>;

test.use({actionTimeout:15000});
test.beforeAll(async({baseURL})=>{
 resetFirstRun(baseURL);
 fake=await fakeHermes({host:`127.0.0.${80+lane}`,managementPort:9119});
 fake.settings.approvals=input=>input==='Clean up the exports'?[{description:'delete the old exports',command:'rm -r /srv/exports'}]:[];
 fake.settings.reply=input=>asks[input]||`Reply to: ${input}`;
});
test.afterAll(async({baseURL})=>{ await fake?.close(); resetFirstRun(baseURL,true); });

// Everything a person can read or hear on the page (as tests/engine-name.spec.ts reads it).
const readable=(page:Page)=>page.evaluate(()=>[document.title,document.body.innerText,
 ...[...document.querySelectorAll('[aria-label],[placeholder],[title],[alt]')].flatMap(element=>['aria-label','placeholder','title','alt'].map(name=>element.getAttribute(name)||''))].join('\n'));
// The page in `language` names neither the Engine nor an agency (the words: tests/ui-words.mjs).
async function wordsAreOwn(page:Page,language:'en'|'ar',path:string) {
 await expect(page.locator('html')).toHaveAttribute('lang',language);
 const text=await readable(page);
 expect(text.length,`${language} ${path}`).toBeGreaterThan(0);
 expect(text,`${language} ${path}`).not.toMatch(engineName);
 expect(text,`${language} ${path}`).not.toMatch(agency[language]);
}
const field=(page:Page)=>page.locator('.composer__input');
const plus=(page:Page)=>page.locator('.composer .composer__btn[aria-haspopup="menu"]');
const counts=(page:Page)=>({
 sidebar:page.locator('.sidebar .sb-count[href$="/approvals"] .sb-count__n'),
 column:page.locator('.col[data-column="waiting"] .col__count'),
 numbers:page.locator('.panel--wait .panel__h .num'),
});

test('a fresh install walks from the setup link to sign-in, Lead, the board, Agents, a decided permission request and a connected app, never naming the Engine or an agency',async({page,baseURL})=>{
 test.setTimeout(300000);
 await page.setViewportSize({width:1440,height:900});
 const visited=new Set<string>();
 const seen=()=>visited.add(new URL(page.url()).pathname);

 // 1. The setup link opens first run, which creates the Owner with a password. Its page and the sign-in page are read
 // in both languages while they are on the path: after setup, first run is gone, and a signed-in person skips sign-in.
 for(const language of ['ar','en'] as const) for(const path of [`/sign-in?language=${language}`,`/first-run?language=${language}#code=${code}`]) {
  await page.goto(path);
  await expect(page.getByRole('button',{name:/^(Sign in|Create and sign in|تسجيل الدخول|إنشاء وتسجيل الدخول)$/})).toBeVisible();
  await wordsAreOwn(page,language,path);
 }
 await page.getByLabel('Your name').fill(owner.name);
 await page.getByLabel('Email').fill(owner.email);
 await page.getByLabel('Password',{exact:true}).fill(owner.password);
 await page.getByLabel('Confirm password').fill(owner.password);
 await page.getByLabel('First company name').fill(owner.company);
 await page.getByRole('button',{name:'Create and sign in'}).click();
 await expect(page).toHaveURL(/\/c\/journey-company-[a-f0-9]{8}\/home$/);
 const slug=new URL(page.url()).pathname.split('/')[2];
 const [{id:company,profile}]=localQuery(`select id,public.company_engine_profile(id) profile from public.companies`,baseURL);
 // The worker's step: the Company's own profile in the Engine, and Lead on it.
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 localStatement(`insert into public.company_profiles(company_id,profile,tools_level,tools_policy,tools_pending,skills_shared) select id,public.company_engine_profile(id),agent_level,public.engine_tool_policy(),false,true from public.companies`,baseURL);
 expect(localQuery(`select public.attach_company_profile('${company}','${fake.address}','${encryptSecret(fake.settings.key,encryptionKey)}','0.23.0','{run_submission,run_events_sse}') attached`,baseURL)).toEqual([{attached:true}]);

 // 2. Signed out, the Owner signs in with that email and password, answers alone, and lands in one Conversation with Lead.
 await page.context().clearCookies();
 await signIn(page,owner.email,'/sign-in',owner.password);
 seen();
 await expect(page).toHaveURL(`/c/${slug}/home`);
 const question=page.getByRole('dialog',{name:'Will you work alone or with a team?'});
 await question.getByRole('radio',{name:'Alone'}).check();
 await question.getByRole('button',{name:'Open the workspace'}).click();
 await expect(page).toHaveURL(new RegExp(`/c/${slug}/conversations/[0-9a-f-]{36}$`));
 const conversation=new URL(page.url()).pathname;
 seen();
 await expect(page.locator('#sb-recent .thread-item:not(.ch-item)')).toHaveCount(1);
 await expect(page.locator('#sb-recent .thread-item:not(.ch-item)')).toHaveAttribute('aria-current','true');
 await expect(page.locator('[data-lead-line]')).toBeVisible();

 // 3. A message to Lead gets the Engine's reply in the same Conversation.
 await field(page).fill('Plan the launch');
 await field(page).press('Enter');
 await expect(page.locator('.msg').filter({hasText:'Reply to: Plan the launch'})).toBeVisible({timeout:20000});
 await expect(page).toHaveURL(conversation);

 // 4. The board, from the sidebar, with its six columns; Agents with Lead as main; Lead's details.
 await page.locator('.sidebar').getByRole('link',{name:'Marketing board',exact:true}).click();
 await expect(page).toHaveURL(`/c/${slug}/work/board`);
 await expect(page.locator('#board-cols > .col')).toHaveCount(6);
 seen();
 // The sidebar's Agents: Lead alone, marked as main; the Agents page, from the account menu's sections, lists it.
 const agents=page.locator('.sidebar section[aria-labelledby="lbl-agents"]');
 await expect(agents.getByRole('heading',{name:'Agents'})).toBeVisible();
 const leadTile=agents.locator('.agent-tile:not(.agent-tile--new)');
 await expect(leadTile).toHaveCount(1);
 await expect(leadTile).toHaveAccessibleName(/^Lead · Main · /);
 await expect(leadTile.locator('.agent-tile__main')).toHaveText('Main');
 await page.locator('.sidebar #btn-me').click();
 await page.getByRole('menu').getByRole('menuitem',{name:'Agents',exact:true}).click();
 await expect(page).toHaveURL(`/c/${slug}/agents`);
 await expect(page.getByRole('heading',{level:1,name:'Agents'})).toBeVisible();
 await expect(page.locator('.company-hermes-agents').getByText('Lead',{exact:true})).toBeVisible();
 seen();
 await leadTile.click();
 const details=page.getByRole('complementary',{name:'Details: Lead',exact:true});
 await expect(details).toBeVisible();
 seen();
 await expect(details.locator('.dp-label')).toContainText(['Latest activity']);
 await expect(details.locator('.dp-tools').getByRole('heading',{name:'Connected tools'})).toBeVisible();

 // 5. A permission request is one item in "Waiting on you", counted in the sidebar, on the board and on Numbers.
 await page.goto(conversation);
 await field(page).fill('Clean up the exports');
 await field(page).press('Enter');
 const request=page.locator('[id^="permission-"]');
 await expect(request.getByRole('button')).toHaveText(['Don’t allow','Allow once'],{timeout:20000});
 const {sidebar,column,numbers}=counts(page);
 await page.locator('.sidebar .sb-count[href$="/approvals"]').click();
 await expect(page).toHaveURL(`/c/${slug}/approvals`);
 seen();
 const item=page.locator('.col[data-column="waiting"] a.mcard[data-kind="permission"]');
 await expect(item).toHaveCount(1);
 await expect(item.locator('.mcard__who')).toHaveText('Lead');
 await expect(item.locator('.mcard__q')).toHaveText('delete the old exports');
 await expect(sidebar).toHaveText('1');
 await expect(column).toHaveText('1');
 await page.locator('.sidebar').getByRole('link',{name:'Numbers',exact:true}).click();
 await expect(page).toHaveURL(`/c/${slug}/numbers`);
 seen();
 await expect(numbers).toHaveText('1');
 await expect(page.locator('.panel--wait .panel-row').filter({hasText:'delete the old exports'})).toHaveCount(1);
 // Opened from the item, the card is in view; Allow once removes the item and the counts drop back.
 await page.goto(`/c/${slug}/approvals`);
 await item.click();
 await expect(request).toBeInViewport();
 await expect(page).toHaveURL(conversation);
 await request.getByRole('button',{name:'Allow once'}).click();
 await expect(request.locator('.card__outcome')).toHaveText(/^Allowed once · /);
 await expect(page.locator('.msg').filter({hasText:'Reply to: Clean up the exports'})).toBeVisible({timeout:20000});
 await page.goto(`/c/${slug}/approvals`);
 await expect(item).toHaveCount(0);
 await expect(sidebar).toHaveText('0');
 await expect(column).toHaveText('0');
 await page.goto(`/c/${slug}/numbers`);
 await expect(numbers).toHaveText('0');

 // 6. Lead asks for an app it does not have: the Owner connects it from the card.
 await page.context().route(/^https:\/\/auth\.[a-z-]+\.example\//,route=>{
  const asking=new URL(route.request().url());
  return route.fulfill({status:302,headers:{location:`${asking.searchParams.get('redirect_uri')}?code=vendor-code&state=${asking.searchParams.get('state')}&scope=all`}});
 });
 await page.goto(conversation);
 await field(page).fill('Write the weekly report');
 await field(page).press('Enter');
 await expect(page.locator('.msg').filter({hasText:'I wrote it without the sales.'})).toBeVisible({timeout:20000});
 const card=page.getByRole('group',{name:'Connect Amplitude',exact:true});
 await expect(card.locator('.card__sub')).toHaveText(reason,{timeout:20000});
 const [vendor]=await Promise.all([page.waitForEvent('popup'),card.getByRole('button',{name:'Connect',exact:true}).click()]);
 await expect(page.getByRole('group',{name:'Amplitude connected',exact:true}).locator('.card__outcome')).toHaveText('Amplitude connected',{timeout:20000});
 await vendor.close();
 // Lead's "Connected tools" lists it as Connected, and the log has one row for it.
 await page.locator('.sidebar .agent-tile:not(.agent-tile--new)').click();
 await expect(details.locator('.dp-tools .panel-row').filter({hasText:'Amplitude'}).locator('.panel-row__meta')).toHaveText('Connected');
 await page.locator('.sidebar').getByRole('link',{name:'Activity log',exact:true}).click();
 await expect(page).toHaveURL(`/c/${slug}/log`);
 seen();
 await expect(page.locator('.lgp-body .lg-row').filter({hasText:'Amplitude'})).toHaveCount(1);

 // "Connect apps" in the "+" menu opens the sheet over the chat with the typed message kept, and focus returns to "+".
 await page.goto(conversation);
 await field(page).fill('Half a thought');
 await plus(page).click();
 await page.getByRole('menu').getByRole('menuitem',{name:/^Connect apps/}).click();
 const sheet=page.locator('dialog.apps-sheet');
 await expect(sheet).toBeVisible();
 await expect(page).toHaveURL(conversation);
 await expect(page.locator('#apps-q')).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(sheet).toHaveCount(0);
 await expect(plus(page)).toBeFocused();
 await expect(field(page)).toHaveValue('Half a thought');

 // 7. No page on the path names the Engine or an agency, in English or in Arabic.
 for(const language of ['en','ar'] as const) {
  localStatement(`update public.people set language='${language}'`,baseURL);
  for(const path of visited) {
   await page.goto(path);
   await wordsAreOwn(page,language,path);
  }
  // What opens over a page is read too: Lead's details panel, the "+" menu, and the apps sheet it opens.
  await page.goto(conversation);
  await page.locator('.sidebar .agent-tile:not(.agent-tile--new)').click();
  await expect(page.getByRole('complementary',{name:language==='en'?'Details: Lead':'تفاصيل Lead',exact:true})).toBeVisible();
  await wordsAreOwn(page,language,`${conversation} (Lead's details)`);
  await page.goto(conversation);
  await plus(page).click();
  const menu=page.getByRole('menu');
  await expect(menu.getByRole('menuitem',{name:language==='en'?/^Connect apps/:/^ربط التطبيقات/})).toBeVisible();
  await wordsAreOwn(page,language,`${conversation} (the "+" menu)`);
  await menu.getByRole('menuitem',{name:language==='en'?/^Connect apps/:/^ربط التطبيقات/}).click();
  await expect(page.locator('dialog.apps-sheet')).toBeVisible();
  await wordsAreOwn(page,language,`${conversation} (the apps sheet)`);
 }
});
