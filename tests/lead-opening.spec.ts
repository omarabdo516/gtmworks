import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #434, on the app with the fake Engine: Lead opens a new Company's first Conversation, in its Owner's language, once
// the Company has a model; before that the #422 notice shows and nothing is opened. It happens once: a reload, a second
// visit to Lead's chat, or signing out and in again opens nothing more. The Owner's answer is met with the first Agent
// to make and the "Make it?" chips, and "Make it" makes it.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const omar='20000000-0000-0000-0000-000000000001';
const companies={en:{id:'10000000-0000-0000-0000-000000000001',slug:'rs-learning',lead:'e4340000-0000-0000-0000-000000000001'},
 ar:{id:'10000000-0000-0000-0000-000000000002',slug:'rs-consultations',lead:'e4340000-0000-0000-0000-000000000002'}};
const profilesOf=(company:string)=>{ const hex=company.replaceAll('-',''); return {space:`cs-${hex}`,co:`co-${hex}`}; };
const key={OPENROUTER_API_KEY:'sk-or-v1-playwright-0123456789abcdef'};
const question='Make Course Writer? It writes the course posts.';
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.beforeAll(async({},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0);
 fake=await laneHermes();
 // Each Company's space and Lead's profile; RS Learning starts with no key, RS Consultations with one.
 for(const [language,{id}] of Object.entries(companies)) for(const name of Object.values(profilesOf(id)))
  fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{},env:language==='ar'?{...key}:{}});
 fake.settings.pendingReads=0;
 // The Owner's answer is met with the first Agent to make, asked with the Owner's chips; "Make it" makes it.
 fake.settings.questions=input=>input.startsWith('We sell')?[{question,choices:['Make it','Not now']}]:[];
 fake.settings.reply=(input:string,answers:(string|null)[]=[])=>answers[0]==='Make it'
  ?`Course Writer is on the team now.\n\n\`\`\`gtmworks-tool\n${JSON.stringify({name:'create_agent',arguments:{name:'Course Writer',job:'Writes the course posts.',apps:[]}})}\n\`\`\``
  :`Reply to: ${input}`;
 query(`do $$ begin
  update public.hermes_agents set is_default=false where company_id in ('${companies.en.id}','${companies.ar.id}') and is_default;
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ('${companies.en.lead}','${companies.en.id}','e4340000-0000-0000-0000-000000000011','Lead','General',true,'${profilesOf(companies.en.id).co}'),
   ('${companies.ar.lead}','${companies.ar.id}','e4340000-0000-0000-0000-000000000012','Lead','General',true,'${profilesOf(companies.ar.id).co}');
  insert into public.company_profiles(company_id,profile,tools_level,tools_policy,skills_shared)
   select id,public.company_engine_profile(id),agent_level,public.engine_tool_policy(),true from public.companies where id in ('${companies.en.id}','${companies.ar.id}')
   on conflict (company_id) do update set profile=excluded.profile,tools_level=excluded.tools_level,tools_policy=excluded.tools_policy,tools_pending=false;
  insert into public.company_shared_spaces(company_id,folder) values
   ('${companies.en.id}','/opt/data/profiles/${profilesOf(companies.en.id).space}/skills'),('${companies.ar.id}','/opt/data/profiles/${profilesOf(companies.ar.id).space}/skills') on conflict do nothing;
  update public.people set language='en' where id='${omar}';
 end $$;`);
});
test.afterAll(async()=>{ await fake?.close(); });

const openings=(company:string)=>JSON.parse(query(`select v.id,v.person_id from public.conversation_messages m join public.conversations v on v.id=m.conversation_id where m.company_id='${company}' and m.run_id='lead-opening'`));
const conversationCount=(company:string)=>JSON.parse(query(`select count(*)::int as n from public.conversations where company_id='${company}'`))[0].n;
const leadTurns=(page:Page)=>page.locator('.turns > li[data-author="agent"]');

test('without a model the notice shows and nothing opens; once a key is there, Lead has opened the first Conversation, in English, and only once',async({page,browser})=>{
 const {id,slug}=companies.en;
 await signIn(page,'omar@example.com',`/c/${slug}/chat`);
 await expect(page.locator('.composer-area [data-no-model]')).toBeVisible();
 await expect(page).toHaveURL(`/c/${slug}/chat`);
 expect(openings(id)).toEqual([]);

 fake.settings.profiles.get(profilesOf(id).space)!.env={...key};
 await page.goto(`/c/${slug}/chat`);
 await expect(page).toHaveURL(new RegExp(`/c/${slug}/conversations/[0-9a-f-]{36}$`));
 const conversation=page.url().split('/').at(-1)!;
 await expect(leadTurns(page)).toHaveCount(1);
 await expect(leadTurns(page)).toContainText('Hi عمر, I’m Lead, and I manage RS Learning’s team of agents.');
 await expect(leadTurns(page)).toContainText('What does RS Learning sell?');
 await expect(leadTurns(page)).toContainText('Who buys it?');
 await expect(leadTurns(page)).toContainText('What’s the goal right now?');
 await expect(page.locator('.composer-area [data-no-model]')).toHaveCount(0);
 expect(openings(id)).toEqual([{id:conversation,person_id:omar}]);

 // A reload, Lead's chat again, and a new sign-in open nothing more.
 await page.reload();
 await expect(leadTurns(page)).toHaveCount(1);
 await page.goto(`/c/${slug}/chat`);
 await expect(page.getByLabel('Message',{exact:true})).toBeVisible();
 await expect(page).toHaveURL(`/c/${slug}/chat`);
 const other=await browser.newContext(); const again=await other.newPage();
 try {
  await signIn(again,'omar@example.com',`/c/${slug}/chat`);
  await expect(again.getByLabel('Message',{exact:true})).toBeVisible();
  await expect(again).toHaveURL(`/c/${slug}/chat`);
 } finally { await other.close(); }
 expect(openings(id)).toEqual([{id:conversation,person_id:omar}]);
 expect(conversationCount(id)).toBe(1);
});

test('the Owner\'s answer is met with the first Agent to make and the Make it chips; Make it makes the Agent',async({page})=>{
 test.setTimeout(120000);
 const {id,slug}=companies.en;
 const [{id:conversation}]=openings(id);
 await signIn(page,'omar@example.com',`/c/${slug}/conversations/${conversation}`);
 await page.getByLabel('Message',{exact:true}).fill('We sell Excel courses to accountants. The goal now is 100 sign-ups this month.');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 const asked=page.getByRole('group',{name:question});
 await expect(asked.getByRole('button',{name:'Make it'})).toBeVisible({timeout:30000});
 // The Run was told its opening and to propose the first Agents, with the Owner's question for each.
 const run=fake.settings.runs.find(each=>String(each.input).startsWith('We sell'))!;
 expect(run.instructions).toContain('You opened this conversation, before they wrote anything, with this message:');
 expect(run.instructions).toContain('What does RS Learning sell?');
 expect(run.instructions).toContain('propose the first two or three agents to make for this company');
 await asked.getByRole('button',{name:'Make it'}).click();
 await expect(page.getByRole('group',{name:'Agent made: Course Writer'})).toBeVisible({timeout:30000});
 expect(JSON.parse(query(`select name,speciality from public.hermes_agents where company_id='${id}' and name='Course Writer'`))).toEqual([{name:'Course Writer',speciality:'Writes the course posts.'}]);
});

test('an Arabic Owner finds the opening in Egyptian Arabic',async({page})=>{
 const {id,slug}=companies.ar;
 query(`update public.people set language='ar' where id='${omar}'`);
 await signIn(page,'omar@example.com',`/c/${slug}/chat`);
 await expect(page).toHaveURL(new RegExp(`/c/${slug}/conversations/[0-9a-f-]{36}$`));
 await expect(page.locator('html')).toHaveAttribute('lang','ar');
 await expect(leadTurns(page)).toContainText('أهلاً يا عمر، أنا Lead، وأنا اللي بدير فريق وكلاء R&S Consultations.');
 await expect(leadTurns(page)).toContainText('R&S Consultations بتبيع إيه؟');
 expect(openings(id)).toHaveLength(1);
});
