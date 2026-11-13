import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fakeHermes } from './fake-hermes.mjs';
import { signIn } from './sign-in';
import { i18n } from '../lib/i18n.mjs';

const company='10000000-0000-0000-0000-000000000001';
const owner='20000000-0000-0000-0000-000000000001';
const endpoint='/api/hermes-connections';
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>JSON.parse(query(sql));
// Omar is RS Learning's Owner, so he manages its agent engine with no extra step.
async function signInOwner(page:Page) {
 query(`update public.people set language='en' where id='${owner}'`);
 await signIn(page,'omar@example.com','/c/rs-learning/settings/agents');
}

test('saving a public HTTP Hermes connection requires HTTPS without contacting Hermes',async({page})=>{
 const fake=await fakeHermes(); const profile=`blocked-${randomUUID()}`;
 try {
  await signInOwner(page);
  for(const language of ['en','ar'] as const) {
   query(`update public.people set language='${language}' where id='${owner}'`);
   await page.reload();
   const {t}=i18n(language); const panel=page.getByRole('region',{name:t('hermesConnection')});
   await panel.getByLabel(t('hermesAddress')).fill('http://example.com');
   await panel.getByLabel(t('hermesProfile')).fill(profile);
   await panel.getByLabel(t('hermesKey'),{exact:true}).fill(fake.settings.key);
   const responsePromise=page.waitForResponse(response=>response.url().endsWith(endpoint)&&response.request().method()==='POST');
   await panel.getByRole('button',{name:t('hermesSave'),exact:true}).click();
   const response=await responsePromise;
   expect(response.status()).toBe(400);
   expect(await response.json()).toEqual({error:'hermesHttpsRequired'});
   await expect(panel.getByRole('alert')).toHaveText(t('hermesHttpsRequired'));
   await expect(panel.getByRole('alert')).toContainText('https');
   expect(fake.settings.requests).toEqual([]);
   expect(rows(`select id from public.hermes_connections where company_id='${company}' and profile='${profile}'`)).toEqual([]);
  }
 } finally {
  query(`delete from public.hermes_connections where company_id='${company}' and profile='${profile}'`);
  query(`update public.people set language='en' where id='${owner}'`);
  await fake.close();
 }
});

test('testing a saved public HTTP Hermes connection refuses before decrypting or sending its key',async({page})=>{
 const fake=await fakeHermes(); const id=randomUUID();
 try {
  await signInOwner(page);
  // Invalid ciphertext makes an attempted decryption fail with the generic error instead.
  query(`insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${id}','${company}','${owner}','http://example.com','writer','invalid-ciphertext','connected')`);
  const response=await page.request.post(endpoint,{data:{company,id,intent:'test'}});
  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({error:'hermesHttpsRequired'});
  expect(fake.settings.requests).toEqual([]);
  expect(rows(`select state from public.hermes_connections where id='${id}'`)).toEqual([{state:'connected'}]);
 } finally {
  query(`delete from public.hermes_connections where id='${id}'`);
  await fake.close();
 }
});

test('a saved Connection keeps its address and profile: replacing either is refused before any engine is contacted',async({page})=>{
 const first=await fakeHermes(),second=await fakeHermes(); const id=randomUUID();
 try {
  await signInOwner(page);
  // No company agent uses this Connection, so nothing but the fixed destination stops a retarget.
  query(`insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${id}','${company}','${owner}','${first.address}','writer','invalid-ciphertext','connected')`);
  for(const change of [{address:second.address,profile:'writer'},{address:first.address,profile:'other'}]) {
   const response=await page.request.post(endpoint,{data:{company,id,intent:'save',key:randomUUID(),...change}});
   expect(response.status()).toBe(409);
   expect(await response.json()).toEqual({error:'hermesDestinationFixed'});
  }
  expect(first.settings.requests).toEqual([]); expect(second.settings.requests).toEqual([]);
  expect(rows(`select address,profile from public.hermes_connections where id='${id}'`)).toEqual([{address:first.address,profile:'writer'}]);
 } finally {
  query(`delete from public.hermes_connections where id='${id}'`);
  await first.close(); await second.close();
 }
});

test('save, replace, retest and remove a write-only Hermes Connection; refuse wrong keys, outages and untested versions',async({page})=>{
 const fake=await fakeHermes(); const savedKey=randomUUID(),replacementKey=randomUUID(); fake.settings.key=savedKey;
 const captured:string[]=[];
 page.on('console',message=>captured.push(message.text())); page.on('pageerror',error=>captured.push(error.message));
 const post=async(body:object)=>{
  const response=await page.request.post(endpoint,{data:{company,...body}}); captured.push(await response.text()); return response;
 };
 let id='';
 try {
  await signInOwner(page);
  const panel=page.getByRole('region',{name:'Agent engine connection'});
  await panel.getByLabel('Agent engine address').fill(fake.address); await panel.getByLabel('Profile name').fill('writer'); await panel.getByLabel('Profile API key').fill(savedKey);
  const responsePromise=page.waitForResponse(response=>response.url().endsWith(endpoint)&&response.request().method()==='POST');
  await panel.getByRole('button',{name:'Save and test connection',exact:true}).click();
  const savedResponse=await responsePromise; captured.push(await savedResponse.text());
  expect(savedResponse.status()).toBe(200); id=(await savedResponse.json()).connection.id;
  await expect(panel.getByRole('status')).toHaveText('Connected'); await expect(panel.getByLabel('Profile API key').first()).toHaveValue('');
  const stored=rows(`select key_encrypted from public.hermes_connections where id='${id}'`)[0].key_encrypted;
  expect(stored===savedKey||stored.includes(savedKey)).toBe(false); expect(stored.split('.')).toHaveLength(3);
  for(const suffix of [`?company=${company}`,`?company=${company}&id=${id}`]) {
   const read=await page.request.get(endpoint+suffix); expect(read.status()).toBe(200); captured.push(await read.text());
  }
  await page.reload(); captured.push(await page.content());
  const testConnection=async()=>{const response=await post({intent:'test',id}); expect(response.status()).toBe(200); return (await response.json()).connection;};
  fake.settings.key=replacementKey;
  expect((await testConnection()).state).toBe('refused');
  await page.reload(); await expect(panel.getByRole('status')).toContainText('The agent engine refused the key');
  const replaced=await post({intent:'save',id,address:fake.address,profile:'writer',key:replacementKey});
  expect((await replaced.json()).connection.state).toBe('connected');
  fake.settings.version='0.24.0';
  const unknown=await testConnection(); expect(unknown.state).toBe('untested_version'); expect(unknown.features).toEqual([]);
  await page.reload(); await expect(panel.getByRole('status')).toContainText('This agent engine version is untested');
  fake.settings.status=503;
  const outage=await testConnection(); expect(outage.state).toBe('unreachable'); expect(outage.unreachable_since).toBeTruthy();
  expect((await testConnection()).unreachable_since).toBe(outage.unreachable_since);
  await page.reload(); await expect(panel.getByRole('status')).toContainText('The agent engine is unreachable since');
  fake.settings.status=200; fake.settings.version='0.23.0'; expect((await testConnection()).state).toBe('connected');
  const removed=await post({intent:'remove',id}); expect(removed.status()).toBe(200);
  const missing=await page.request.get(`${endpoint}?company=${company}&id=${id}`); captured.push(await missing.text()); expect(missing.status()).toBe(404);
  expect((await post({intent:'save',address:savedKey,profile:'writer',key:replacementKey})).status()).toBe(400);
  captured.push(readFileSync('playwright-report/server.log','utf8'));
  expect(captured.some(text=>text.includes(savedKey)||text.includes(replacementKey))).toBe(false);
 } finally {
  if(id) query(`delete from public.hermes_connections where id='${id}'`);
  await fake.close();
 }
});

test('any Owner of the company reads and manages a Connection; other roles and an Owner of another company cannot mutate or discover it',async({browser})=>{
 test.setTimeout(120000);
 const id=randomUUID();
 const manager='20000000-0000-0000-0000-000000000002',multi='20000000-0000-0000-0000-000000000005',aleem='10000000-0000-0000-0000-000000000003';
 query(`insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${id}','${company}','${owner}','http://127.0.0.1','writer','ciphertext','connected')`);
 // The Owner comes last: it removes the Connection that Omar, another Owner, made.
 const roles=[['manager@example.com',manager,'manager'],['agent1@example.com','30000000-0000-0000-0000-000000000001','contributor'],['reviewer@example.com','20000000-0000-0000-0000-000000000003','contributor'],['viewer@example.com','20000000-0000-0000-0000-000000000004','viewer'],['manager@example.com',manager,'owner']];
 try {
  for(const [email,person,role] of roles) {
   query(`update public.members set role='${role}' where company_id='${company}' and person_id='${person}'`);
   const context=await browser.newContext(); const page=await context.newPage();
   try {
    await signIn(page,email,'/c/rs-learning/settings/agents');
    const response=await page.request.get(`${endpoint}?company=${company}&id=${id}`);
    expect(response.status()).toBe(role==='owner'?200:404);
    if(role==='owner') {
     expect(Object.hasOwn((await response.json()).connection,'key_encrypted')).toBe(false); await expect(page.getByText('Connected',{exact:true})).toBeVisible();
     const removed=await page.request.post(endpoint,{data:{company,id,intent:'remove'}});
     expect(removed.status()).toBe(200);
     expect(rows(`select id from public.hermes_connections where id='${id}'`)).toEqual([]);
     continue;
    }
    if(role==='manager') await expect(page.getByText('Only an Owner of this company can manage the agent engine.')).toBeVisible();
    for(const intent of ['save','test','remove']) {
     const denied=await page.request.post(endpoint,{data:{company,id,intent,address:'http://127.0.0.1',profile:'writer',key:'forbidden'}});
     expect(denied.status()).toBe(404);
    }
    const refused=await page.request.post(endpoint,{data:{company,intent:'save',address:'http://127.0.0.1',profile:'writer',key:'forbidden'}});
    expect(refused.status()).toBe(403); expect(await refused.json()).toEqual({error:'hermesNotAllowed'});
    expect(rows(`select id from public.hermes_connections where id='${id}'`)).toEqual([{id}]);
   } finally { await context.close(); }
  }
  // An Owner of another company (Aleem) who is only a Contributor here neither finds nor changes this company's Connection.
  query(`insert into public.hermes_connections(id,company_id,owner_id,address,profile,key_encrypted,state) values ('${id}','${company}','${owner}','http://127.0.0.1','writer','ciphertext','connected')`);
  query(`update public.members set role='owner' where company_id='${aleem}' and person_id='${multi}'`);
  const context=await browser.newContext(); const page=await context.newPage();
  try {
   await signIn(page,'multi@example.com','/c/aleem/settings/agents');
   expect((await page.request.get(`${endpoint}?company=${company}&id=${id}`)).status()).toBe(404);
   for(const intent of ['save','test','remove']) expect((await page.request.post(endpoint,{data:{company,id,intent}})).status()).toBe(404);
   expect(rows(`select id from public.hermes_connections where id='${id}'`)).toEqual([{id}]);
  } finally { await context.close(); }
 } finally {
  query(`delete from public.hermes_connections where id='${id}'`);
  query(`update public.members set role='contributor' where company_id='${aleem}' and person_id='${multi}'`);
  query(`update public.members set role='manager' where company_id='${company}' and person_id='${manager}'`);
 }
});
