import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { fakeHermes } from './fake-hermes.mjs';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { knowledgeSkill } from '../lib/company-knowledge-skill.mjs';

// #193: the Memory tab is a real tab of an Agent's Settings page. It has its own address, opens with the focus on it,
// moves by the arrow keys, and draws the shared AgentMemory the details panel draws (notes or the empty state); the
// Company knowledge card opens the memory of the first Agent that is not main, else the main Agent; a Viewer reads and
// is offered no Reset, and an Agent hidden from a Member is not found, so they get the Agents list. RS Learning: Lead,
// the main Agent, with two notes, and Ads with one. The Engine is the fake, as in agent-memory.spec.ts.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const space=`cs-${company.replaceAll('-','')}`;
const id=(n:number)=>`69000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [lead,ads]=[1,2].map(id);
const own=(agent:string)=>`ag-${agent.replaceAll('-','')}`;
const notes=['Prefers short subject lines.','Never mention prices before the offer.'];
const adsNote='Runs the June campaign.';
let fake:Awaited<ReturnType<typeof fakeHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 for(const name of [profile,own(ads)]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 // The Company's shared space, which holds the Company knowledge the link sits beside (#344).
 fake.settings.profiles.set(space,{soul:'',provider:'auto',model:'',key:null,config:{},credentials:{}});
 fake.settings.skills.set(space,new Map([['company-knowledge',knowledgeSkill({voice:'We talk like a colleague.'})]]));
 fake.settings.memory.set(profile,{memory:notes,profile:[]});
 fake.settings.memory.set(own(ads),{memory:[adsNote],profile:[]});
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  query(`do $$ begin
   set local session_replication_role=replica;
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
    ('${lead}','${company}','${id(4)}','Lead','General',true,'${profile}'),
    ('${ads}','${company}','${id(5)}','Ads','Runs the Meta ads.',false,'${own(ads)}');
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.company_profile_keepers(company_id,agent_id) values ('${company}','${lead}') on conflict (company_id) do update set agent_id=excluded.agent_id;
   insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${company}');
   set local session_replication_role=origin;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

test('the Owner opens an Agent\'s Memory tab by pointer, at its own address, and the arrow keys move between the two tabs',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings?section=agents');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await overlay.locator(`#sov-ag-${ads}`).click();
 await expect(page).toHaveURL(new RegExp(`\\?agent=${ads}$`));
 const memory=overlay.getByRole('tab',{name:'Memory',exact:true});
 await expect(memory).toHaveAttribute('href',`/c/rs-learning/settings?agent=${ads}&tab=memory`);
 await memory.click();
 await expect(page).toHaveURL(new RegExp(`\\?agent=${ads}&tab=memory$`));
 await expect(memory).toHaveAttribute('aria-selected','true');
 await expect(memory).toBeFocused();
 await expect(overlay.getByRole('tabpanel')).toContainText('What Ads remembers');
 await expect(overlay.locator('.mem-note__t')).toHaveText([adsNote]);
 // The arrow keys choose the other tab and leave the focus on it; the address follows.
 await page.keyboard.press('ArrowRight');
 await expect(page).toHaveURL(new RegExp(`\\?agent=${ads}$`));
 await expect(overlay.getByRole('tab',{name:'Settings',exact:true})).toBeFocused();
 await page.keyboard.press('ArrowRight');
 await expect(page).toHaveURL(new RegExp(`\\?agent=${ads}&tab=memory$`));
 // The address alone opens the tab, with its focus and its notes.
 await page.reload();
 await expect(overlay.getByRole('tab',{name:'Memory',exact:true})).toBeFocused();
 await expect(overlay.getByRole('heading',{name:/^What Ads remembers/})).toContainText('1');
 await expect(overlay.locator('.mem-note__t')).toHaveText([adsNote]);
});

test('a Viewer reads the notes with no buttons, and an Agent hidden from them opens the Agents list instead',async({page})=>{
 await signIn(page,'viewer@example.com',`/c/rs-learning/settings?agent=${ads}`);
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await expect(overlay.getByRole('heading',{name:'Agents',exact:true})).toBeVisible();
 await expect(overlay.locator('#sov-tab-memory')).toHaveCount(0);
 await page.goto(`/c/rs-learning/settings?agent=${lead}&tab=memory`);
 await expect(overlay.getByRole('tab',{name:'Memory',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(overlay.getByRole('heading',{name:/^What Lead remembers/})).toContainText('2');
 await expect(overlay.locator('.mem-note__t')).toHaveText(notes);
 await expect(overlay.getByRole('button',{name:'Reset memory',exact:true})).toHaveCount(0);
 // Only the heading's "i" (#614): no button that changes a note.
 await expect(overlay.getByRole('tabpanel').locator('button:not(.info__btn)')).toHaveCount(0);
});

test('Company knowledge opens the memory of the first Agent that is not main, and the main Agent when it is the only one',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/settings?section=knowledge');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 const link=overlay.getByRole('link',{name:'Open the memory of Ads'});
 await expect(link).toHaveAttribute('href',`/c/rs-learning/settings?agent=${ads}&tab=memory`);
 await link.click();
 await expect(page).toHaveURL(new RegExp(`\\?agent=${ads}&tab=memory$`));
 await expect(overlay.getByRole('tab',{name:'Memory',exact:true})).toBeFocused();
 await expect(overlay.getByRole('heading',{name:/^What Ads remembers/})).toContainText('1');
 // With no other Agent, the same card opens the main Agent's memory.
 query(`delete from public.hermes_agents where id='${ads}'`);
 await page.goto('/c/rs-learning/settings?section=knowledge');
 await overlay.getByRole('link',{name:'Open the memory of Lead'}).click();
 await expect(page).toHaveURL(new RegExp(`\\?agent=${lead}&tab=memory$`));
 await expect(overlay.getByRole('tab',{name:'Memory',exact:true})).toBeFocused();
 await expect(overlay.getByRole('heading',{name:/^What Lead remembers/})).toContainText('2');
 await expect(overlay.getByText('This is the main agent. Its memory also holds what the company’s agents remembered before each agent got its own profile.')).toBeVisible();
});
