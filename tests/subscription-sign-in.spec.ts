import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { signIn } from './sign-in';

// A company's Owner connects the company's own ChatGPT or Claude subscription through Hermes's sign-in, run in that
// company's Hermes home (#3). The app runs the fake `hermes` of tests/fake-hermes-cli.mjs (playwright.config.ts): it
// prints a link and a code, and stores a credential in the home once the test finishes the sign-in for the person.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const owner='20000000-0000-0000-0000-000000000001';
const company='10000000-0000-0000-0000-000000000001';
const other='10000000-0000-0000-0000-000000000002';
const endpoint='/api/subscription-sign-in';
// The fake's scratch root made by playwright.config.ts for this run. Homes are only ever deleted inside it, and only once
// the app is shown to use it, so a configured HERMES_COMPANY_HOMES is never touched.
const fakeRoot=process.env.GTMWORKS_TEST_HERMES_ROOT!;
const homes=join(fakeRoot,'homes');
const homeOf=(id:string)=>join(homes,id);
const clearHome=(id:string)=>{
 if(!fakeRoot||dirname(resolve(fakeRoot))!==resolve(tmpdir())||!basename(fakeRoot).startsWith('gtmworks-fake-hermes-')||process.env.HERMES_COMPANY_HOMES!==homes) throw new Error('Refusing to delete outside the fake Hermes scratch root');
 rmSync(homeOf(id),{recursive:true,force:true});
};
// HERMES_COMMAND is one program path, run as it is and never split.
const listed=(id:string)=>execFileSync(process.env.HERMES_COMMAND!,['auth','list'],{env:{...process.env,HERMES_HOME:homeOf(id)},encoding:'utf8'});
// Every table in the database that holds the text, found without knowing the table in advance.
const tablesHolding=(text:string)=>JSON.parse(query(`select table_schema||'.'||table_name as name from information_schema.tables where table_schema in ('public','auth','storage') and table_type='BASE TABLE' and query_to_xml(format('select 1 from %I.%I x where x::text like %L limit 1',table_schema,table_name,'%${text}%'),false,true,'')::text<>''`));

test('the Owner connects ChatGPT, sees the code and the link, then Connected, and the credential stays in the company Hermes home',async({page})=>{
 clearHome(company);
 try {
  query(`delete from auth.mfa_factors where user_id='${owner}'`);
  query(`update public.people set language='en' where id='${owner}'`);
  await signIn(page,'omar@example.com','/c/rs-learning/settings');
  const panel=page.getByRole('region',{name:'Model subscription'});
  const chatgpt=panel.locator('.detail-row').filter({hasText:'ChatGPT'});
  await expect(chatgpt.getByRole('status')).toHaveText('Not connected');
  await panel.getByRole('button',{name:'Connect ChatGPT'}).click();
  await expect(chatgpt.getByRole('status')).toHaveText('Waiting for you to finish signing in');
  await expect(chatgpt.locator('code')).toHaveText('WXYZ-4K8M');
  await expect(chatgpt.getByRole('link',{name:'https://auth.example.test/device?provider=openai-codex'})).toHaveAttribute('href','https://auth.example.test/device?provider=openai-codex');

  // The person finishes signing in; the panel notices on its own.
  const answers:string[]=[];
  page.on('response',async response=>{ if(response.url().includes(endpoint)) answers.push(await response.text()); });
  writeFileSync(join(homeOf(company),'.finish-openai-codex'),'');
  await expect(chatgpt.getByRole('status')).toHaveText('Connected',{timeout:15000});
  await expect(panel.locator('.detail-row').filter({hasText:'Claude'}).getByRole('status')).toHaveText('Not connected');

  // The credential is stored in this company's home, which `auth list` there reports, and in no other home.
  const secret=JSON.parse(readFileSync(join(homeOf(company),'auth.json'),'utf8'))['openai-codex'][0].access_token as string;
  expect(secret).toMatch(/^fake-subscription-secret-/);
  expect(listed(company)).toMatch(/^openai-codex \(1 credential\):/m);
  expect(existsSync(join(homeOf(other),'auth.json'))).toBe(false);
  answers.push(await (await page.request.get(`${endpoint}?company=${company}`)).text());
  expect(answers.length).toBeGreaterThan(1);
  for(const answer of answers) expect(answer).not.toContain(secret);
  expect(tablesHolding(secret)).toEqual([]);
  expect(readFileSync('playwright-report/server.log','utf8')).not.toContain(secret);

  await panel.getByRole('button',{name:'Disconnect ChatGPT'}).click();
  await expect(chatgpt.getByRole('status')).toHaveText('Not connected');
  expect(listed(company)).not.toContain('openai-codex');
  // `auth remove` got the credential's id as its target, and the credential is gone from the home.
  expect(readFileSync(join(homeOf(company),'.seen-remove'),'utf8')).toMatch(/"argv":\["auth","remove","openai-codex","[0-9a-f]+"\]/);
  expect(JSON.parse(readFileSync(join(homeOf(company),'auth.json'),'utf8'))).toEqual({});
 } finally {
  clearHome(company);
  query(`update public.people set language='en' where id='${owner}'`);
 }
});

test('the Owner connects Claude by pasting the code it shows, and the code is kept nowhere',async({page})=>{
 const authorizationCode='fake-authorization-code-7Q2P';
 clearHome(company);
 try {
  query(`delete from auth.mfa_factors where user_id='${owner}'`);
  query(`update public.people set language='en' where id='${owner}'`);
  await signIn(page,'omar@example.com','/c/rs-learning/settings');
  const answers:string[]=[];
  page.on('response',async response=>{ if(response.url().includes(endpoint)) answers.push(await response.text()); });
  const panel=page.getByRole('region',{name:'Model subscription'});
  const claude=panel.locator('.detail-row').filter({hasText:'Claude'});
  await panel.getByRole('button',{name:'Connect Claude'}).click();
  await expect(claude.getByRole('status')).toHaveText('Waiting for you to finish signing in');
  await expect(claude.getByRole('link',{name:'https://auth.example.test/oauth/authorize?provider=anthropic'})).toBeVisible();
  await expect(claude.locator('code')).toHaveCount(0);
  await claude.getByLabel('Authorization code').fill(authorizationCode);
  await claude.getByRole('button',{name:'Finish signing in'}).click();
  await expect(claude.getByRole('status')).toHaveText('Connected',{timeout:15000});
  expect(listed(company)).toMatch(/^anthropic \(1 credential\):/m);

  // The code reached Hermes only on its input: not in its arguments or environment, an answer, a row or the log.
  expect(readFileSync(join(homeOf(company),'.seen-add'),'utf8')).not.toContain(authorizationCode);
  answers.push(await (await page.request.get(`${endpoint}?company=${company}`)).text());
  for(const answer of answers) expect(answer).not.toContain(authorizationCode);
  expect(tablesHolding(authorizationCode)).toEqual([]);
  expect(readFileSync('playwright-report/server.log','utf8')).not.toContain(authorizationCode);

  await panel.getByRole('button',{name:'Disconnect Claude'}).click();
  await expect(claude.getByRole('status')).toHaveText('Not connected');
  expect(listed(company)).not.toContain('anthropic (');
 } finally {
  clearHome(company);
  query(`update public.people set language='en' where id='${owner}'`);
 }
});

test('a Member who is not the Owner sees no sign-in, and the server refuses it to them',async({page})=>{
 await signIn(page,'manager@example.com','/c/rs-learning/settings');
 await expect(page.getByRole('heading',{name:'Company settings'})).toBeVisible();
 await expect(page.getByRole('region',{name:'Model subscription'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Connect ChatGPT'})).toHaveCount(0);
 const started=await page.request.post(endpoint,{data:{company,provider:'openai-codex',intent:'connect'}});
 expect(started.status()).toBe(403);
 expect(await started.json()).toEqual({error:'subscriptionOwnerOnly'});
 expect((await page.request.get(`${endpoint}?company=${company}`)).status()).toBe(403);
 const completed=await page.request.post(endpoint,{data:{company,provider:'anthropic',intent:'complete',authorizationCode:'fake-authorization-code-7Q2P'}});
 expect(completed.status()).toBe(403);
 expect(await completed.json()).toEqual({error:'subscriptionOwnerOnly'});
 expect(existsSync(join(homeOf(company),'.env-add'))).toBe(false);
 // A company the Member does not belong to is not found, not refused.
 expect((await page.request.get(`${endpoint}?company=${other}`)).status()).toBe(404);
});
