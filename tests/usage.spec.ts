import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fakeHermes } from './fake-hermes.mjs';
import { signIn } from './sign-in';

const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
// Omar signs in as the Owner of all three seeded companies.
async function ownerSignIn(page:Page) {
 query(`update public.people set language='en' where id='${omar}'`);
 await signIn(page,'omar@example.com','/c/rs-learning/home');
}
const company='10000000-0000-0000-0000-000000000001';
const aleem='10000000-0000-0000-0000-000000000003';
const omar='20000000-0000-0000-0000-000000000001';
const manager='20000000-0000-0000-0000-000000000002';
type Fake=Awaited<ReturnType<typeof fakeHermes>>;
type Total={input:number,output:number,unknown:number};

// One agent on its own profile of the fake Hermes; removed again after the test.
async function attachAgent(page:Page,fake:Fake) {
 const saved=await page.request.post('/api/hermes-connections',{data:{company,intent:'save',address:fake.address,profile:`usage-${randomUUID().slice(0,8)}`,key:fake.settings.key}});
 expect(saved.status()).toBe(200); const connection=(await saved.json()).connection.id as string;
 const attached=await page.request.post('/api/hermes-agents',{data:{company,intent:'attach',connection,name:'Mona',speciality:'Marketing',makeDefault:true}});
 expect(attached.status()).toBe(200);
 return {id:(await attached.json()).agents.find((agent:{connection_id:string})=>agent.connection_id===connection).id as string,connection};
}
const detach=(agent?:{id:string,connection:string})=>{ if(!agent) return; query(`delete from public.hermes_agents where id='${agent.id}'`); query(`delete from public.hermes_connections where id='${agent.connection}'`); };
const send=(page:Page,conversation:string,message:string)=>page.request.post('/api/conversations',{data:{company,conversation,message,sendKey:randomUUID()}});
const read=async(page:Page,conversation:string)=>(await page.request.get(`/api/conversations?company=${company}&conversation=${conversation}`)).json() as Promise<{messages:{author:string}[],usage:Total,failed:boolean}>;
const stored=(conversation:string)=>JSON.parse(query(`select outcome,input_tokens,output_tokens from public.conversation_usage where conversation_id='${conversation}' order by recorded_at,run_id`));
test.use({actionTimeout:15000});

test('integration: two completed replies store their tokens and the conversation shows the running total',async({page})=>{
 test.setTimeout(120000);
 const fake=await fakeHermes(); let agent;
 try {
  await ownerSignIn(page); agent=await attachAgent(page,fake);
  const conversation=randomUUID();
  fake.settings.usage={input_tokens:14000,output_tokens:12};
  expect((await send(page,conversation,'Plan the launch week')).status()).toBe(200);
  expect((await read(page,conversation)).usage).toEqual({input:14000,output:12,unknown:0});
  fake.settings.usage={input_tokens:15000,output_tokens:20};
  expect((await send(page,conversation,'Now the teaser')).status()).toBe(200);
  const second=await read(page,conversation);
  expect(second.messages.map(message=>message.author)).toEqual(['person','agent','person','agent']);
  expect(second.usage).toEqual({input:29000,output:32,unknown:0});
  expect(stored(conversation)).toEqual([{outcome:'completed',input_tokens:14000,output_tokens:12},{outcome:'completed',input_tokens:15000,output_tokens:20}]);
  await page.goto(`/c/rs-learning/conversations/${conversation}`);
  await expect(page.locator('[data-usage]')).toHaveText('29,032 tokens used (29,000 in, 32 out)');
 } finally { detach(agent); await fake.close(); }
});

test('integration: a stopped run keeps what Hermes reported and a lost run records unknown usage, never zero',async({page})=>{
 test.setTimeout(120000);
 const fake=await fakeHermes(); let agent;
 try {
  await ownerSignIn(page); agent=await attachAgent(page,fake);
  const conversation=randomUUID();
  fake.settings.ending='cancelled'; fake.settings.usage={input_tokens:900,output_tokens:7};
  expect((await send(page,conversation,'Stop after a while')).status()).toBe(200);
  const stopped=await read(page,conversation);
  expect(stopped).toMatchObject({failed:true,usage:{input:900,output:7,unknown:0}});
  expect(stopped.messages.map(message=>message.author)).toEqual(['person']);
  // Hermes restarted and no longer knows the second run.
  fake.settings.ending='completed';
  expect((await send(page,conversation,'Try again')).status()).toBe(200);
  fake.settings.runs.length=0;
  expect((await read(page,conversation)).usage).toEqual({input:900,output:7,unknown:1});
  expect(stored(conversation)).toEqual([{outcome:'stopped',input_tokens:900,output_tokens:7},{outcome:'lost',input_tokens:null,output_tokens:null}]);
  await page.goto(`/c/rs-learning/conversations/${conversation}`);
  await expect(page.locator('[data-usage]')).toHaveText('907 tokens used (900 in, 7 out) · usage unknown for 1 replies');
  // Reopened, the page still says the latest reply did not finish.
  await expect(page.locator('.convo-status[role=alert]')).toHaveText('The agent could not finish this reply. Send the message again to retry.');
 } finally { detach(agent); await fake.close(); }
});

test('an Owner of several companies sees each one\'s tokens per day, and an Owner of one company only their own',async({page,browser})=>{
 test.setTimeout(120000);
 // A day no other test writes to, so the rows are this test's own.
 const day=new Date(Date.UTC(2001,0,1)+Math.floor(Math.random()*9000)*86400000).toISOString().slice(0,10);
 const [rs,other]=[randomUUID(),randomUUID()];
 query(`insert into public.conversations(id,company_id,person_id,agent_name) values ('${rs}','${company}','${omar}','Mona'),('${other}','${aleem}','${omar}','Sara')`);
 query(`insert into public.conversation_usage(company_id,conversation_id,run_id,outcome,input_tokens,output_tokens,recorded_at) values ('${company}','${rs}','run_a','completed',1200,34,'${day}T08:00Z'),('${company}','${rs}','run_b','lost',null,null,'${day}T09:00Z'),('${aleem}','${other}','run_c','completed',5000,60,'${day}T10:00Z')`);
 const rowsOn=(viewer:Page)=>viewer.getByRole('row').filter({hasText:day});
 await ownerSignIn(page);
 await page.goto('/c/rs-learning/settings');
 await page.getByRole('link',{name:'Usage',exact:true}).click();
 // Usage is a section of the settings overlay (#26), with the same table.
 await expect(page).toHaveURL(/\/c\/rs-learning\/settings\?section=usage$/);
 await expect(rowsOn(page)).toHaveCount(2);
 await expect(rowsOn(page).filter({hasText:'RS Learning'}).getByRole('cell')).toHaveText(['RS Learning',day,'1,200','34','2','1']);
 await expect(rowsOn(page).filter({hasText:'Aleem'}).getByRole('cell')).toHaveText(['Aleem',day,'5,000','60','1','0']);
 query(`update public.members set role='owner' where company_id='${company}' and person_id='${manager}'`);
 const context=await browser.newContext(); const owner=await context.newPage();
 try {
  await signIn(owner,'manager@example.com','/c/rs-learning/usage');
  await expect(owner.getByRole('table')).toBeVisible();
  await expect(rowsOn(owner)).toHaveCount(1);
  await expect(rowsOn(owner).getByRole('cell')).toHaveText(['RS Learning',day,'1,200','34','2','1']);
  expect((await owner.goto('/c/aleem/usage'))!.status()).toBe(404);
 } finally { await context.close(); query(`update public.members set role='manager' where company_id='${company}' and person_id='${manager}'`); }
});
