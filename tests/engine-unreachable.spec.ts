import { test, expect } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #387: a Company whose Engine is not running says so once in Settings, without a sign-in action that would fail, and a
// message in a Conversation stays in the box, not sent, with Try again: the Conversation is its Agent's Engine session
// (#877, #883). When the Engine answers again, Try again sends the same message with no reload.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=<T>(sql:string):T[]=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as T[]; };
const company='10000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const omar='20000000-0000-0000-0000-000000000001';

test('an Engine that is not running says so once in Settings, keeps a message in the box not sent without starting a Run, and Try again sends it when it answers',async({page})=>{
 const fake=await laneHermes();
 const agent=randomUUID();
 const hadProfile=rows<{profile:string}>(`select profile from public.company_profiles where company_id='${company}'`).length>0;
 try {
  query(`update public.people set language='en' where id='${omar}'`);
  query(`update public.hermes_agents set is_default=false where company_id='${company}' and is_default`);
  // The Company's own Engine profile and its main Agent, as the worker leaves them.
  if(!hadProfile) query(`insert into public.company_profiles(company_id,profile,tools_confirmed,skills_shared) select id,'${profile}',true,true from public.companies where id='${company}'`);
  query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${agent}','${company}','${randomUUID()}','Lead','General',true,'${profile}')`);
  await signIn(page,'omar@example.com','/c/rs-learning/home');

  // The Engine does not answer: a 500 is a definite no, never an unknown start, so the send records nothing.
  fake.settings.managementStatus=500; fake.settings.status=500;

  await page.goto('/c/rs-learning/settings?section=models');
  await expect(page.locator('#sub-no-engine')).toHaveText('This company’s agent engine isn’t running. Ask the install owner to start it.');
  await expect(page.locator('#md-providers').getByRole('button')).toHaveCount(0);
  await expect(page.locator('#sub-openai-codex, #add-sub-openai-codex')).toHaveCount(0);
  await expect(page.locator('#md-providers code')).toHaveCount(0);

  await page.goto('/c/rs-learning/chat');
  const composer=page.locator('.composer');
  const field=composer.getByLabel('Message',{exact:true});
  const send=page.getByRole('button',{name:'Send',exact:true});
  await field.fill('Are you there?');
  await send.click();
  // The message stays in the box with why it was not sent and Try again; nothing is drawn as sent and no Run started.
  const line=composer.locator('.composer-error');
  await expect(line).toHaveText(/not sent/i,{timeout:20000});
  await expect(field).toHaveValue('Are you there?');
  await expect(page.locator('.msg[data-author=person]')).toHaveCount(0);
  expect(fake.settings.runs.length).toBe(0);

  // The Engine answers again: Try again sends the same message, with no reload and no second message.
  fake.settings.status=200; fake.settings.managementStatus=200;
  await line.getByRole('button',{name:'Try again'}).click();
  await expect.poll(()=>fake.settings.runs.length,{timeout:20000}).toBe(1);
  await expect(page.locator('.msg[data-author=agent]').filter({hasText:'Reply to: Are you there?'})).toBeVisible({timeout:30000});
  await expect(page.locator('.msg[data-author=person]').filter({hasText:'Are you there?'})).toHaveCount(1);
  await expect(composer.locator('.composer-error')).toHaveCount(0);
 } finally {
  query(`delete from public.hermes_agents where id='${agent}'`);
  if(!hadProfile) query(`delete from public.company_profiles where company_id='${company}'`);
  await fake.close();
 }
});
