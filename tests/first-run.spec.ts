import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localQuery, resetFirstRun } from '../scripts/first-run-db.mjs';
import { followSignInLink } from './sign-in';

// The install's setup code (playwright.config.ts), as the installer's setup link carries it (issue #50).
const code=process.env.SETUP_CODE!;
const input={name:'First owner',email:'first-owner@example.test',company:'First Company',language:'en',code};
const counts=(baseURL:string)=>localQuery(`select
 (select count(*)::int from auth.users) accounts,
 (select count(*)::int from public.people) people,
 (select count(*)::int from public.companies) companies,
 (select count(*)::int from public.members where role='owner') owners`,baseURL)[0];
test.beforeEach(({baseURL})=>resetFirstRun(baseURL));
test.afterEach(async({},testInfo)=>{
 if(testInfo.status===testInfo.expectedStatus) return;
 const log=await readFile(join(process.cwd(),'playwright-report/server.log'),'utf8').catch(error=>{
  if(error.code==='ENOENT') return '';
  throw error;
 });
 const lines=log.split(/\r?\n/).filter(line=>/first.run|setup|complete_setup|createUser|server_action_failed/.test(line)).slice(-40);
 if(lines.length) console.log(`[first-run server log]\n${lines.join('\n')}`);
});
test.afterAll(({baseURL})=>resetFirstRun(baseURL,true));

test('empty install creates its Agency owner and first company, then opens Home through the email link',async({page,baseURL})=>{
 await page.request.delete('http://127.0.0.1:54324/api/v1/messages');
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
 await page.getByLabel('Your name').fill(input.name);
 await page.getByLabel('Email',{exact:true}).fill(input.email);
 await page.getByLabel('First company name').fill(input.company);
 await page.locator('select').selectOption('ar');
 await page.getByRole('button',{name:'إنشاء وإرسال رابط تسجيل الدخول'}).click();
 await expect(page.locator('html')).toHaveAttribute('lang','ar');
 await expect(page.getByRole('status')).toHaveText('تحقق من بريدك الإلكتروني للحصول على رابط تسجيل الدخول.');
 // Two requests carry it, both in a submit body: the page's check that the code is right, then the submission.
 const carrying=requests.filter(request=>request.url.includes(code) || request.body?.includes(code));
 expect(carrying.map(request=>request.url)).toEqual([`${baseURL}/first-run/submit`,`${baseURL}/first-run/submit`]);
 for(const request of carrying) expect(new URLSearchParams(request.body!).get('code')).toBe(code);
 await followSignInLink(page,input.email);
 await expect(page).toHaveURL(/\/c\/first-company-[a-f0-9]{8}\/home$/);
 await expect(page.locator('.home-dashboard')).toBeVisible();
 await expect(page.getByLabel('اختيار الشركة')).toContainText(input.company);
 expect(counts(baseURL!)).toEqual({accounts:1,people:1,companies:1,owners:1});
 expect(localQuery('select agency_owner,language from public.people',baseURL)[0]).toEqual({agency_owner:true,language:'ar'});
 expect((await page.request.get('/first-run')).status()).toBe(404);
 // The code worked once: after setup the same link and a second submission with it are refused.
 expect((await page.request.get(`/first-run?code=${code}`)).status()).toBe(404);
 expect((await page.request.post('/first-run/submit',{form:{...input,email:'second@example.test'},maxRedirects:0})).status()).toBe(404);
 expect(counts(baseURL!)).toEqual({accounts:1,people:1,companies:1,owners:1});
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
  await expect(page.getByRole('button',{name:'Create and send sign-in link'}),fragment).toHaveCount(0);
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
 await expect(page.getByRole('button',{name:'Create and send sign-in link'})).toBeVisible();
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

test('concurrent submissions leave exactly one account, person, company and Owner; every later submission is 404',async({request,baseURL})=>{
 const submit=(email:string)=>request.post('/first-run/submit',{form:{...input,email},maxRedirects:0});
 const responses=await Promise.all([submit('race-one@example.test'),submit('race-two@example.test')]);
 expect(responses.map(response=>response.status()).sort()).toEqual([303,404]);
 expect(counts(baseURL!)).toEqual({accounts:1,people:1,companies:1,owners:1});
 expect(localQuery(`select count(*)::int winners from auth.users a join public.people p on p.id=a.id join public.members m on m.person_id=p.id join public.companies c on c.id=m.company_id where p.agency_owner and m.role='owner'`,baseURL)[0]).toEqual({winners:1});
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
