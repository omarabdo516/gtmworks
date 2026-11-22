import { test, expect } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #387: a Company whose Engine is not running says so once in Settings, without a sign-in action that would fail, and a
// message in a Conversation is refused with the one plain error while staying in the box. When the Engine answers again
// the next message goes with no reload.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=<T>(sql:string):T[]=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as T[]; };
const company='10000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const omar='20000000-0000-0000-0000-000000000001';
// The person's messages: the Agent's reply to the send that goes may or may not be in yet, and is not what is counted.
const messages=()=>rows<{n:number}>(`select count(*)::int as n from public.conversation_messages where company_id='${company}' and author='person'`)[0].n;

test('an Engine that is not running says so once in Settings, refuses a message without losing it or recording a Run, and takes the next one when it answers',async({page})=>{
 const fake=await laneHermes();
 const agent=randomUUID();
 const hadProfile=rows<{profile:string}>(`select profile from public.company_profiles where company_id='${company}'`).length>0;
 const before=messages();
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
  await expect(page.locator('#sub-openai-codex')).toHaveCount(0);
  await expect(page.locator('#md-providers code')).toHaveCount(0);

  await page.goto('/c/rs-learning/chat');
  const composer=page.locator('.composer');
  const field=composer.getByLabel('Message',{exact:true});
  const send=page.getByRole('button',{name:'Send',exact:true});
  await field.fill('Are you there?');
  await send.click();
  await expect(composer.getByRole('alert')).toHaveText('The agent engine could not be reached. Your message was not sent; it is still in the box. Ask the install owner to start it.');
  await expect(field).toHaveValue('Are you there?');
  expect(fake.settings.runs.length).toBe(0);
  expect(messages()).toBe(before);

  // The same box, with no reload: the Engine answers, and the next send goes.
  fake.settings.status=200;
  await send.click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
  await expect(page.locator('.msg[data-author=person]').last()).toContainText('Are you there?');
  expect(fake.settings.runs.length).toBe(1);
  expect(messages()).toBe(before+1);
 } finally {
  query(`delete from public.hermes_agents where id='${agent}'`);
  if(!hadProfile) query(`delete from public.company_profiles where company_id='${company}'`);
  await fake.close();
 }
});
