import { test, expect, type Page } from './offline-browser';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localQuery, resetFirstRun } from '../scripts/first-run-db.mjs';
import { signIn } from './sign-in';
import { inbox, serverLogOf } from './lane.mjs';

// The install's setup code (playwright.config.ts), as the installer's setup link carries it (issue #50).
const code=process.env.SETUP_CODE!;
const input={name:'First owner',email:'first-owner@example.test',company:'First Company',language:'en',code,password:'first-owner-password',confirm:'first-owner-password'};
const counts=(baseURL:string)=>localQuery(`select
 (select count(*)::int from auth.users) accounts,
 (select count(*)::int from public.people) people,
 (select count(*)::int from public.companies) companies,
 (select count(*)::int from public.members where role='owner') owners`,baseURL)[0];
test.beforeEach(({baseURL})=>resetFirstRun(baseURL));
test.afterEach(async({},testInfo)=>{
 if(testInfo.status===testInfo.expectedStatus) return;
 const log=await readFile(join(process.cwd(),serverLogOf()),'utf8').catch(error=>{
  if(error.code==='ENOENT') return '';
  throw error;
 });
 const lines=log.split(/\r?\n/).filter(line=>/first.run|setup|complete_setup|createUser|server_action_failed/.test(line)).slice(-40);
 if(lines.length) console.log(`[first-run server log]\n${lines.join('\n')}`);
});
test.afterAll(({baseURL})=>resetFirstRun(baseURL,true));

async function fillFirstRun(page:Page,values:typeof input) {
 await page.getByLabel(/^(Your name|اسمك)$/).fill(values.name);
 await page.getByLabel(/^(Email|البريد الإلكتروني)$/).fill(values.email);
 await page.getByLabel(/^(Password|كلمة المرور)$/).fill(values.password);
 await page.getByLabel(/^(Confirm password|تأكيد كلمة المرور)$/).fill(values.confirm);
 await page.getByLabel(/^(First company name|اسم الشركة الأولى)$/).fill(values.company);
}

test('empty install creates its first person as the Owner of its first company with a password and opens Home signed in, with no email',async({page,baseURL})=>{
 await page.request.delete(inbox);
 await page.goto('/');
 await expect(page).toHaveURL('/first-run');
 // Without the setup link's code the page says where the link comes from and shows no form. Next's route announcer is
 // an alert too, outside the page's main landmark.
 await expect(page.getByRole('main').getByRole('alert')).toHaveText('Setup opens only from the link the installer printed on your server. Run the installer again there to see it.');
 await expect(page.getByLabel('Your name')).toHaveCount(0);
 // The code is in the link's fragment (issue #50): no request the browser makes carries it except the submit body.
 const requests:{url:string,body:string|null}[]=[];
 page.on('request',request=>requests.push({url:request.url(),body:request.postData()}));
 await page.goto(`/first-run#code=${code}`);
 await page.locator('select').selectOption('ar');
 await fillFirstRun(page,input);
 await page.getByRole('button',{name:'إنشاء وتسجيل الدخول'}).click();
 await expect(page).toHaveURL(/\/c\/first-company-[a-f0-9]{8}\/home$/);
 await expect(page.locator('html')).toHaveAttribute('lang','ar');
 await expect(page.locator('.home-dashboard')).toBeVisible();
 await expect(page.getByLabel('اختيار الشركة')).toContainText(input.company);
 expect(counts(baseURL!)).toEqual({accounts:1,people:1,companies:1,owners:1});
 expect(localQuery(`select p.language,m.role,m.grant_publishing,m.grant_money_figures,m.grant_customer_data,c.name company from public.people p join public.members m on m.person_id=p.id and m.removed_at is null join public.companies c on c.id=m.company_id`,baseURL)).toEqual([{language:'ar',role:'owner',grant_publishing:true,grant_money_figures:true,grant_customer_data:true,company:input.company}]);
 expect((await page.request.get('/first-run')).status()).toBe(404);
 // Two requests carry it, both in a submit body: the page's check that the code is right, then the submission.
 const carrying=requests.filter(request=>request.url.includes(code) || request.body?.includes(code));
 expect(carrying.map(request=>request.url)).toEqual([`${baseURL}/first-run/submit`,`${baseURL}/first-run/submit`]);
 for(const request of carrying) expect(new URLSearchParams(request.body!).get('code')).toBe(code);
 // The code worked once: after setup the same link and a second submission with it are refused.
 expect((await page.request.get(`/first-run?code=${code}`)).status()).toBe(404);
 expect((await page.request.post('/first-run/submit',{form:{...input,email:'second@example.test'},maxRedirects:0})).status()).toBe(404);
 expect(counts(baseURL!)).toEqual({accounts:1,people:1,companies:1,owners:1});
 // No email step: the local inbox stays empty.
 const mailbox=await (await page.request.get(inbox)).json();
 expect(mailbox.messages ?? []).toHaveLength(0);
});

test('the page shows the form only for the setup link with the right code',async({page,baseURL})=>{
 const needsLink='Setup opens only from the link the installer printed on your server. Run the installer again there to see it.';
 const requests:{url:string,body:string|null}[]=[];
 page.on('request',request=>requests.push({url:request.url(),body:request.postData()}));
 const wrong=['0'.repeat(64),code.slice(0,-1),`${code.slice(0,-1)}${code.endsWith('0')?'1':'0'}`,'not-a-code'];
 for(const fragment of ['','#code=',...wrong.map(value=>`#code=${value}`)]) {
  // A full load for each link, so the previous link's message cannot answer for this one.
  await page.goto('about:blank');
  await page.goto(`/first-run${fragment}`);
  await expect(page.getByRole('main').getByRole('alert'),fragment).toHaveText(needsLink);
  await expect(page.getByLabel('Your name'),fragment).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Create and sign in'}),fragment).toHaveCount(0);
 }
 // A code reaches the server only in one check's body, and the check creates nothing. Bodies are matched on their exact
 // code field: one wrong code is a prefix of the next, so a substring match would count both.
 const checks=(value:string)=>requests.filter(request=>new URLSearchParams(request.body ?? '').get('code')===value);
 for(const value of wrong) {
  expect(requests.filter(request=>request.url.includes(value)).map(request=>request.url),value).toEqual([]);
  const carrying=checks(value);
  expect(carrying.map(request=>request.url),value).toEqual([`${baseURL}/first-run/submit`]);
  expect(Object.fromEntries(new URLSearchParams(carrying[0].body!)),value).toEqual({code:value,check:'1'});
 }
 await page.goto(`/first-run#code=${code}`);
 await expect(page.getByLabel('Your name')).toBeVisible();
 await expect(page.getByRole('button',{name:'Create and sign in'})).toBeVisible();
 await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
 expect(requests.filter(request=>request.url.includes(code)).map(request=>request.url)).toEqual([]);
 expect(checks(code).map(request=>Object.fromEntries(new URLSearchParams(request.body!)))).toEqual([{code,check:'1'}]);
 expect(counts(baseURL!)).toEqual({accounts:0,people:0,companies:0,owners:0});
});

test('a submission with no setup code or a wrong one is refused and creates no account or company',async({request,baseURL})=>{
 const noCode={name:input.name,email:input.email,company:input.company,language:input.language};
 // The page's check is refused the same way, and with the right code it answers without creating anything.
 expect((await request.post('/first-run/submit',{form:{code,check:'1'},maxRedirects:0})).status()).toBe(204);
 for(const form of <Record<string,string>[]>[noCode,{...input,code:'0'.repeat(64)},{...input,code:code.slice(0,-1)},{check:'1'},{code:'0'.repeat(64),check:'1'},{code:code.slice(0,-1),check:'1'}]) {
  const refused=await request.post('/first-run/submit',{form,maxRedirects:0});
  expect(refused.status()).toBe(403);
  expect(await refused.text()).toBe('Setup opens only from the link the installer printed on your server. Run the installer again there to see it.');
 }
 expect(localQuery('select (select count(*)::int from auth.users) accounts, (select count(*)::int from public.companies) companies',baseURL)[0]).toEqual({accounts:0,companies:0});
 expect(counts(baseURL!)).toEqual({accounts:0,people:0,companies:0,owners:0});
});

test('a password shorter than 10 characters is refused with a clear message in English and in Arabic, and creates nothing',async({page,baseURL})=>{
 for(const [language,message] of [['en','Use at least 10 characters for your password.'],['ar','استخدم 10 أحرف على الأقل لكلمة المرور.']]) {
  await page.goto(`/first-run?language=${language}#code=${code}`);
  await fillFirstRun(page,{...input,password:'short-pw1',confirm:'short-pw1'});
  await page.getByRole('button',{name:/^(Create and sign in|إنشاء وتسجيل الدخول)$/}).click();
  await expect(page).toHaveURL(new RegExp(`/first-run\\?invalid=passwordTooShort&language=${language}#code=${code}$`));
  await expect(page.getByRole('alert').filter({hasText:message})).toHaveText(message);
 }
 await fillFirstRun(page,{...input,confirm:'another-password'});
 await page.getByRole('button',{name:'إنشاء وتسجيل الدخول'}).click();
 await expect(page.getByRole('alert').filter({hasText:'كلمتا المرور غير متطابقتين.'})).toBeVisible();
 expect(counts(baseURL!)).toEqual({accounts:0,people:0,companies:0,owners:0});
});

test('no password appears in the web or worker log or in any public table after sign-up and sign-in',async({page,context,baseURL})=>{
 const marker=`marker-${Date.now()}-pw`;
 await page.goto(`/first-run#code=${code}`);
 await fillFirstRun(page,{...input,password:marker,confirm:marker});
 await page.getByRole('button',{name:'Create and sign in'}).click();
 await expect(page).toHaveURL(/\/c\/first-company-[a-f0-9]{8}\/home$/);
 await context.clearCookies();
 await signIn(page,input.email,'/sign-in',marker);
 await expect(page).toHaveURL(/\/c\/first-company-[a-f0-9]{8}\/home$/);
 // A wrong attempt that includes the marker goes through the same path and must not be logged either.
 await context.clearCookies();
 await page.goto('/sign-in');
 await page.getByLabel('Email',{exact:true}).fill(input.email);
 await page.getByLabel('Password',{exact:true}).fill(`${marker}-wrong`);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'Wrong email or password.'})).toBeVisible();
 // The web server and the worker both write to this log (playwright.config.ts, scripts/web.sh).
 const log=await readFile(join(process.cwd(),serverLogOf()),'utf8');
 expect(log.length).toBeGreaterThan(0);
 expect(log.includes(marker)).toBe(false);
 // Every row of every public table, read as text; the check proves itself on a value that is there (the email).
 const tablesWith=(needle:string)=>localQuery(`select t.table_name from information_schema.tables t
  where t.table_schema='public' and t.table_type='BASE TABLE'
  and (xpath('/row/n/text()',query_to_xml(format('select count(*) as n from public.%I r where r::text like %L',t.table_name,'%${needle}%'),false,true,'')))[1]::text::int>0`,baseURL).map(row=>row.table_name);
 expect(tablesWith(input.company)).toContain('companies');
 expect(tablesWith(marker)).toEqual([]);
});

test('concurrent submissions leave exactly one account, person, company and Owner; every later submission is 404',async({request,baseURL})=>{
 const submit=(email:string)=>request.post('/first-run/submit',{form:{...input,email},maxRedirects:0});
 const responses=await Promise.all([submit('race-one@example.test'),submit('race-two@example.test')]);
 expect(responses.map(response=>response.status()).sort()).toEqual([303,404]);
 expect(counts(baseURL!)).toEqual({accounts:1,people:1,companies:1,owners:1});
 expect(localQuery(`select count(*)::int winners from auth.users a join public.people p on p.id=a.id join public.members m on m.person_id=p.id join public.companies c on c.id=m.company_id where m.role='owner' and m.removed_at is null`,baseURL)[0]).toEqual({winners:1});
 expect((await request.get('/first-run')).status()).toBe(404);
 expect((await submit('late@example.test')).status()).toBe(404);
 expect(counts(baseURL!)).toEqual({accounts:1,people:1,companies:1,owners:1});
});

test('invalid input creates nothing and a populated installation refuses setup',async({request,baseURL})=>{
 const invalid=await request.post('/first-run/submit',{form:{...input,name:'',language:'ar'},maxRedirects:0});
 expect(invalid.status()).toBe(303);
 expect(invalid.headers().location).toContain('language=ar');
 expect(invalid.headers().location).toContain(`#code=${code}`);
 expect(invalid.headers().location).not.toContain(`?code=`);
 expect(counts(baseURL!)).toEqual({accounts:0,people:0,companies:0,owners:0});
 resetFirstRun(baseURL,true);
 const before=counts(baseURL!);
 expect((await request.get('/first-run')).status()).toBe(404);
 expect((await request.get(`/first-run?code=${code}`)).status()).toBe(404);
 expect((await request.post('/first-run/submit',{form:input,maxRedirects:0})).status()).toBe(404);
 expect(counts(baseURL!)).toEqual(before);
});

// #9: after setup the new Owner is asked one question, alone or with a team, and lands in one Conversation with Lead.
const question={en:'Will you work alone or with a team?',ar:'هتشتغل لوحدك ولا مع تيم؟'};
const choiceNames={en:['Alone','With a team'],ar:['لوحدي','مع تيم']};
const leadLine={en:'I’m Lead and I run your marketing work with you. Need an agent for any job? Tell me in your own words and I’ll make it.',ar:'أنا Lead، بمسك شغل التسويق معاك. محتاج وكيل لأي شغلانة؟ قولّي بكلامك وأنا أعمله.'};
const workspace=(baseURL:string)=>localQuery(`select c.work_mode,
 (select string_agg(a.name||':'||a.is_default,',') from public.hermes_agents a where a.company_id=c.id) agents,
 (select count(*)::int from public.conversations v where v.company_id=c.id) conversations,
 (select count(*)::int from public.work_cards w where w.company_id=c.id) cards
 from public.companies c`,baseURL);
// The worker gives a new Company its own profile and its main Agent, Lead (lib/company-profiles.mjs); the browser suite
// runs without the bundled engine, so the test does that step through the same database function.
const workerAddsLead=(baseURL:string)=>{
 localQuery(`insert into public.company_profiles(company_id,profile,tools_confirmed,tools_pending,skills_shared) select id,public.company_engine_profile(id),true,false,true from public.companies returning company_id`,baseURL);
 return localQuery(`select public.attach_company_profile(id) attached from public.companies`,baseURL);
};

for(const [mode,language] of [['alone','en'],['team','ar']] as const) test(`first run asks only alone or with a team; ${mode} is stored and opens one Conversation with Lead, in ${language} (#9)`,async({page,baseURL})=>{
 await page.goto(`/first-run?language=${language}#code=${code}`);
 await page.locator('select').selectOption(language);
 await fillFirstRun(page,input);
 await page.getByRole('button',{name:/^(Create and sign in|إنشاء وتسجيل الدخول)$/}).click();
 await expect(page).toHaveURL(/\/c\/first-company-[a-f0-9]{8}\/home$/);
 const slug=new URL(page.url()).pathname.split('/')[2];
 await expect(page.getByRole('dialog',{name:question[language]})).toBeVisible();
 // Step 2 names the dialog by its own title (aria-labelledby fr-title), so it is held as the page's one dialog.
 const dialog=page.getByRole('dialog');
 // Exactly two choices and no other question; nothing is stored until one is picked.
 await expect(dialog.getByRole('radio')).toHaveCount(2);
 for(const [index,name] of choiceNames[language].entries()) await expect(dialog.getByRole('radio').nth(index)).toHaveAccessibleName(name);
 await expect(dialog.getByRole('textbox')).toHaveCount(0);
 await expect(dialog.getByRole('combobox')).toHaveCount(0);
 expect(workspace(baseURL!)).toEqual([{work_mode:null,agents:null,conversations:0,cards:0}]);
 expect(workerAddsLead(baseURL!)).toEqual([{attached:true}]);
 await page.reload();
 const open=dialog.getByRole('button',{name:language==='ar'?'افتح المساحة':'Open the workspace'});
 await expect(open).toBeDisabled();
 await dialog.getByRole('radio',{name:choiceNames[language][mode==='alone'?0:1]}).check();
 // A team answers a second step first: who is on it. Alone opens the workspace at once (#186).
 if(mode==='team') {
  await dialog.getByRole('button',{name:language==='ar'?'كمّل':'Continue'}).click();
  await expect(dialog.getByRole('heading',{name:language==='ar'?'مين معاك في التيم؟':'Who’s on your team?'})).toBeVisible();
  await expect(dialog.locator('#fr-email-0')).toBeFocused();
 }
 await open.click();
 await expect(page).toHaveURL(new RegExp(`/c/${slug}/conversations/[0-9a-f-]{36}(\\?first=${mode})?$`));
 // The workspace says it is ready, on the page first run lands on (#169), and the one-time flag leaves the address.
 const ready={alone:{en:'Your workspace is ready: just you and Lead. Tell it what you need an agent for and it makes it',ar:'مساحتك جاهزة: انت وLead بس. قوله محتاج وكيل لإيه وهو يعمله'},
  team:{en:'The workspace is open · start with Lead and ask it for your first agent',ar:'المساحة مفتوحة · ابدأ مع Lead واطلب منه أول وكيل'}} as const;
 await expect(page.locator('.toast')).toHaveText(ready[mode][language]);
 await expect.poll(()=>new URL(page.url()).search).not.toContain('first=');
 expect(workspace(baseURL!)).toEqual([{work_mode:mode,agents:'Lead:true',conversations:1,cards:0}]);
 await expect(page.getByRole('dialog')).toHaveCount(0);
 // One Agent in the list, one chat in the recents, and Lead's first line, which invites asking for an Agent.
 await expect(page.locator('.agent-grid .agent-tile:not(.agent-tile--new)')).toHaveCount(1);
 await expect(page.locator('.agent-grid .agent-tile:not(.agent-tile--new)')).toHaveAccessibleName(new RegExp('^Lead · '));
 await expect(page.locator('#sb-recent .thread-item:not(.ch-item)')).toHaveCount(1);
 await expect(page.locator('#sb-recent .thread-item:not(.ch-item)')).toHaveAttribute('aria-current','true');
 await expect(page.locator('[data-lead-line]')).toHaveText(leadLine[language]);
 // The sentence to try fills the composer, ready to send.
 await page.getByRole('button',{name:language==='ar'?'عايز حد يمسك إعلانات Meta وGoogle':'I want someone to run our Meta and Google ads'}).click();
 await expect(page.getByRole('textbox',{name:/^(Message|الرسالة)$/})).toHaveValue(language==='ar'?'عايز حد يمسك إعلانات Meta وGoogle':'I want someone to run our Meta and Google ads');
 const conversation=page.url();
 // The other language says the same line in its own words.
 const other=language==='ar'?'en':'ar';
 // As tests/choose-language.ts does: the account's language, chosen in the settings overlay, until the page follows it.
 await page.goto(`/c/${slug}/settings?section=account`);
 await expect(async()=>{
  const choice=page.locator(`#ac-lang-${other}`);
  if(await choice.getAttribute('aria-checked')!=='true') await choice.click();
  await expect(page.locator('html')).toHaveAttribute('lang',other,{timeout:3000});
 }).toPass({timeout:30000});
 await page.goto(conversation);
 await expect(page.locator('[data-lead-line]')).toHaveText(leadLine[other]);
 // The board is empty, and the question is not asked again.
 await page.goto(`/c/${slug}/work/board`);
 await expect(page.locator('.board-bare')).toBeVisible();
 await expect(page.locator('.kcard')).toHaveCount(0);
 await page.goto(`/c/${slug}/home`);
 await expect(page.locator('.home-dashboard')).toBeVisible();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(workspace(baseURL!)).toEqual([{work_mode:mode,agents:'Lead:true',conversations:1,cards:0}]);
});

// #186: the Owner signs up and answers first run's second question, "Who’s on your team?".
async function newOwner(page:Page) {
 await page.request.delete(inbox);
 await page.goto(`/first-run?language=en#code=${code}`);
 await fillFirstRun(page,input);
 await page.getByRole('button',{name:'Create and sign in'}).click();
 await expect(page).toHaveURL(/\/c\/first-company-[a-f0-9]{8}\/home$/);
 return new URL(page.url()).pathname.split('/')[2];
}
const invitations=(baseURL:string)=>localQuery(`select email,role from public.member_invitations order by email`,baseURL);
const invitedLog=(baseURL:string)=>localQuery(`select details->>'email' email, details->>'role' role from public.company_log where action='member_invited' order by id`,baseURL);

test('"Open the workspace" with two filled rows makes two invitations with their Roles and two log rows, saves team, and lands in the Owner\'s Conversation with Lead; the mailbox holds both emails (#186)',async({page,baseURL})=>{
 const stamp=Date.now(), first=`nour-${stamp}@example.com`, second=`karim-${stamp}@example.com`;
 const slug=await newOwner(page);
 await expect(page.getByRole('dialog',{name:question.en})).toBeVisible();
 // Step 2 names the dialog by its own title (aria-labelledby fr-title), so it is held as the page's one dialog.
 const dialog=page.getByRole('dialog');
 expect(workspace(baseURL!)).toEqual([{work_mode:null,agents:null,conversations:0,cards:0}]);
 expect(workerAddsLead(baseURL!)).toEqual([{attached:true}]);
 await page.reload();

 await dialog.getByRole('radio',{name:'With a team'}).check();
 await dialog.getByRole('button',{name:'Continue'}).click();
 await dialog.getByRole('button',{name:'Add a member'}).click();
 await dialog.locator('#fr-email-0').fill(first);
 await dialog.locator('#fr-role-0').selectOption('manager');
 await dialog.locator('#fr-email-1').fill(second);
 await dialog.locator('#fr-role-1').selectOption('viewer');
 await dialog.getByRole('button',{name:'Open the workspace'}).click();

 await expect(page).toHaveURL(new RegExp(`/c/${slug}/conversations/[0-9a-f-]{36}`));
 await expect(page.locator('.toast')).toHaveText('Sent 2 invites · start with Lead and ask it for your first agent');
 await expect.poll(()=>new URL(page.url()).search).not.toContain('first=');
 expect(workspace(baseURL!)).toEqual([{work_mode:'team',agents:'Lead:true',conversations:1,cards:0}]);
 // Ordered by email, as the query reads them: karim-… before nour-….
 expect(invitations(baseURL!)).toEqual([{email:second,role:'viewer'},{email:first,role:'manager'}]);
 expect(invitedLog(baseURL!)).toEqual([{email:first,role:'manager'},{email:second,role:'viewer'}]);
 const mailbox=await (await page.request.get(inbox)).json();
 expect((mailbox.messages ?? []).map((message:{To:{Address:string}[]})=>message.To[0].Address).sort()).toEqual([first,second].sort());
});

test('"Back" and Escape return to the question with the team chosen and nothing saved; "Skip" saves team with no invitation (#186)',async({page,baseURL})=>{
 const slug=await newOwner(page);
 await expect(page.getByRole('dialog',{name:question.en})).toBeVisible();
 // Step 2 names the dialog by its own title (aria-labelledby fr-title), so it is held as the page's one dialog.
 const dialog=page.getByRole('dialog');
 expect(workerAddsLead(baseURL!)).toEqual([{attached:true}]);
 await page.reload();

 await dialog.getByRole('radio',{name:'With a team'}).check();
 await dialog.getByRole('button',{name:'Continue'}).click();
 await dialog.getByRole('button',{name:'Back'}).click();
 await expect(dialog.getByRole('radio',{name:'With a team'})).toBeChecked();
 await expect(dialog.getByRole('button',{name:'Continue'})).toBeVisible();
 expect(workspace(baseURL!)).toEqual([{work_mode:null,agents:'Lead:true',conversations:0,cards:0}]);

 await dialog.getByRole('button',{name:'Continue'}).click();
 await page.keyboard.press('Escape');
 await expect(dialog.getByRole('radio',{name:'With a team'})).toBeChecked();
 await expect(dialog.getByRole('button',{name:'Continue'})).toBeVisible();
 expect(workspace(baseURL!)).toEqual([{work_mode:null,agents:'Lead:true',conversations:0,cards:0}]);

 await dialog.getByRole('button',{name:'Continue'}).click();
 await dialog.getByRole('button',{name:'Skip'}).click();
 await expect(page).toHaveURL(new RegExp(`/c/${slug}/conversations/[0-9a-f-]{36}`));
 await expect(page.locator('.toast')).toHaveText('The workspace is open · start with Lead and ask it for your first agent');
 expect(workspace(baseURL!)).toEqual([{work_mode:'team',agents:'Lead:true',conversations:1,cards:0}]);
 expect(invitations(baseURL!)).toEqual([]);
 expect(invitedLog(baseURL!)).toEqual([]);
});

// #130: once the answer is saved the question leaves with the dialog's exit (design-reference: closeDlg, .fr.is-closing)
// and only then does Lead's Conversation take the keyboard; a save that fails keeps the question with its error. Its parts
// rise in the reference's order (.fr__col > *), and with reduced motion nothing rises and it leaves at once.
const recordLeave=(page:Page)=>page.evaluate(()=>{
 const seen:string[][]=[]; Object.assign(window,{seen});
 document.addEventListener('animationstart',event=>{ if(event.animationName==='gw-modal-out') seen.push(['exit',(event.target as Element).className,location.pathname]); });
 document.addEventListener('focusin',event=>{ if((event.target as Element).matches('textarea.composer__input')) seen.push(['composer',location.pathname]); });
 new MutationObserver(()=>{ if(!document.querySelector('.fr-root:not([hidden])')&&!seen.some(([what])=>what==='gone')) seen.push(['gone',location.pathname]); }).observe(document.body,{subtree:true,childList:true,attributes:true});
});
const recorded=(page:Page)=>page.evaluate(()=>(window as unknown as {seen:string[][]}).seen);
for(const motion of ['no-preference','reduce'] as const) test(`the saved answer leaves the question ${motion==='reduce'?'at once':'with the exit'} before Lead's Conversation takes the keyboard, and a failed save stays (#130, reduced motion ${motion})`,async({page,baseURL})=>{
 await page.emulateMedia({reducedMotion:motion});
 const slug=await newOwner(page);
 const dialog=page.getByRole('dialog',{name:question.en});
 await expect(dialog).toBeVisible();
 expect(workerAddsLead(baseURL!)).toEqual([{attached:true}]);
 await page.reload();
 await expect(dialog).toBeVisible();
 const parts=await page.evaluate(()=>['.fr__head','.fr__choices','.fr__actions'].map(part=>{ const style=getComputedStyle(document.querySelector(part)!); return [style.animationName,style.animationDelay,style.animationDuration,style.animationTimingFunction,style.animationFillMode]; }));
 expect(parts).toEqual(motion==='reduce'?[['none','0s','0s','ease','none'],['none','0.04s','0s','ease','none'],['none','0.08s','0s','ease','none']]
  :[['gw-rise','0s','0.28s','cubic-bezier(0.2, 0, 0, 1)','both'],['gw-rise','0.04s','0.28s','cubic-bezier(0.2, 0, 0, 1)','both'],['gw-rise','0.08s','0.28s','cubic-bezier(0.2, 0, 0, 1)','both']]);

 // The answer cannot be saved (it was given elsewhere meanwhile): the question stays with its error and does not leave.
 localQuery(`update public.companies set work_mode='alone' where slug='${slug}' returning id`,baseURL);
 await recordLeave(page);
 await dialog.getByRole('radio',{name:'Alone'}).check();
 await dialog.getByRole('button',{name:'Open the workspace'}).click();
 await expect(dialog.getByRole('alert')).toHaveText('Your answer wasn’t saved. Try again.');
 await page.waitForTimeout(400);
 await expect(page.locator('.fr.is-closing')).toHaveCount(0);
 expect(await recorded(page)).toEqual([]);
 await expect(page).toHaveURL(new RegExp(`/c/${slug}/home$`));

 localQuery(`update public.companies set work_mode=null where slug='${slug}' returning id`,baseURL);
 await dialog.getByRole('button',{name:'Open the workspace'}).click();
 await expect(page).toHaveURL(new RegExp(`/c/${slug}/conversations/[0-9a-f-]{36}`));
 await expect(page.getByRole('textbox',{name:'Message'})).toBeFocused();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 const home=`/c/${slug}/home`;
 const seen=await recorded(page);
 expect(seen.slice(0,2)).toEqual(motion==='reduce'?[['gone',home],['composer',expect.stringMatching(new RegExp(`^/c/${slug}/conversations/`))]]
  :[['exit','fr is-closing',home],['gone',home]]);
 if(motion!=='reduce') expect(seen[2]).toEqual(['composer',expect.stringMatching(new RegExp(`^/c/${slug}/conversations/`))]);
});
