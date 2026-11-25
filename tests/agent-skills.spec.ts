import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #180: an Agent's Skills live on the Agent's page in Settings, read from that Agent's own profile in the Engine and
// switched with the page's save bar (#161). Two Agents of one Company keep their own lists (the Writer's is empty); the
// Owner and a Manager switch, a Contributor reads On and Off and is refused by the server; the Company's shared skill
// stays on the team's Skills page, and the Engine's essential skill is never drawn. The Engine's learning graph marks
// only the skills it says the Agent wrote on its own, with no version. Each switched skill is one row of the Company log.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const space=`cs-${company.replaceAll('-','')}`;
const lead=randomUUID();
const writer=randomUUID();
const writerProfile=`ag-${writer.replaceAll('-','')}`;
let fake:Awaited<ReturnType<typeof fakeHermes>>;
const skillMd=(name:string,description:string)=>`---\nname: ${name}\ndescription: ${description}\n---\n\nDo the thing.\n`;
const skills={
 'weekly-recap':'Writes the Friday recap.',
 'ads-brief':'Drafts the week of ads.',
 'hub-skill':'Fetched from the hub.',
 'bundled-skill':'Ships with the Engine.',
};
test.describe.configure({mode:'serial'});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 // Lead keeps the Company's own profile; the Writer has one of its own and no Skill yet.
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{skills:{external_dirs:[`/opt/data/profiles/${space}/skills`]}},credentials:{}});
 fake.settings.profiles.set(writerProfile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.profiles.set(space,{soul:'',provider:'auto',model:'',key:null,config:{},credentials:{}});
 const own=new Map(Object.entries(skills).map(([name,description])=>[name,skillMd(name,description)]));
 fake.settings.skills.set(profile,own);
 fake.settings.skills.set(space,new Map([['team-lessons',skillMd('team-lessons','Lessons the team approved.')]]));
 fake.settings.skillProvenance.set(`${profile}:hub-skill`,'hub');
 fake.settings.skillProvenance.set(`${profile}:bundled-skill`,'bundled');
 fake.settings.skillsOff.add(`${profile}:ads-brief`);
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
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const agentPage=(email:string,page:import('@playwright/test').Page,id=lead)=>signIn(page,email,`/c/rs-learning/settings?agent=${id}`);
const overlayOf=(page:import('@playwright/test').Page)=>page.getByRole('dialog',{name:'Settings'});

test('an Agent\'s page lists its own skills in the Engine\'s order, with the learned mark and no shared or essential skill', async ({page}) => {
 await agentPage('omar@example.com',page);
 const overlay=overlayOf(page);
 // The Writer has no Skill of its own: its own page says so, and counts none (the essential skill never counts).
 await page.goto(`/c/rs-learning/settings?agent=${writer}`);
 await expect(overlay.getByRole('heading',{name:'Skills 0/0'})).toBeVisible();
 await expect(overlay.getByText('No skills yet. Tell Writer in the chat what it does, and it’ll suggest the skills it needs.')).toBeVisible();
 await page.goto(`/c/rs-learning/settings?agent=${lead}`);
 await expect(overlay.getByRole('heading',{name:'Skills 3/4'})).toBeVisible();
 const section=overlay.locator('section[aria-labelledby="set-h-skills"]');
 const rows=section.locator('li');
 await expect(rows).toHaveCount(4);
 await expect(rows.getByText('weekly-recap',{exact:true})).toBeVisible();
 await expect(rows.getByText('Writes the Friday recap.',{exact:true})).toBeVisible();
 // One Skill of each provenance the Engine reports, except `external` (the team's) and `bundled`'s essential skill.
 for(const name of Object.keys(skills)) await expect(rows.getByText(name,{exact:true})).toBeVisible();
 await expect(rows.getByText('team-lessons',{exact:true})).toHaveCount(0);
 await expect(rows.getByText(/hermes/i)).toHaveCount(0);
 // The learned mark is the Engine's own claim about one Skill, and it carries no version.
 await expect(rows.getByText('Learned on its own',{exact:true})).toHaveCount(1);
 await expect(rows.nth(0)).toContainText('Learned on its own');
 await expect(rows.nth(1)).not.toContainText('Learned on its own');
 // The team's page still lists the shared Skill, marked, beside the Agent's own.
 await page.goto('/c/rs-learning/skills');
 const leadRow=page.getByRole('group',{name:'Lead',exact:true});
 await expect(leadRow.getByRole('listitem')).toHaveCount(5);
 await expect(leadRow.getByText('team-lessons',{exact:true})).toBeVisible();
 await expect(leadRow.getByText('Shared with the team')).toBeVisible();
 await expect(leadRow.getByRole('switch')).toHaveCount(0);
 await page.goto(`/c/rs-learning/settings?agent=${lead}`);
});

test('a Manager changes two Skills and saves them together: the Engine holds both, and each is one log row', async ({page}) => {
 await agentPage('manager@example.com',page);
 const overlay=overlayOf(page);
 const before=JSON.parse(query(`select count(*) as n from public.company_log where action like 'skill_%'`))[0].n;
 await overlay.getByRole('switch',{name:'weekly-recap'}).click();
 await overlay.getByRole('switch',{name:'ads-brief'}).click();
 // One switch off and one on: the count stays 3/4, and the bar appears once.
 await expect(overlay.getByRole('heading',{name:'Skills 3/4'})).toBeVisible();
 await expect(overlay.locator('#dp-savebar')).toBeVisible();
 await overlay.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.locator('.toast')).toContainText('Saved. Lead will use the new settings from the next message');
 await expect(overlay.locator('#dp-savebar')).toBeHidden();
 await expect(overlay.getByRole('switch',{name:'weekly-recap'})).toHaveAttribute('aria-checked','false');
 await expect(overlay.getByRole('switch',{name:'ads-brief'})).toHaveAttribute('aria-checked','true');
 expect(fake.settings.skillsOff.has(`${profile}:weekly-recap`)).toBe(true);
 expect(fake.settings.skillsOff.has(`${profile}:ads-brief`)).toBe(false);
 // Only Lead's own profile was switched, never the Writer's or the shared space.
 for(const request of fake.settings.managementRequests.filter(entry=>(entry.path||'').startsWith('/api/skills/toggle'))) {
  expect(request.path).toBe(`/api/skills/toggle?profile=${profile}`);
 }
 // Each Skill changed in the one save is its own row of the Company log.
 const logged=JSON.parse(query(`select action,details->>'skill' as skill from public.company_log where company_id='${company}' and agent_id='${lead}' and action like 'skill_%' order by id`));
 expect(JSON.parse(query(`select count(*) as n from public.company_log where action like 'skill_%'`))[0].n).toBe(before+2);
 expect(logged.slice(-2)).toEqual([{action:'skill_disabled',skill:'weekly-recap'},{action:'skill_enabled',skill:'ads-brief'}]);
});

test('a Contributor reads On and Off and no switch, and the server refuses their change', async ({page}) => {
 await agentPage('reviewer@example.com',page);
 const overlay=overlayOf(page);
 await expect(overlay.getByRole('heading',{name:'Skills 3/4'})).toBeVisible();
 const section=overlay.locator('section[aria-labelledby="set-h-skills"]');
 await expect(section.getByRole('switch')).toHaveCount(0);
 // The Manager's save above holds: one Skill Off and three On, read as words.
 await expect(section.getByText('Off',{exact:true})).toHaveCount(1);
 await expect(section.getByText('On',{exact:true})).toHaveCount(3);
 await expect(overlay.locator('#dp-savebar')).toHaveCount(0);
 const refused=await page.request.post('/api/agent-page',{data:{company,agent:lead,changes:{'skill:weekly-recap':'on'}}});
 expect(refused.status()).toBe(403);
 expect(await refused.json()).toEqual({error:'agentPageNotAllowed'});
 expect(fake.settings.skillsOff.has(`${profile}:weekly-recap`)).toBe(true);
});
