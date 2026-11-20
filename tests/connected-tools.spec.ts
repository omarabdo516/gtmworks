import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { appByKey, appConfig } from '../lib/app-catalogue.mjs';
import { appOrigin } from './lane.mjs';
import appsEn from '../lib/messages/apps.en.json';

// #204, an Agent's "Connected tools" in its details. RS Learning runs on its own profile in a fake Engine whose MCP
// catalogue and sign-ins answer as the pinned release's do: Lead keeps that profile, and Writer has a profile of its
// own (`ag-<id>`, as #120 makes one) and was made to use Mixpanel. Each Agent's rows are its own profile's apps; the Owner
// disconnects one for Writer only and connects Mixpanel from its row; a Manager and a Viewer read the rows with no button,
// and the route refuses them; an Engine that does not answer gives the apps' line and no rows.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const lead=randomUUID(); const writer=randomUUID();
const own=`ag-${writer.replaceAll('-','')}`;
let fake:Awaited<ReturnType<typeof fakeHermes>>;
const installed=(key:string)=>({url:`https://mcp.${key}.example/mcp`,auth:'oauth',...appConfig(appByKey(key)!,`${appOrigin}/api/apps/callback/${key}`).mcp_servers[key]});
const servers=(name:string)=>fake.settings.profiles.get(name)!.config.mcp_servers||{};

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file);
 fake=await laneHermes();
 for(const name of [profile,own]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.profiles.get(profile)!.config.mcp_servers={canva:installed('canva')};
 fake.settings.appTokens.add(`${profile}:canva`);
 fake.settings.profiles.get(own)!.config.mcp_servers={canva:installed('canva'),notion:{...installed('notion'),enabled:false}};
 fake.settings.appTokens.add(`${own}:canva`);
 query(`update public.people set language='en' where id in ('${omar}','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000004')`);
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  const [connection,second]=[randomUUID(),randomUUID()];
  query(`do $$ begin
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${lead}','${company}','${connection}','Lead','General',true,'${profile}');
      insert into public.company_profiles(company_id,profile,tools_level,tools_policy) select id,'${profile}',agent_level,public.engine_tool_policy() from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_level=excluded.tools_level,tools_policy=excluded.tools_policy,tools_pending=false;
   insert into public.agent_profiles(agent_id,company_id,tools_level,tools_policy) select '${writer}',id,agent_level,public.engine_tool_policy() from public.companies where id='${company}';
      insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,apps,profile) values ('${writer}','${company}','${second}','Writer','Content',false,'{Mixpanel}','${own}');
      insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','20000000-0000-0000-0000-000000000002','${writer}'),('${company}','20000000-0000-0000-0000-000000000004','${writer}');
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const section=(page:Page,name:string)=>page.getByRole('complementary',{name:`Details: ${name}`,exact:true}).locator('.dp-tools');
// Each row's name, line and end, as the person reads them.
const rowsOf=(page:Page,name:string)=>section(page,name).locator('.panel-row').evaluateAll(rows=>rows.map(row=>[row.querySelector('.panel-row__t')!.textContent,
 row.querySelector('.panel-row__d')!.textContent,row.querySelector(':scope > .panel-row__meta, :scope > button')!.textContent]));
const appLog=()=>JSON.parse(query(`select actor_id,action,details->>'app' as app,details->>'agent_name' as agent from public.company_log where company_id='${company}' and action in ('app_connected','app_disconnected') order by id`));
// What each app is for, as the reader sees it (lib/messages/apps.en.json).
const use=(key:string)=>(appsEn as Record<string,string>)[`use.${key}`];

test('each Agent lists its own profile\'s apps with their states, and the apps it was made to use as Not connected',async({page})=>{
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${writer}`);
 await expect(section(page,'Writer').getByRole('heading',{name:'Connected tools'})).toBeVisible();
 await expect.poll(()=>rowsOf(page,'Writer')).toEqual([['Canva',use('canva'),'Connected'],['Mixpanel',`Not connected · ${use('mixpanel')}`,'Connect'],['Notion',use('notion'),'Turned off for it']]);
 await page.goto(`/c/rs-learning/chat/${lead}`);
 await expect.poll(()=>rowsOf(page,'Lead')).toEqual([['Canva',use('canva'),'Connected']]);
});

test('the Owner\'s Manage turns rows into Disconnect; Disconnect removes the app from this Agent only, with the toast, the focus on the heading\'s button and a log row; Done restores the states',async({page})=>{
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${writer}`);
 const tools=section(page,'Writer');
 await tools.getByRole('button',{name:'Manage'}).click();
 const done=tools.getByRole('button',{name:'Done'});
 await expect(done).toBeFocused();
 expect((await rowsOf(page,'Writer')).map(row=>row[2])).toEqual(['Disconnect','Disconnect','Connect']);
 await tools.locator('.panel-row').filter({hasText:'Canva'}).getByRole('button',{name:'Disconnect'}).click();
 await expect(page.locator('.toast').filter({hasText:'Canva disconnected'})).toBeVisible();
 await expect(done).toBeFocused();
 expect(servers(own).canva,'gone from Writer\'s profile').toBeUndefined();
 expect(servers(profile).canva,'Lead still has it').toBeDefined();
 await expect.poll(appLog).toEqual([{actor_id:omar,action:'app_disconnected',app:'canva',agent:'Writer'}]);
 await done.click();
 expect(await rowsOf(page,'Writer')).toEqual([['Canva',`Not connected · ${use('canva')}`,'Connect'],['Mixpanel',`Not connected · ${use('mixpanel')}`,'Connect'],['Notion',use('notion'),'Turned off for it']]);
 await page.goto(`/c/rs-learning/chat/${lead}`);
 await expect.poll(()=>rowsOf(page,'Lead')).toEqual([['Canva',use('canva'),'Connected']]);
});

for(const [role,email] of [['Manager','manager@example.com'],['Viewer','viewer@example.com']] as const) test(`a ${role} reads the rows with no Manage and no Connect, and the route refuses them`,async({page})=>{
 await signIn(page,email,`/c/rs-learning/chat/${writer}`);
 const tools=section(page,'Writer');
 await expect(tools.getByRole('heading',{name:'Connected tools'})).toBeVisible();
 await expect.poll(()=>rowsOf(page,'Writer')).toEqual([['Mixpanel',`Not connected · ${use('mixpanel')}`,'Not connected'],['Notion',use('notion'),'Turned off for it']]);
 await expect(tools.getByRole('button')).toHaveCount(0);
 for(const action of ['disconnect','connect']) expect((await page.request.post('/api/company-apps',{data:{company,agent:writer,app:'notion',action}})).status()).toBe(403);
 expect(servers(own).notion).toBeDefined();
});

test('Connect on a row signs in for this Agent: Connecting… while it is followed, then Connected with the toast, in the log',async({page})=>{
 let answer:()=>void=()=>{}; const answered=new Promise<void>(resolve=>{ answer=resolve; });
 await page.context().route(/^https:\/\/auth\.[a-z-]+\.example\//,async route=>{
  await answered;
  const asking=new URL(route.request().url());
  return route.fulfill({status:302,headers:{location:`${asking.searchParams.get('redirect_uri')}?code=vendor-code&state=${asking.searchParams.get('state')}&scope=all`}});
 });
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${writer}`);
 const row=section(page,'Writer').locator('.panel-row').filter({hasText:'Mixpanel'});
 const [vendor]=await Promise.all([page.waitForEvent('popup'),row.getByRole('button',{name:'Connect'}).click()]);
 await expect(row.locator('.panel-row__meta')).toHaveText('Connecting…');
 answer();
 await expect(row.locator('.panel-row__meta')).toHaveText('Connected',{timeout:20000});
 await expect(row.locator('.panel-row__d')).toHaveText(use('mixpanel'));
 await expect(page.locator('.toast').filter({hasText:'Mixpanel connected'})).toBeVisible();
 await vendor.close();
 expect(servers(own).mixpanel?.enabled).toBe(true);
 expect(servers(profile).mixpanel,'only for Writer').toBeUndefined();
 await expect.poll(appLog).toEqual([{actor_id:omar,action:'app_disconnected',app:'canva',agent:'Writer'},{actor_id:omar,action:'app_connected',app:'mixpanel',agent:'Writer'}]);
});

test('an Engine that does not answer gives the apps\' line and no rows',async({page})=>{
 fake.settings.managementStatus=503;
 try {
  await signIn(page,'omar@example.com',`/c/rs-learning/chat/${writer}`);
  await expect(section(page,'Writer').locator('.panel-empty')).toHaveText('The apps can’t be read right now. Try again in a minute.');
  await expect(section(page,'Writer').locator('.panel-row, button')).toHaveCount(0);
 } finally { fake.settings.managementStatus=200; }
});
