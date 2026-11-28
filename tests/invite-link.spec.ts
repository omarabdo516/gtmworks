import { test, expect, freshSeed, laneRows, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { signIn, openNavigation } from './sign-in';
import type { Locator } from '@playwright/test';

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
async function makeLink(page:Page,dialog:Locator,label:string,role:string,agent:string) {
 await dialog.getByRole('button',{name:'Make an invite link'}).click();
 await page.locator('#lnk-label').fill(label);
 await page.locator('#lnk-role').selectOption(role);
 await dialog.getByRole('switch',{name:agent,exact:true}).click();
 await dialog.getByRole('button',{name:'Make the link'}).click();
 const field=dialog.getByLabel(`Invite link for ${label}`);
 await expect(field).toHaveValue(/\/join#code=[a-f0-9]{64}$/);
 return field.inputValue();
}
const refusedPage='This invite link can’t be used any more. Ask your Administrator for a new one.';

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

test('pending links list their label, Role, maker and end; Cancel stops one at once; a cancelled or ended link opens the clear page; a new link for the same Person after one is cancelled joins',async({page,browser})=>{
 const mona={name:'Mona Adel',email:'mona-951@example.test',password:'mona-adel-password'};
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const dialog=await openTeam(page);
 // The table starts with no link waiting: the links the earlier tests made are used.
 await expect(dialog.getByText('Invite link',{exact:true})).toHaveCount(0);
 const first=await makeLink(page,dialog,'Mona Adel','viewer','SEO');
 // The made panel closes, and the table lists the link with its label, Role, maker and end.
 await dialog.locator('section[aria-labelledby="lnk-h"]').getByRole('button',{name:'Done'}).click();
 const row=dialog.getByRole('row').filter({hasText:'Mona Adel'});
 await expect(row).toHaveCount(1);
 await expect(row).toContainText('Viewer');
 await expect(row).toContainText('Made by عمر');
 await expect(row).toContainText(/Ends \w{3} \d{1,2}/);
 await expect(row.getByText('Invite link',{exact:true})).toBeVisible();
 // Cancel stops it at once, takes it out of the table and is written in the Company log.
 await row.getByRole('button',{name:'Cancel Mona Adel’s invite link'}).click();
 await expect(page.getByText('The invite link for Mona Adel was cancelled.')).toBeVisible();
 await expect(dialog.getByRole('row').filter({hasText:'Mona Adel'})).toHaveCount(0);
 expect(laneRows(`select count(*)::int n from public.company_links where label='Mona Adel' and cancelled_at is not null and used_at is null`)).toEqual([{n:1}]);
 expect(laneRows(`select actor_id,details->>'label' label,details->>'role' role from public.company_log where action='invite_link_cancelled'`)).toEqual([{actor_id:omar,label:'Mona Adel',role:'viewer'}]);
 // The Person holding it is told what to do, and a send is refused without making an account.
 const secret=first.split('#code=')[1];
 const dead=await (await browser.newContext()).newPage();
 await dead.goto(first);
 await expect(dead.getByRole('main').getByRole('alert')).toHaveText(refusedPage);
 await expect(dead.getByLabel('Your name')).toHaveCount(0);
 const refused=await dead.request.post('/join/submit',{form:{code:secret,language:'en',name:'Mona',email:`late-${mona.email}`,password:mona.password,confirm:mona.password},maxRedirects:0});
 expect(refused.status()).toBe(410);
 expect(laneRows(`select count(*)::int n from auth.users where email='late-${mona.email}'`)).toEqual([{n:0}]);
 // A link past its 7 days is refused the same way, its page saying so too.
 const ended=randomBytes(32).toString('hex');
 query(`insert into public.company_links(company_id,kind,secret_hash,made_by,label,role,created_at,ends_at) values ('${company}','invite','${hash(ended)}','${omar}','Mona Adel','viewer',now()-interval '8 days',now()-interval '1 day')`);
 await dead.goto(`${new URL(first).origin}/join#code=${ended}`);
 await expect(dead.getByRole('main').getByRole('alert')).toHaveText(refusedPage);
 await expect(dead.getByLabel('Your name')).toHaveCount(0);
 const late=await dead.request.post('/join/submit',{form:{code:ended,language:'en',name:'Mona',email:`late-${mona.email}`,password:mona.password,confirm:mona.password},maxRedirects:0});
 expect(late.status()).toBe(410);
 expect(laneRows(`select count(*)::int n from auth.users where email='late-${mona.email}'`)).toEqual([{n:0}]);
 // The Administrator makes a new link for the same Person after the cancelled one, and it works.
 const second=await makeLink(page,dialog,'Mona Adel','viewer','SEO');
 expect(second).not.toBe(first);
 await dialog.locator('section[aria-labelledby="lnk-h"]').getByRole('button',{name:'Done'}).click();
 await expect(dialog.getByRole('row').filter({hasText:'Mona Adel'})).toHaveCount(1);
 const fresh=await browser.newContext();
 const person=await fresh.newPage();
 await person.goto(second);
 await expect(person.getByText('You’re joining RS Learning as Viewer.')).toBeVisible();
 await join(person,mona);
 await expect(person).toHaveURL(/\/c\/rs-learning\/home$/);
 await expect(names(person)).toHaveText(['Lead','SEO']);
 await fresh.close();
 // The used link leaves the list and the Person shows as a Member.
 await dialog.getByRole('button',{name:'Done'}).click();
 const again=await openTeam(page);
 const member=again.getByRole('row').filter({hasText:'Mona Adel'});
 await expect(member).toHaveCount(1);
 await expect(member).toContainText('Viewer');
 await expect(member.getByText('Invite link',{exact:true})).toHaveCount(0);
 expect(laneRows(`select m.role,p.name from public.members m join public.people p on p.id=m.person_id join auth.users u on u.id=m.person_id where m.company_id='${company}' and u.email='${mona.email}'`)).toMatchObject([{role:'viewer',name:'Mona Adel'}]);
 expect(laneRows(`select used_at is not null used from public.company_links where secret_hash='${hash(second.split('#code=')[1])}'`)).toEqual([{used:true}]);
});

test('a Company worked alone lists its pending Invite link in the Team dialog and in Members settings, cancels it in both, and a link made in settings joins the list at once',async({page})=>{
 const soloCompany='10000000-0000-0000-0000-000000000002', solo='rs-consultations';
 query(`do $$ begin
   update public.companies set work_mode='alone' where id='${soloCompany}';
   insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile)
    values ('${id(20)}','${soloCompany}','${id(21)}','SEO','Writes for search.',false,'team-seo') on conflict (id) do nothing;
  end $$;`);
 await signIn(page,'omar@example.com',`/c/${solo}/home`);
 const dialog=await openTeam(page);
 const first=await makeLink(page,dialog,'Solo Person','viewer','SEO');
 expect(first).toMatch(/\/join#code=[a-f0-9]{64}$/);
 await dialog.locator('section[aria-labelledby="lnk-h"]').getByRole('button',{name:'Done'}).click();
 const list=dialog.getByRole('list',{name:'Invite links'});
 await expect(list).toHaveCount(1);
 await expect(list).toContainText('Solo Person');
 await expect(list).toContainText('Made by عمر');
 await list.getByRole('button',{name:'Cancel Solo Person’s invite link'}).click();
 await expect(page.getByText('The invite link for Solo Person was cancelled.')).toBeVisible();
 await expect(dialog.getByRole('list',{name:'Invite links'})).toHaveCount(0);
 // Members settings, worked alone, shows the same list and cancels the link there too.
 await makeLink(page,dialog,'Solo Person','viewer','SEO');
 await dialog.locator('section[aria-labelledby="lnk-h"]').getByRole('button',{name:'Done'}).click();
 await page.goto(`/c/${solo}/settings?section=members`);
 const settingsList=page.getByRole('list',{name:'Invite links'});
 await expect(settingsList).toHaveCount(1);
 await expect(settingsList).toContainText('Solo Person');
 await settingsList.getByRole('button',{name:'Cancel Solo Person’s invite link'}).click();
 await expect(page.getByText('The invite link for Solo Person was cancelled.')).toBeVisible();
 await expect(page.getByRole('list',{name:'Invite links'})).toHaveCount(0);
 // A link made right here in Members settings joins the pending list above it at once.
 await page.getByRole('button',{name:'Make an invite link'}).click();
 await page.locator('#lnk-label').fill('Settings Person');
 await page.locator('#lnk-role').selectOption('viewer');
 await page.getByRole('switch',{name:'SEO',exact:true}).click();
 await page.getByRole('button',{name:'Make the link'}).click();
 await expect(page.getByLabel('Invite link for Settings Person')).toHaveValue(/\/join#code=[a-f0-9]{64}$/);
 await page.locator('section[aria-labelledby="lnk-h"]').getByRole('button',{name:'Done'}).click();
 const made=page.getByRole('list',{name:'Invite links'});
 await expect(made).toContainText('Settings Person');
 await made.getByRole('button',{name:'Cancel Settings Person’s invite link'}).click();
 await expect(page.getByText('The invite link for Settings Person was cancelled.')).toBeVisible();
 await expect(page.getByRole('list',{name:'Invite links'})).toHaveCount(0);
 expect(laneRows(`select count(*)::int n from public.company_links where company_id='${soloCompany}' and label in ('Solo Person','Settings Person') and cancelled_at is not null and used_at is null`)).toEqual([{n:3}]);
});
