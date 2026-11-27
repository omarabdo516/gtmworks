import { test, expect, freshSeed, laneRows, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { signIn, openNavigation } from './sign-in';

// #950, ADR 0019: an Administrator makes an Invite link in the Team dialog with the Person's name, a Role and the
// Agents they will see, and copies it once. Opening the link, as a chat app's preview does, uses nothing; the Person
// sends its form with their name, email and password, lands in the Company signed in and sees the chosen Agents and the
// main one. The link works once, also when two sends race. The rows behind it are proven in supabase/tests/invite_links.sql.
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const id=(n:number)=>`95000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [lead,ads,seo]=[1,2,3].map(n=>id(10+n));
const names=(page:Page)=>page.locator('.sidebar .agent-tile:not(.agent-tile--new) .agent-tile__name');
const hash=(secret:string)=>createHash('sha256').update(secret).digest('hex');
const joiner={name:'Nour Salah',email:'nour-950@example.test',password:'nour-salah-password'};

test.describe.configure({mode:'serial'});
test.beforeAll(({},testInfo)=>{
 freshSeed(testInfo);
 query(`do $$ begin
  update public.people set language='en' where id='${omar}';
  delete from public.member_agent_access where company_id='${company}';
  insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
   ('${lead}','${company}','${id(1)}','Lead','General',true,'team-lead'),
   ('${ads}','${company}','${id(2)}','Meta Ads','Runs the Meta ads.',false,'team-ads'),
   ('${seo}','${company}','${id(3)}','SEO','Writes for search.',false,'team-seo')
  on conflict (id) do nothing;
 end $$;`);
});

async function openTeam(page:Page) {
 await openNavigation(page);
 const item=page.getByRole('menu').getByRole('menuitem').filter({hasText:/^Team/});
 await expect(async()=>{ if(!await item.isVisible()) await page.locator('.sidebar #btn-me').click(); await expect(item).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 await item.click();
 const dialog=page.getByRole('dialog',{name:'Team'});
 await expect(dialog).toBeVisible();
 return dialog;
}
async function join(page:Page,person:typeof joiner) {
 await page.getByLabel('Your name').fill(person.name);
 await page.getByLabel('Email').fill(person.email);
 await page.getByLabel('Password',{exact:true}).fill(person.password);
 await page.getByLabel('Confirm password').fill(person.password);
 await page.getByRole('button',{name:'Join and sign in'}).click();
}

test('the Administrator makes an Invite link, a preview leaves it unused, and the new Person joins once, seeing only the chosen Agents',async({page,browser,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const dialog=await openTeam(page);
 await dialog.getByRole('button',{name:'Make an invite link'}).click();
 await expect(dialog.getByLabel('Role').last()).toHaveValue('contributor');
 // The Role list never offers Administrator.
 expect(await page.locator('#lnk-role option').evaluateAll(options=>options.map(option=>(option as HTMLOptionElement).value))).toEqual(['manager','contributor','viewer']);
 await page.locator('#lnk-label').fill(joiner.name);
 await page.locator('#lnk-role').selectOption('viewer');
 await dialog.getByRole('switch',{name:'SEO',exact:true}).click();
 await dialog.getByRole('button',{name:'Make the link'}).click();
 const field=dialog.getByLabel(`Invite link for ${joiner.name}`);
 await expect(field).toHaveValue(/\/join#code=[a-f0-9]{64}$/);
 const link=await field.inputValue();
 const secret=link.split('#code=')[1];
 await dialog.getByRole('button',{name:'Copy the link'}).click();
 await expect(page.getByText(`Link copied. Send it to ${joiner.name} any way you like.`)).toBeVisible();
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(link);
 // Only the hash is kept, with the label, the Role and the chosen Agent; making it is in the log.
 expect(laneRows(`select l.label,l.role,l.used_at is null unused,l.secret_hash=${`'${hash(secret)}'`} hashed,(select array_agg(agent_id) from public.company_link_agents a where a.link_id=l.id) agents from public.company_links l`))
  .toEqual([{label:joiner.name,role:'viewer',unused:true,hashed:true,agents:[seo]}]);
 expect(laneRows(`select count(*)::int n from public.company_links l where l::text like '%${secret}%'`)).toEqual([{n:0}]);
 expect(laneRows(`select actor_id,details->>'label' label from public.company_log where action='invite_link_made'`)).toEqual([{actor_id:omar,label:joiner.name}]);

 // A link preview fetches the page with a GET, as WhatsApp's does (#948): the link stays unused.
 const preview=await page.request.get(link,{headers:{'user-agent':'WhatsApp/2.23.20.0'}});
 expect(preview.status()).toBe(200);
 expect(laneRows(`select used_at is null unused from public.company_links`)).toEqual([{unused:true}]);

 // The new Person opens the link in a browser of their own, sees the Company and the Role, and joins.
 const fresh=await browser.newContext();
 const person=await fresh.newPage();
 const requests:string[]=[];
 person.on('request',request=>requests.push(request.url()));
 await person.goto(link);
 await expect(person.getByText('You’re joining RS Learning as Viewer.')).toBeVisible();
 await expect(person.getByText('Use at least 10 characters for your password.')).toBeVisible();
 expect(laneRows(`select used_at is null unused from public.company_links`)).toEqual([{unused:true}]);
 await join(person,joiner);
 await expect(person).toHaveURL(/\/c\/rs-learning\/home$/);
 await expect(names(person)).toHaveText(['Lead','SEO']);
 // No request address ever carried the secret.
 expect(requests.filter(url=>url.includes(secret))).toEqual([]);
 const [member]=laneRows(`select m.role,p.name,m.person_id from public.members m join public.people p on p.id=m.person_id join auth.users u on u.id=m.person_id where m.company_id='${company}' and u.email='${joiner.email}'`);
 expect(member).toMatchObject({role:'viewer',name:joiner.name});
 expect(laneRows(`select used_by from public.company_links`)).toEqual([{used_by:member.person_id}]);
 expect(laneRows(`select actor_id,person_id,details->>'label' label from public.company_log where action='invite_link_used'`)).toEqual([{actor_id:member.person_id,person_id:member.person_id,label:joiner.name}]);

 // The same link a second time is refused, opened or sent, and makes nobody.
 const late=await (await browser.newContext()).newPage();
 await late.goto(link);
 await expect(late.getByRole('main').getByRole('alert')).toHaveText('This invite link can’t be used any more. Ask your Administrator for a new one.');
 await expect(late.getByLabel('Your name')).toHaveCount(0);
 const again=await late.request.post('/join/submit',{form:{code:secret,language:'en',name:'Late',email:'late-950@example.test',password:'late-person-password',confirm:'late-person-password'},maxRedirects:0});
 expect(again.status()).toBe(410);
 expect(laneRows(`select count(*)::int n from auth.users where email='late-950@example.test'`)).toEqual([{n:0}]);
 await fresh.close();
});

test('two sends of one link at the same moment: one Person joins and the other is refused with no account left behind',async({page})=>{
 const secret=randomBytes(32).toString('hex');
 query(`insert into public.company_links(company_id,kind,secret_hash,made_by,label,role,ends_at) values ('${company}','invite','${hash(secret)}','${omar}','Race','contributor',now()+interval '7 days')`);
 const send=(n:number)=>page.request.post('/join/submit',{form:{code:secret,language:'en',name:`Racer ${n}`,email:`racer-${n}-950@example.test`,password:'racer-person-password',confirm:'racer-person-password'},maxRedirects:0});
 const answers=await Promise.all([send(1),send(2)]);
 expect(answers.map(answer=>answer.status()).sort()).toEqual([303,410]);
 expect(laneRows(`select count(*)::int n from auth.users where email like 'racer-%-950@example.test'`)).toEqual([{n:1}]);
 expect(laneRows(`select count(*)::int n from public.members m join auth.users u on u.id=m.person_id where m.company_id='${company}' and u.email like 'racer-%-950@example.test'`)).toEqual([{n:1}]);
});
