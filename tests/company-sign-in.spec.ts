import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { signIn } from './sign-in';

// A company connects its own ChatGPT subscription in its own Hermes profile (#3, ADR 0014). Against a fake Hermes,
// the Owner sees the code and the link, the page says Connected once the sign-in finishes, and Disconnect removes it
// from that profile; a member sees the state only, with no button, and the server refuses them too.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const aleem='10000000-0000-0000-0000-000000000003';
const omar='20000000-0000-0000-0000-000000000001';
const member='20000000-0000-0000-0000-000000000005';
const profile='co-10000000000000000000000000000003';

test('the Owner signs the company in to ChatGPT and out again; a member only sees whether it is connected',async({page,browser})=>{
 // The driver reaches the management listener on port 9119 of the Hermes address, as in the install.
 const fake=await fakeHermes({managementPort:9119});
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 const languages=JSON.parse(query(`select id,language from public.people where id in ('${omar}','${member}')`)) as {id:string,language:string}[];
 const agent=randomUUID();
 let connection='';
 try {
  query(`update public.people set language='en' where id in ('${omar}','${member}')`);
  await signIn(page,'omar@example.com','/c/aleem/settings?section=models');
  // The bundled Connection to the company's own profile, saved through the Owner's own route (its key encrypted), then
  // marked as the worker's (its audit row) with the profile recorded, as the worker leaves them.
  const saved=await page.request.post('/api/hermes-connections',{data:{company:aleem,intent:'save',address:fake.address,profile,key:fake.settings.key}});
  expect(saved.status()).toBe(200); connection=(await saved.json()).connection.id;
  query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality) values ('${agent}','${aleem}','${connection}','Lead','General')`);
  query(`insert into public.hermes_agent_audit(company_id,actor_id,agent_id,action,details) values ('${aleem}','${omar}','${agent}','PROVIDE_BUNDLED_HERMES_AGENT',jsonb_build_object('connection_id','${connection}'))`);
  query(`insert into public.company_profiles(company_id,profile,tools_level) values ('${aleem}','${profile}',1)`);

  // A member: the state, no button, and the server refuses a start.
  const context=await browser.newContext(); const other=await context.newPage();
  await signIn(other,'multi@example.com','/c/aleem/settings?section=models');
  const memberChatgpt=other.locator('#sub-openai-codex');
  await expect(memberChatgpt.getByText('Not connected')).toBeVisible();
  await expect(other.locator('#md-subscriptions').getByRole('button')).toHaveCount(0);
  const refused=await other.request.post('/api/company-sign-in',{data:{company:aleem,provider:'openai-codex',intent:'start'}});
  expect(refused.status()).toBe(403);
  expect(fake.settings.signInSessions.size).toBe(0);
  await context.close();

  // The Owner: the code and the link, then Connected.
  await page.goto('/c/aleem/settings?section=models');
  const chatgpt=page.locator('#sub-openai-codex');
  await expect(chatgpt.getByText('Not connected')).toBeVisible();
  await chatgpt.getByRole('button',{name:'Connect ChatGPT'}).click();
  await expect(chatgpt.getByText('ABCD-1234')).toBeVisible();
  await expect(chatgpt.getByRole('link',{name:'Open the sign-in page'})).toHaveAttribute('href','https://auth.openai.com/codex/device');
  const [session]=[...fake.settings.signInSessions.keys()];
  expect(fake.settings.signInSessions.get(session)?.profile).toBe(profile);
  fake.settings.approve(session);
  await expect(chatgpt.getByText('Connected',{exact:true})).toBeVisible({timeout:20000});
  // The credential is in that company's profile only, and the page never shows it.
  const credential=fake.settings.profiles.get(profile)!.credentials['openai-codex'];
  expect(credential).toBeTruthy();
  expect(await page.content()).not.toContain(credential.slice(-6));
  // Claude signs in from the install's command line, in this company's profile.
  await expect(page.locator('#sub-anthropic code')).toContainText(`-p ${profile} auth add anthropic`);

  await chatgpt.getByRole('button',{name:'Disconnect ChatGPT'}).click();
  await expect(chatgpt.getByText('Not connected')).toBeVisible();
  expect(fake.settings.profiles.get(profile)!.credentials['openai-codex']).toBeUndefined();
 } finally {
  query(`delete from public.company_profiles where company_id='${aleem}'`);
  query(`delete from public.hermes_agent_audit where agent_id='${agent}'`);
  query(`delete from public.hermes_agents where id='${agent}'`);
  if(connection) query(`delete from public.hermes_connections where id='${connection}'`);
  for(const person of languages) query(`update public.people set language='${person.language}' where id='${person.id}'`);
  await fake.close();
 }
});
