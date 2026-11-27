import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';
import { laneHermes } from './lane-hermes';

// #460: Home lists the Company's real Agents, the same ones in the same order the sidebar shows this reader, each with
// the Card it is working on now on the Company's Engine board (spec #831, #846). The seed makes no Agent, so this file
// makes them and gives one a Card in progress on the fake Engine.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const aleem='10000000-0000-0000-0000-000000000003';
const reviewer='20000000-0000-0000-0000-000000000003';
const id=(n:number)=>`68000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [aleemLead,lead,ads,seo]=[1,2,3,4].map(n=>id(n));
const profileOf=(agent:string)=>`ag-${agent.replaceAll('-','')}`;
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 query(`do $$ begin
  update public.people set language='en' where id in ('20000000-0000-0000-0000-000000000005','${reviewer}');
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ('${aleemLead}','${aleem}','${id(11)}','Lead','General',true,'home-aleem-lead'),
   ('${lead}','${company}','${id(12)}','Lead','General',true,'home-lead'),
   ('${ads}','${company}','${id(13)}','Meta Ads','Runs the Meta ads.',false,'${profileOf(ads)}'),
   ('${seo}','${company}','${id(14)}','SEO','Writes the blog.',false,'home-seo');
  insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','${reviewer}','${ads}');
  insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${company}');
  insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${company}','co-${company.replaceAll('-','')}',true)
   on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
 end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

test('a Company with only its main Agent finds one tile, named Lead, and no fixed role',async({page})=>{
 await signIn(page,'multi@example.com','/c/aleem/home');
 const tiles=page.locator('.home-agents article');
 await expect(tiles).toHaveCount(1);
 await expect(tiles.getByRole('heading')).toHaveAccessibleName('Lead');
 await expect(page.locator('.home-agents')).not.toContainText(/Account manager|Writer|Designer|Critic/);
});

test('a Member sees the main Agent first, then the made Agent shown to them, and no hidden Agent',async({page})=>{
 await signIn(page,'reviewer@example.com','/c/rs-learning/home');
 await expect(page.locator('.home-agents article h2')).toHaveText(['Lead','Meta Ads']);
 await expect(page.locator('.home-agents')).not.toContainText('SEO');
});

test('the Card an Agent is working on now is a link under its own tile, and the others are not working',async({page})=>{
 const title=`حملة الميتا ${Date.now()}`;
 const card=fake.settings.kanban.task({title,status:'running',assignee:profileOf(ads)});
 fake.settings.kanban.task({title:`Planned ${title}`,status:'ready',assignee:profileOf(ads)});
 await signIn(page,'reviewer@example.com','/c/rs-learning/home');
 const tile=(name:string)=>page.locator('.home-agents article').filter({has:page.getByRole('heading',{name,exact:true})});
 await expect(tile('Meta Ads').getByRole('link')).toHaveAttribute('href',`/c/rs-learning/work/board?card=${card.id}`);
 await expect(tile('Meta Ads').getByRole('link')).toHaveText(title);
 await expect(tile('Lead').locator('p')).toHaveText('Not working now');
});
