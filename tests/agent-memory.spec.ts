import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { chooseLanguageInSettings } from './choose-language';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #350: the Memory tab of an Agent's details shows the notes of its own Hermes profile, or the empty state, and the main
// Agent says its memory still holds what the company's agents remembered before each got a profile (#121). An Owner may
// reset one Agent's memory, asked first; the server refuses everyone else, one row of the Company log names the person
// and the Agent with nothing of the notes, and a skill beside the notes is never shown or touched. RS Learning: Lead,
// the main Agent, on the Company's profile with three notes and a skill; Ads on its own profile with one; SEO with none.
// The database side is proven in supabase/tests/memory_reset.sql and the route's Roles in tests/agent-memory.test.mjs.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const id=(n:number)=>`68000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [lead,ads,seo]=[1,2,3].map(id);
const own=(agent:string)=>`ag-${agent.replaceAll('-','')}`;
const notes=['Prefers short subject lines.','Never mention prices before the offer.','Omar works in Cairo.'];
const adsNote='Runs the June campaign.';
let fake:Awaited<ReturnType<typeof fakeHermes>>;

async function chooseLanguage(page:Page,language:'en'|'ar') {
 await chooseLanguageInSettings(page,language);
 await expect(page.locator('html')).toHaveAttribute('lang',language);
}
const openDetails=async(page:Page,email:string,agent:string,name:string)=>{
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,email,`/c/rs-learning/chat/${agent}`);
 const details=page.getByRole('complementary',{name:`Details: ${name}`,exact:true});
 await expect(details).toBeVisible();
 return details;
};
const memoryTab=(details:Awaited<ReturnType<typeof openDetails>>)=>details.getByRole('tabpanel');

test.describe.configure({mode:'serial'});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 for(const name of [profile,own(ads),own(seo)]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 fake.settings.memory.set(profile,{memory:notes.slice(0,2),profile:notes.slice(2)});
 fake.settings.memory.set(own(ads),{memory:[adsNote],profile:[]});
 fake.settings.skills.set(profile,new Map([['weekly-recap','---\nname: weekly-recap\ndescription: Recaps the week.\n---\nWrite the recap.\n']]));
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  query(`do $$ begin
   set local session_replication_role=replica;
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
    ('${lead}','${company}','${id(4)}','Lead','General',true,'${profile}'),
    ('${ads}','${company}','${id(5)}','Ads','Runs the Meta ads.',false,'${own(ads)}'),
    ('${seo}','${company}','${id(6)}','SEO','Writes the blog.',false,'${own(seo)}');
   insert into public.company_profiles(company_id,profile,tools_level,tools_policy) select id,'${profile}',agent_level,public.engine_tool_policy() from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_level=excluded.tools_level,tools_policy=excluded.tools_policy,tools_pending=false;
   insert into public.company_profile_keepers(company_id,agent_id) values ('${company}','${lead}') on conflict (company_id) do update set agent_id=excluded.agent_id;
   insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${company}'),('${seo}','${company}');
   set local session_replication_role=origin;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

test('the Owner reads the main Agent\'s notes, the tab says what its memory holds, and the empty Agent shows the empty state',async({page})=>{
 const details=await openDetails(page,'omar@example.com',lead,'Lead');
 await details.getByRole('tab',{name:'Memory',exact:true}).click();
 const panel=memoryTab(details);
 await expect(panel.getByRole('heading',{name:/^What Lead remembers/})).toContainText('3');
 await expect(panel.locator('.mem-note__t')).toHaveText(notes);
 await expect(panel).toContainText('This is the main agent. Its memory also holds what the company’s agents remembered before each agent got its own profile.');
 await expect(panel).not.toContainText('weekly-recap');
 await expect(panel.getByRole('button',{name:'Reset memory',exact:true})).toBeVisible();

 const empty=await openDetails(page,'omar@example.com',seo,'SEO');
 await empty.getByRole('tab',{name:'Memory',exact:true}).click();
 const emptyPanel=memoryTab(empty);
 await expect(emptyPanel.getByRole('heading',{name:/^What SEO remembers/})).toContainText('0');
 await expect(emptyPanel.getByText('Nothing yet. What SEO learns from its work shows here.')).toBeVisible();
 await expect(emptyPanel).not.toContainText('This is the main agent.');
});

test('in Arabic the Memory tab reads as the reference words it',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'omar@example.com',`/c/rs-learning/chat/${ads}`);
 await chooseLanguage(page,'ar');
 await page.goto(`/c/rs-learning/chat/${ads}`);
 const details=page.getByRole('complementary',{name:'تفاصيل Ads',exact:true});
 await expect(details).toBeVisible();
 await details.getByRole('tab',{name:'ذاكرة',exact:true}).click();
 const panel=memoryTab(details);
 await expect(panel.getByRole('heading',{name:/^اللي Ads فاكره/})).toContainText('1');
 await expect(panel.locator('.mem-note__t')).toHaveText([adsNote]);
 await expect(panel.getByRole('button',{name:'امسح الذاكرة',exact:true})).toBeVisible();
 await expect(panel.getByText('ده الوكيل الرئيسي.')).toHaveCount(0);
 await chooseLanguage(page,'en');
});

test('the Owner\'s reset asks first, clears that Agent\'s memory only, and writes one log row with no note text',async({page})=>{
 const details=await openDetails(page,'omar@example.com',ads,'Ads');
 await details.getByRole('tab',{name:'Memory',exact:true}).click();
 const panel=memoryTab(details);
 await expect(panel.locator('.mem-note__t')).toHaveText([adsNote]);
 const reset=panel.getByRole('button',{name:'Reset memory',exact:true});
 await reset.click();
 await expect(panel.getByText('Reset the memory of Ads? Its notes are deleted and can’t be brought back.')).toBeVisible();
 await panel.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(panel.locator('.mem-note__t')).toHaveText([adsNote]);
 await expect(reset).toBeFocused();
 await reset.click();
 await panel.getByRole('button',{name:'Reset memory',exact:true}).click();
 await expect(panel.getByText('Nothing yet. What Ads learns from its work shows here.')).toBeVisible();
 expect(fake.settings.memory.get(own(ads))?.memory).toEqual([]);
 expect(fake.settings.memory.get(profile)?.memory,'the other Agent keeps its notes').toEqual(notes.slice(0,2));
 expect(fake.settings.skills.get(profile)?.has('weekly-recap')).toBe(true);
 const rows=JSON.parse(query(`select json_build_array(actor_id,actor_kind,agent_id,action,details) as row from public.company_log where action='memory_reset'`)).map((found:{row:unknown[]})=>found.row);
 expect(rows).toEqual([[omar,'person',ads,'memory_reset',{agent_name:'Ads'}]]);
 // Nothing of a note is kept in the log, whoever reads it.
 for(const note of notes) expect(JSON.parse(query(`select count(*)::int as n from public.company_log where details::text like '%${note.replaceAll("'","''")}%'`))[0].n).toBe(0);
});

test('a Contributor reads the notes and the log line but is offered no Reset',async({page})=>{
 const owner=await openDetails(page,'omar@example.com',lead,'Lead');
 await owner.getByRole('tab',{name:'Memory',exact:true}).click();
 await memoryTab(owner).getByRole('button',{name:'Reset memory',exact:true}).click();
 await memoryTab(owner).getByRole('button',{name:'Reset memory',exact:true}).click();
 await expect(memoryTab(owner).getByText('Nothing yet. What Lead learns from its work shows here.')).toBeVisible();

 const details=await openDetails(page,'reviewer@example.com',lead,'Lead');
 await details.getByRole('tab',{name:'Memory',exact:true}).click();
 const panel=memoryTab(details);
 await expect(panel.getByRole('heading',{name:/^What Lead remembers/})).toBeVisible();
 await expect(panel.getByRole('button',{name:'Reset memory',exact:true})).toHaveCount(0);
 await details.getByRole('tab',{name:'Log',exact:true}).click();
 await expect(memoryTab(details).locator('.lg-line').filter({hasText:'reset the memory of Lead'})).toHaveCount(1);
});
