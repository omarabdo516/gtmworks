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
// #192 adds the search over the notes with the heading's whole count, "Clear search" and Escape, the intro's lines per
// Role, and the way to Company knowledge, which a Viewer is not given.
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
 // A test may open two Agents' details, and a second sign-in from a signed-in page lands on the chat rather than
 // /sign-in (tests/sign-in.ts): sign out first, as the specs that sign in twice do.
 await page.context().clearCookies();
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
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
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

// #191: a note is edited in place (an empty note and one the Engine refuses as too long say so) and forgotten with
// Undo; a forget is removed from the Engine when the six-second toast ends, and a reload no longer shows it. The
// component's parts are in components/agent-memory.test.tsx, the contract and the Roles in agent-memory.test.mjs, and
// the log rows in supabase/tests/memory_notes.sql.
const adsNoteAgain=()=>fake.settings.memory.set(own(ads),{memory:[adsNote],profile:[]});

test('the Owner edits a note in place, cancels one, and a note too long is refused',async({page})=>{
 adsNoteAgain();
 const details=await openDetails(page,'omar@example.com',ads,'Ads');
 await details.getByRole('tab',{name:'Memory',exact:true}).click();
 const panel=memoryTab(details);
 // The action's name carries the note's current text, so each save or Cancel is found by the text it now holds.
 const edit=(text:string)=>panel.getByRole('button',{name:new RegExp(`^Edit: ${text}`)});
 await edit('Runs the June campaign').click();
 const field=panel.getByRole('textbox',{name:'Edit note'});
 await expect(field).toBeFocused();
 await field.fill('Runs the July campaign.');
 await panel.getByRole('button',{name:'Save',exact:true}).click();
 await expect(panel.locator('.mem-note__t')).toHaveText(['Runs the July campaign.']);
 await expect(page.locator('.toast')).toContainText('Note updated');
 await expect(edit('Runs the July campaign')).toBeFocused();

 await edit('Runs the July campaign').click();
 await field.fill('Runs the August campaign.');
 await panel.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(panel.locator('.mem-note__t')).toHaveText(['Runs the July campaign.']);
 await expect(edit('Runs the July campaign')).toBeFocused();

 await edit('Runs the July campaign').click();
 await field.fill('x'.repeat(3000));
 await panel.getByRole('button',{name:'Save',exact:true}).click();
 await expect(panel.getByText('That note is too long for the memory. Make it shorter.')).toBeVisible();
 await expect(field).toBeFocused();
 await panel.getByRole('button',{name:'Cancel',exact:true}).click();
 expect(fake.settings.memory.get(own(ads))?.memory).toEqual(['Runs the July campaign.']);
});

test('the Owner forgets a note, and Undo puts it back without removing it from the Engine',async({page})=>{
 adsNoteAgain();
 const details=await openDetails(page,'omar@example.com',ads,'Ads');
 await details.getByRole('tab',{name:'Memory',exact:true}).click();
 const panel=memoryTab(details);
 await panel.getByRole('button',{name:/^Forget this: Runs the June campaign/}).click();
 await expect(panel.locator('.mem-note__t')).toHaveCount(0);
 await expect(page.locator('.toast')).toContainText('Ads forgot this note');
 await page.locator('.toast__act',{hasText:'Undo'}).click();
 await expect(page.locator('.toast')).toContainText('Note restored');
 await expect(panel.locator('.mem-note__t')).toHaveText([adsNote]);
 await expect(panel.getByRole('button',{name:/^Forget this: Runs the June campaign/})).toBeFocused();
 await page.waitForTimeout(6500);
 expect(fake.settings.memory.get(own(ads))?.memory).toEqual([adsNote]);
 await page.reload();
 const reloaded=page.getByRole('complementary',{name:'Details: Ads',exact:true});
 await reloaded.getByRole('tab',{name:'Memory',exact:true}).click();
 await expect(reloaded.getByRole('tabpanel').locator('.mem-note__t')).toHaveText([adsNote]);
});

test('a forgotten note leaves the Engine when its toast ends, so a reload no longer shows it',async({page})=>{
 adsNoteAgain();
 const details=await openDetails(page,'omar@example.com',ads,'Ads');
 await details.getByRole('tab',{name:'Memory',exact:true}).click();
 const panel=memoryTab(details);
 await panel.getByRole('button',{name:/^Forget this: Runs the June campaign/}).click();
 await expect(panel.locator('.mem-note__t')).toHaveCount(0);
 // With the only note gone, the search field takes the keyboard, where the reference puts it.
 await expect(panel.getByRole('searchbox',{name:'Search memory',exact:true})).toBeFocused();
 await expect(page.locator('.toast')).toBeHidden({timeout:8000});
 // The removal is the contract's own call, made once when the toast ends.
 await expect.poll(()=>fake.settings.managementRequests.filter(request=>request.method==='DELETE'&&String(request.path).startsWith('/api/learning/node')).length).toBe(1);
 await expect.poll(()=>fake.settings.memory.get(own(ads))?.memory).toEqual([]);
 await expect(panel.getByText('Nothing yet. What Ads learns from its work shows here.')).toBeVisible();
 await page.reload();
 const reloaded=page.getByRole('complementary',{name:'Details: Ads',exact:true});
 await reloaded.getByRole('tab',{name:'Memory',exact:true}).click();
 await expect(reloaded.getByRole('tabpanel').getByText('Nothing yet. What Ads learns from its work shows here.')).toBeVisible();
});

// #192: the search narrows the notes as a person types, the heading keeps the whole count, and a search that finds
// nothing says so with "Clear search", which Escape in a filled field does too. The intro's second line names the
// Agent, the edit line shows only to a Role that may act, and "Open company knowledge" reaches the Company knowledge
// section of Settings for everyone but a Viewer.
test('the Owner searches the notes, clears the search, and opens Company knowledge from the intro',async({page})=>{
 fake.settings.memory.set(own(ads),{memory:['Runs the June campaign.','Prefers short subject lines.','Never mention prices before the offer.'],profile:[]});
 const details=await openDetails(page,'omar@example.com',ads,'Ads');
 await details.getByRole('tab',{name:'Memory',exact:true}).click();
 const panel=memoryTab(details);
 await expect(panel.locator('.mem-note__t')).toHaveCount(3);
 await expect(panel).toContainText('Ads is one agent for the whole company with one memory, so what anyone teaches it, it remembers for everyone.');
 await expect(panel).toContainText('You can edit or delete anything.');
 await expect(panel.getByRole('link',{name:'Open company knowledge',exact:true})).toHaveAttribute('href','/c/rs-learning/settings?section=knowledge');
 const search=panel.getByRole('searchbox',{name:'Search memory',exact:true});
 await search.fill('june');
 await expect(panel.locator('.mem-note__t')).toHaveText(['Runs the June campaign.']);
 await expect(panel.getByRole('heading',{name:/^What Ads remembers/})).toContainText('3');
 await search.fill('cairo');
 await expect(panel.getByText('Nothing in the Ads memory matches “cairo”.')).toBeVisible();
 await expect(panel.locator('.mem-note')).toHaveCount(0);
 await panel.getByRole('button',{name:'Clear search',exact:true}).click();
 await expect(search).toHaveValue('');
 await expect(search).toBeFocused();
 await expect(panel.locator('.mem-note__t')).toHaveCount(3);
 await search.fill('june');
 await expect(panel.locator('.mem-note__t')).toHaveCount(1);
 await search.press('Escape');
 await expect(search).toHaveValue('');
 await expect(panel.locator('.mem-note__t')).toHaveCount(3);
});

test('a Viewer reads an Agent\'s memory without the edit line and without the way to Company knowledge',async({page})=>{
 fake.settings.memory.set(profile,{memory:['Prefers short subject lines.'],profile:[]});
 const details=await openDetails(page,'viewer@example.com',lead,'Lead');
 await details.getByRole('tab',{name:'Memory',exact:true}).click();
 const panel=memoryTab(details);
 await expect(panel.locator('.mem-note__t')).toHaveText(['Prefers short subject lines.']);
 await expect(panel.getByRole('searchbox',{name:'Search memory',exact:true})).toBeVisible();
 await expect(panel).toContainText('Lead is one agent for the whole company with one memory, so what anyone teaches it, it remembers for everyone.');
 await expect(panel).not.toContainText('You can edit or delete anything.');
 await expect(panel.getByRole('link',{name:'Open company knowledge',exact:true})).toHaveCount(0);
});
