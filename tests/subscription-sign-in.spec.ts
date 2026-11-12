import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { signIn } from './sign-in';

// A company's Owner connects the company's own ChatGPT or Claude subscription through Hermes's sign-in, run in that
// company's Hermes home (#3). The app runs the fake `hermes` of tests/fake-hermes-cli.mjs (playwright.config.ts): it
// prints a link and a code, and stores a credential in the home once the test finishes the sign-in for the person.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const owner='20000000-0000-0000-0000-000000000001';
const company='10000000-0000-0000-0000-000000000001';
const other='10000000-0000-0000-0000-000000000002';
const endpoint='/api/subscription-sign-in';
const homeOf=(id:string)=>join(process.env.HERMES_COMPANY_HOMES!,id);
const [program,...leading]=process.env.HERMES_COMMAND!.split(' ');
const listed=(id:string)=>execFileSync(program,[...leading,'auth','list'],{env:{...process.env,HERMES_HOME:homeOf(id)},encoding:'utf8'});
// Every table in the database that holds the text, found without knowing the table in advance.
const tablesHolding=(text:string)=>JSON.parse(query(`select table_schema||'.'||table_name as name from information_schema.tables where table_schema in ('public','auth','storage') and table_type='BASE TABLE' and query_to_xml(format('select 1 from %I.%I x where x::text like %L limit 1',table_schema,table_name,'%${text}%'),false,true,'')::text<>''`));

test('the Owner connects ChatGPT, sees the code and the link, then Connected, and the credential stays in the company Hermes home',async({page})=>{
 rmSync(homeOf(company),{recursive:true,force:true});
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

  const secret=JSON.parse(readFileSync(join(homeOf(company),'auth.json'),'utf8'))['openai-codex'].access_token as string;
  expect(listed(company)).toContain(secret);
  expect(existsSync(join(homeOf(other),'auth.json'))).toBe(false);
  answers.push(await (await page.request.get(`${endpoint}?company=${company}`)).text());
  expect(answers.length).toBeGreaterThan(1);
  for(const answer of answers) expect(answer).not.toContain(secret);
  expect(tablesHolding(secret)).toEqual([]);
  expect(readFileSync('playwright-report/server.log','utf8')).not.toContain(secret);

  await panel.getByRole('button',{name:'Disconnect ChatGPT'}).click();
  await expect(chatgpt.getByRole('status')).toHaveText('Not connected');
  expect(listed(company)).not.toContain('openai-codex');
 } finally {
  rmSync(homeOf(company),{recursive:true,force:true});
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
 expect(existsSync(join(homeOf(company),'.env-add'))).toBe(false);
 // A company the Member does not belong to is not found, not refused.
 expect((await page.request.get(`${endpoint}?company=${other}`)).status()).toBe(404);
});
