import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #28: Settings › Learning reads how each Agent learns from its own Engine profile (memory.write_approval and
// skills.write_approval), writes the Company's mode to every Agent profile and the shared space, and writes one Agent's
// override to its profile alone. What an Agent learned is its rules and the Skills the Engine's learning graph marks;
// the Owner and a Manager forget and bring back a rule, a Contributor reads with no control, and no Skill is offered a
// restore (the pinned Engine has no management route over its Skill ledger).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const fixture=JSON.parse(readFileSync('tests/engine-schema.json','utf8'));
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const lead=randomUUID();
const writer=randomUUID();
const conversation=randomUUID();
const profile=`co-${company.replaceAll('-','')}`;
const writerProfile=`ag-${writer.replaceAll('-','')}`;
const space=`cs-${company.replaceAll('-','')}`;
const rule='من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها';
const otherRule='Answer every comment within the day';
let fake:Awaited<ReturnType<typeof fakeHermes>>;
test.describe.configure({mode:'serial'});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 fake.settings.configDefaults=fixture.defaults;
 fake.settings.configSchema={fields:fixture.schema,category_order:[]};
 for(const name of [profile,writerProfile,space]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:name===space?null:fake.settings.key,config:{},credentials:{}});
 const skillMd=`---\nname: weekly-recap\ndescription: Writes the Friday recap.\n---\n\nDo the thing.\n`;
 fake.settings.skills.set(profile,new Map([['weekly-recap',skillMd]]));
 fake.settings.learnedSkills.set(profile,new Set(['weekly-recap']));
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  query(`do $$ begin
   insert into public.agent_profiles(agent_id,company_id) values ('${writer}','${company}');
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
    ('${lead}','${company}','${randomUUID()}','Lead','General',true,'${profile}'),
    ('${writer}','${company}','${randomUUID()}','Writer','Writing',false,'${writerProfile}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('${conversation}','${company}','${omar}','${lead}','Lead');
   insert into public.agent_rules(company_id,agent_id,body,said_by,conversation_id,run_id,call_id) values
    ('${company}','${lead}','${rule}','${omar}','${conversation}','learning-run-1','call-0'),
    ('${company}','${lead}','${otherRule}','${omar}','${conversation}','learning-run-2','call-0');
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const learning=(email:string,page:import('@playwright/test').Page)=>signIn(page,email,'/c/rs-learning/settings?section=learning');
const group=(page:import('@playwright/test').Page,name:string)=>page.getByRole('dialog',{name:'Settings'}).getByRole('radiogroup',{name});
const ruleRow=(page:import('@playwright/test').Page,text:string)=>page.locator('.ln-row').filter({hasText:text});
// The server writes both write approvals to a profile, memory first, and answers the save once both read back: wait for
// each exact value the test reads (#420).
const reread={timeout:15000};
const wrote=async(name:string,value:boolean)=>{
 await expect.poll(()=>fake.settings.profiles.get(name)!.config.memory?.write_approval,reread).toBe(value);
 await expect.poll(()=>fake.settings.profiles.get(name)!.config.skills?.write_approval,reread).toBe(value);
};
// A mode's radio is marked at once with a "Saving" line and held on the page once its save is answered (#663), so each
// choice here waits for the save's own answer, which must be 200 (a refused or mismatched save fails here, naming the
// save, not as a radio that never turns), and for the "Saving" line to go; the page is never read again for it.
const saving=async(page:import('@playwright/test').Page,click:()=>Promise<void>)=>{
 const reads:string[]=[];
 const read=(request:import('@playwright/test').Request)=>{
  const headers=request.headers();
  if(request.method()==='GET'&&headers.rsc==='1'&&!headers['next-router-prefetch']&&new URL(request.url()).pathname==='/c/rs-learning/settings') reads.push(request.url());
 };
 const save=page.waitForResponse(response=>{
  const request=response.request();
  return request.method()==='POST'&&new URL(response.url()).pathname==='/api/agent-settings';
 },{timeout:30000});
 // The overlay's links prefetch each section in full once the page loads (lib/link.tsx); those reads end first, so a
 // read counted here is one the save started.
 await page.waitForLoadState('networkidle');
 page.on('request',read);
 try {
  await click();
  const answer=await save;
  expect(answer.status(),`the save of ${answer.request().postData()} answered`).toBe(200);
  await expect(page.locator('.ln-saving, .ln-ag .is-saving')).toHaveCount(0);
 } finally { page.off('request',read); }
 expect(reads,'a mode save reads no page again').toEqual([]);
};
const choice=(agent:string)=>JSON.parse(query(`select learning_mode_choice as choice from public.agent_profiles where agent_id='${agent}'`))[0].choice;

// A rule's button does nothing until React hydrated it: wait for the first one's handlers.
const hydrated=(page:import('@playwright/test').Page)=>page.waitForFunction(()=>{
 const button=document.querySelector('.ln-row button');
 return !!button&&Object.getOwnPropertyNames(button).some(name=>name.startsWith('__reactFiber$')||name.startsWith('__reactProps$'));
});

test('the Owner switches the Company\'s mode and one Agent\'s, and each profile reads back its two values', async ({page}) => {
 await learning('omar@example.com',page);
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay.getByRole('heading',{name:'Learning',exact:true})).toBeVisible();
 // Every Agent reads "Learns on its own" from its own profile.
 await expect(group(page,'For the whole company').getByRole('radio',{name:/^Learns on its own/})).toHaveAttribute('aria-checked','true');
 await expect(overlay.locator('.ln-ag').filter({hasText:'Lead'})).toContainText('Learns on its own');
 // The Owner gives the whole Company "Asks first": both write approvals, on every Agent profile and the shared space.
 // A radio does nothing until React hydrated it: wait for its handlers, as for the rules below.
 await page.waitForFunction(()=>{
  const radio=document.getElementById('ln-co-ask');
  return !!radio&&Object.getOwnPropertyNames(radio).some(name=>name.startsWith('__reactProps$'));
 });
 await saving(page,()=>group(page,'For the whole company').getByRole('radio',{name:/^Asks first/}).click());
 for(const name of [profile,writerProfile,space]) await wrote(name,true);
 await expect(group(page,'For the whole company').getByRole('radio',{name:/^Asks first/})).toHaveAttribute('aria-checked','true');
 for(const name of [profile,writerProfile,space]) {
  const kept=fake.settings.profiles.get(name)!.config;
  expect(kept.memory?.write_approval).toBe(true);
  expect(kept.skills?.write_approval).toBe(true);
 }
 // The Writer's own mode is its profile alone: the Company and the Lead keep asking first.
 const writerModes=group(page,'Writer');
 await saving(page,()=>writerModes.getByRole('radio',{name:'Learns on its own',exact:true}).click());
 await wrote(writerProfile,false);
 await expect(writerModes.getByRole('radio',{name:'Learns on its own',exact:true})).toHaveAttribute('aria-checked','true');
 expect(fake.settings.profiles.get(writerProfile)!.config.memory?.write_approval).toBe(false);
 expect(fake.settings.profiles.get(writerProfile)!.config.skills?.write_approval).toBe(false);
 expect(fake.settings.profiles.get(profile)!.config.memory?.write_approval).toBe(true);
 expect(fake.settings.profiles.get(profile)!.config.skills?.write_approval).toBe(true);
 await expect(overlay.locator('.ln-ag').filter({hasText:'Writer'})).toContainText('Learns on its own');
 await expect(overlay.locator('.ln-ag').filter({hasText:'Lead'})).toContainText('Asks first');
 await expect.poll(()=>choice(writer),reread).toBe('auto');
 // The Writer pins "Asks first", then the Company turns by itself: the Writer's own choice stands. The group reads
 // mixed from the Agents' held modes once the Company's save is answered, with no read of the page.
 await saving(page,()=>writerModes.getByRole('radio',{name:'Asks first',exact:true}).click());
 await wrote(writerProfile,true);
 await expect(writerModes.getByRole('radio',{name:'Asks first',exact:true})).toHaveAttribute('aria-checked','true');
 await saving(page,()=>group(page,'For the whole company').getByRole('radio',{name:/^Learns on its own/}).click());
 await wrote(profile,false); await wrote(space,false); await wrote(writerProfile,true);
 await expect(group(page,'For the whole company').getByRole('radio',{name:/^Asks first/})).toHaveAttribute('aria-checked','false');
 await expect(overlay.locator('.ln-ag').filter({hasText:'Lead'})).toContainText('Learns on its own');
 await expect(overlay.locator('.ln-ag').filter({hasText:'Writer'})).toContainText('Asks first');
 expect(fake.settings.profiles.get(writerProfile)!.config.memory?.write_approval).toBe(true);
 expect(fake.settings.profiles.get(profile)!.config.memory?.write_approval).toBe(false);
 expect(fake.settings.profiles.get(space)!.config.memory?.write_approval).toBe(false);
 // "Follow the company" gives the Writer back: the Company's mode is written to its profile and its choice forgotten.
 const following=group(page,'Writer');
 await saving(page,()=>following.getByRole('radio',{name:'Follow the company'}).click());
 await wrote(writerProfile,false);
 await expect(following.getByRole('radio',{name:'Follow the company'})).toHaveAttribute('aria-checked','true');
 expect(fake.settings.profiles.get(writerProfile)!.config.memory?.write_approval).toBe(false);
 expect(fake.settings.profiles.get(writerProfile)!.config.skills?.write_approval).toBe(false);
 await expect.poll(()=>choice(writer),reread).toBe(null);
});

test('the Owner forgets a rule and brings it back, both written in the log, and a learned Skill has no restore', async ({page}) => {
 await learning('omar@example.com',page);
 const overlay=page.getByRole('dialog',{name:'Settings'});
 // A Skill the Engine says the Agent wrote on its own is listed with its mark and no control at all.
 const skill=ruleRow(page,'weekly-recap');
 await expect(skill).toContainText('Learned on its own');
 await expect(skill.locator('button')).toHaveCount(0);
 await expect(overlay.getByRole('button',{name:/Restore|previous version/})).toHaveCount(0);
 // Forget this marks the rule removed and the worker's list drops it; the log says so once.
 await hydrated(page);
 const row=ruleRow(page,rule);
 await row.getByRole('button',{name:/^Forget the rule:/}).click();
 await expect(ruleRow(page,rule)).toContainText('Forgotten');
 expect(JSON.parse(query(`select removed_at is not null as removed from public.agent_rules where body='${rule}'`))[0].removed).toBe(true);
 expect(JSON.parse(query(`select count(*) as n from public.company_log where action='agent_rule_removed' and details->>'rule'='${rule}'`))[0].n).toBe(1);
 // Bring it back clears the removal, and the second row names it in the log.
 await ruleRow(page,rule).getByRole('button',{name:/^Bring back the rule:/}).click();
 await expect(ruleRow(page,rule)).not.toContainText('Forgotten');
 await expect(ruleRow(page,rule).getByRole('button',{name:/^Forget the rule:/})).toBeVisible();
 expect(JSON.parse(query(`select removed_at is null as kept from public.agent_rules where body='${rule}'`))[0].kept).toBe(true);
 expect(JSON.parse(query(`select count(*) as n from public.company_log where action='agent_rule_restored' and details->>'rule'='${rule}'`))[0].n).toBe(1);
});

test('a Manager reads the mode and forgets a rule; a Contributor reads both with no control', async ({page}) => {
 await learning('manager@example.com',page);
 const overlay=page.getByRole('dialog',{name:'Settings'});
 // The Owner's Company mode stands: a Manager reads it and cannot change it, and has no per-Agent switch.
 await expect(group(page,'For the whole company').getByRole('radio',{name:/^Asks first/})).toHaveAttribute('aria-disabled','true');
 await expect(group(page,'Writer')).toHaveCount(0);
 await expect(ruleRow(page,otherRule).getByRole('button',{name:/^Forget the rule:/})).toBeVisible();
 await page.context().clearCookies();
 await learning('reviewer@example.com',page);
 await expect(page.getByText('This is changed by the Owner only. You see it read only.')).toBeVisible();
 await expect(page.getByRole('button',{name:/Forget the rule:|Bring back the rule:/})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/Restore|previous version/})).toHaveCount(0);
 await expect(group(page,'For the whole company').getByRole('radio',{name:/^Asks first/})).toHaveAttribute('aria-disabled','true');
});
