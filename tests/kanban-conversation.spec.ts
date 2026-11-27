import { test, expect, freshSeed, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { toolConfig } from '../lib/agent-toolsets.mjs';

// Spec #831 (#844, covering #470): an Agent in a Conversation makes Cards with the Engine's own Kanban tool, for another
// Agent of its Company, and a job command becomes a Card given to the Agent of that role. Each Run is told the board
// names of the Agents its person sees (pin_run_brief, lib/lead-offer.mjs); the fake Engine's model reads them from the
// Run's instructions and calls kanban_create, as the real Engine's did in the install proof
// (docs/engine-probes/kanban-board.md, sections 4, 5 and 8). The Conversation shows one row under the reply, drawn from
// the step the Engine reported for the call, that names the Card and its Agent and opens it over the board; gtmworks
// keeps nothing for it and makes no Handover. When the Card is done the Engine wakes the session that made it with the
// result, so the Conversation's next Run, on that same session, holds it.
// RS Learning: Lead, the main Agent, and Ads, made from the meta role on a profile of its own, seen by the Contributor,
// the Manager and the Viewer as well as the Owner.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000001';
const profile=`co-${company.replaceAll('-','')}`;
const id=(n:number)=>`6b000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [lead,ads]=[1,2].map(id);
const adsProfile=`ag-${ads.replaceAll('-','')}`;
const [manager,contributor,viewer]=['20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004'];
let fake:Awaited<ReturnType<typeof laneHermes>>;

test.describe.configure({mode:'serial'});
test.use({actionTimeout:15000});
test.beforeAll(async({browser},testInfo)=>{
 freshSeed(testInfo);
 fake=await laneHermes();
 for(const name of [profile,adsProfile]) fake.settings.profiles.set(name,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:toolConfig({profile:name}),credentials:{}});
 // The fake model: a job command makes the one Card its instructions name; "give Ads …" makes one for the board name the
 // instructions give Ads. Nothing else makes a Card.
 fake.settings.kanbanAsks=(input,instructions)=>{
  const job=/This message is the job command \S+ for Ads: make one card for Ads with kanban_create, its assignee ([\w-]+), for this job: (.+)\n/.exec(instructions);
  if(job) return {title:job[2],body:job[2],assignee:job[1]};
  const board=/- Ads: .*\(board name: ([\w-]+)\)/.exec(instructions)?.[1];
  return /^Give Ads /.test(input)&&board?{title:'Plan the March ads',body:input,assignee:board}:null;
 };
 query(`update public.people set language='en' where id in ('20000000-0000-0000-0000-000000000001','${manager}','${contributor}','${viewer}')`);
 const page=await browser.newPage();
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  query(`do $$ begin
   set local session_replication_role=replica;
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile,template) values
    ('${lead}','${company}','${id(4)}','Lead','General',true,'${profile}',null),
    ('${ads}','${company}','${id(5)}','Ads','Runs the Meta ads.',false,'${adsProfile}','meta');
   insert into public.company_profiles(company_id,profile,tools_confirmed) select id,'${profile}',true from public.companies where id='${company}'
    on conflict (company_id) do update set profile=excluded.profile,tools_confirmed=true,tools_pending=false;
   insert into public.company_profile_keepers(company_id,agent_id) values ('${company}','${lead}') on conflict (company_id) do update set agent_id=excluded.agent_id;
   insert into public.agent_profiles(agent_id,company_id) values ('${ads}','${company}');
   insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','${manager}','${ads}'),('${company}','${contributor}','${ads}'),('${company}','${viewer}','${ads}') on conflict do nothing;
   set local session_replication_role=origin;
  end $$;`);
 } finally { await page.close(); }
});
test.afterAll(async()=>{ await fake?.close(); });

const send=async(page:Page,text:string)=>{
 const box=page.getByLabel('Message',{exact:true});
 await box.fill(text);
 await box.press('Enter');
};
const cardRow=(page:Page)=>page.locator('.turns [data-kind="card"]');
const madeBy=(title:string)=>fake.settings.kanban.tasks.filter(task=>task.title===title);
const handovers=()=>rows(`select count(*)::int as n from public.agent_handovers where company_id='${company}'`)[0].n;

test('asked to give Ads a job, the main Agent makes a Card for Ads; the Conversation shows one row that opens it, and every Member sees the Card on the board',async({page,browser})=>{
 test.setTimeout(120000);
 await signIn(page,'reviewer@example.com','/c/rs-learning/home');
 await page.locator('.sidebar').getByRole('link',{name:'New chat',exact:true}).click();
 await send(page,'Give Ads the March plan');
 await expect(page.locator('.msg[data-author=agent]')).toContainText('Reply to: Give Ads the March plan',{timeout:30000});
 // The Run was told Ads' board name, and its model made the Card with the Engine's own tool: given to Ads, made by Lead's
 // profile, ready for the dispatcher.
 const [made]=madeBy('Plan the March ads');
 expect(made).toMatchObject({assignee:adsProfile,created_by:profile,status:'ready'});
 // One row under the reply, from the step the Engine reported: the Card and its Agent, and no Handover.
 await expect(cardRow(page)).toHaveText('Card made for Ads · Plan the March adsOpen the card',{timeout:15000});
 await expect(page.locator('.turns [data-handover]')).toHaveCount(0);
 expect(handovers()).toBe(0);
 // Nothing the browser holds names a profile.
 expect(await page.content()).not.toContain(adsProfile);
 await page.screenshot({path:test.info().outputPath('card-row.png')});
 // The row opens the Card over the board.
 await cardRow(page).getByRole('link',{name:'Open the card'}).click();
 await expect(page).toHaveURL(new RegExp(`/c/rs-learning/work/board\\?card=${made.id}$`));
 await expect(page.getByRole('dialog').getByRole('heading',{level:2})).toHaveText('Plan the March ads');
 // A Card made from a Contributor's Conversation is on the board for every Member, under Planned.
 for(const email of ['omar@example.com','manager@example.com','viewer@example.com']) {
  const other=await browser.newPage();
  try {
   await signIn(other,email,'/c/rs-learning/work/board');
   await expect(other.locator(`#board-cols .col[data-column="planned"] [data-card="${made.id}"]`),email).toHaveCount(1);
  } finally { await other.close(); }
 }
});

test('a job command in the main Agent\'s Conversation becomes a Card for the Agent of its role, with the same row and no Handover',async({page})=>{
 test.setTimeout(120000);
 await signIn(page,'reviewer@example.com','/c/rs-learning/home');
 await page.locator('.sidebar').getByRole('link',{name:'New chat',exact:true}).click();
 await send(page,'/campaign Plan the March intake ads');
 await expect(page.locator('.msg[data-author=agent]')).toContainText('Reply to: /campaign Plan the March intake ads',{timeout:30000});
 // The person's message is theirs, as typed; the Run was the main Agent's own, asked to make one Card for Ads.
 await expect(page.locator('.msg[data-author=person]')).toHaveText(/\/campaign Plan the March intake ads/);
 const [made]=madeBy('Plan the March intake ads');
 expect(made).toMatchObject({assignee:adsProfile,created_by:profile});
 await expect(cardRow(page)).toHaveText('Card made for Ads · Plan the March intake adsOpen the card',{timeout:15000});
 await expect(page.locator('.turns [data-handover]')).toHaveCount(0);
 expect(handovers()).toBe(0);
});

test('when the Card is done, the Engine tells the session that made it, and the Conversation\'s next Run there holds its summary',async({page})=>{
 test.setTimeout(120000);
 await signIn(page,'reviewer@example.com','/c/rs-learning/home');
 await page.locator('.sidebar').getByRole('link',{name:'New chat',exact:true}).click();
 await send(page,'Give Ads the March plan, part two');
 await expect(page.locator('.msg[data-author=agent]')).toContainText('Reply to: Give Ads the March plan, part two',{timeout:30000});
 const made=madeBy('Plan the March ads').at(-1)!;
 const first=fake.settings.runs.find(run=>run.card&&run.input==='Give Ads the March plan, part two')!;
 // Ads works the Card and ends it with its summary, as the Engine's worker does.
 const kanban=fake.settings.kanban;
 kanban.run(made.id,{profile:adsProfile,status:'done',outcome:'completed',summary:'Three ads for March, EGP 9,000 in all.',ended_at:Math.floor(Date.now()/1000)});
 kanban.move(made.id,'done');
 await send(page,'What came of the March plan?');
 await expect(page.locator('.msg[data-author=agent]').last()).toContainText('Reply to: What came of the March plan?',{timeout:30000});
 const next=fake.settings.runs.at(-1)!;
 expect(next.session).toBe(first.session);
 expect(next.told).toEqual([expect.stringContaining('Result: Three ads for March, EGP 9,000 in all.')]);
 // The Engine's own turn is not the person's: the Conversation draws their two messages only.
 await expect(page.locator('.msg[data-author=person]')).toHaveCount(2);
 await expect(page.getByText(/\[kanban\]/)).toHaveCount(0);
});
