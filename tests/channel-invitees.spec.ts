import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn, emailLink } from './sign-in';

// #207: an invited person is in the general channel from the invite, with the name made from their email, their Role and
// "Invite sent"; every count includes them. The Owner and the Managers see the email, and a Contributor reads the same row
// without it, on the page and in what the server sends. A team channel made with the invitation holds them too, and when
// they accept they are a Member of both. The database's half, per Role, is supabase/tests/channel_invitees.sql.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=(sql:string)=>{ const out=JSON.parse(query(sql)); return (Array.isArray(out)?out:out.rows) as Record<string,unknown>[]; };
const company='10000000-0000-0000-0000-000000000001';
const general='/c/rs-learning/channels/69000000-0000-0000-0000-000000000001';
const email=`channel-invite-${Date.now()}@example.com`;
const name='Channel';
let channel='';
let link='';

test.describe.configure({mode:'serial'});
test.beforeAll(({},testInfo)=>{ freshSeed(testInfo.file); query(`update public.people set language='en' where id::text like '20000000-%'`); });

test('the Owner invites a person, who joins the general channel with "Invite sent" and the channel\'s counts; a Contributor reads the row without the email',async({page,browser})=>{
 await signIn(page,'omar@example.com',general);
 const details=page.getByRole('complementary',{name:'Channel details'});
 // Before the invite: six Members, counted in the intro, the heading and the head.
 await expect(page.locator('.ch-intro')).toContainText('6 members');
 await expect(details.locator('#ch-h-p .muted')).toHaveText('6');
 await expect(details.locator('.dp-id__role')).toContainText('6 members');

 await page.goto('/c/rs-learning/settings?section=company');
 const overlay=page.getByRole('dialog',{name:'Settings'});
 await overlay.getByRole('button',{name:'Invite a member'}).click();
 await overlay.locator('#inv-email').fill(email);
 await overlay.locator('#inv-role').selectOption('contributor');
 await overlay.getByRole('button',{name:'Invite',exact:true}).click();
 await expect(page.locator('.toast')).toHaveText(`Invite sent to ${email}`);
 expect(rows(`select claimed_at from public.member_invitations where company_id='${company}' and email='${email}'`)).toEqual([{claimed_at:null}]);
 // signIn empties the local mailbox, so the invitation's link is read before another person signs in.
 link=await emailLink(page,email);

 // The general channel holds them from the invite: a row, the quiet line, and the counts.
 await page.goto(general);
 await expect(page.locator('.ch-intro')).toContainText('7 members');
 await expect(details.locator('#ch-h-p .muted')).toHaveText('7');
 await expect(details.locator('.dp-id__role')).toContainText('7 members');
 const invited=details.locator('.panel-row').filter({hasText:name});
 await expect(invited.locator('.panel-row__t')).toHaveText(name);
 await expect(invited.locator('.panel-row__d')).toHaveText(`Contributor · ${email} · Invite sent`);
 await expect(page.locator('.turns .note')).toHaveText(`عمر invited ${name}, who joined “general” right away`);
 expect(rows(`select count(*)::int n from public.channel_notes where company_id='${company}'`)[0].n).toBe(1);
 const ownerAnswer=await (await page.request.get(`/api/channels?company=${company}&channel=${general.split('/').at(-1)}`)).text();
 expect(ownerAnswer).toContain(email);

 // A Contributor reads the same row, and the server sends them no email at all.
 const other=await browser.newContext(); const contributor=await other.newPage();
 try {
  await signIn(contributor,'reviewer@example.com',general);
  const theirs=contributor.getByRole('complementary',{name:'Channel details'});
  await expect(theirs.locator('.panel-row').filter({hasText:name}).locator('.panel-row__d')).toHaveText('Contributor · Invite sent');
  await expect(contributor.locator('.turns .note')).toHaveText(`عمر invited ${name}, who joined “general” right away`);
  expect(await contributor.content()).not.toContain(email);
  const contributorAnswer=await (await contributor.request.get(`/api/channels?company=${company}&channel=${general.split('/').at(-1)}`)).text();
  expect(contributorAnswer).not.toContain(email);
  expect(contributorAnswer).not.toContain('@example.com');
 } finally { await other.close(); }
});

test('the Owner adds the invited person to a new channel, and when they accept they are a Member of both channels',async({page,context})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/home');
 const dialog=page.getByRole('dialog',{name:'New channel'});
 await expect(async()=>{
  if(!await dialog.count()) await page.getByRole('button',{name:'New channel',exact:true}).click();
  await expect(dialog.getByRole('textbox',{name:'Channel name'})).toBeVisible({timeout:2000});
 }).toPass({timeout:30000});
 await dialog.getByRole('textbox',{name:'Channel name'}).fill('Invite launch');
 await dialog.getByRole('checkbox',{name:new RegExp(`^${name}\\s+Contributor · ${email.replace(/[.+]/g,'\\$&')}`)}).click();
 await expect(dialog.getByRole('group',{name:/^Members/})).toHaveAccessibleName('Members 2');
 await dialog.getByRole('button',{name:'Create the channel'}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\/channels\/[0-9a-f-]{36}$/);
 channel=page.url().split('/').at(-1)!;
 await expect(page.locator('.ch-intro')).toContainText('2 members');
 const details=page.getByRole('complementary',{name:'Channel details'});
 await expect(details.locator('.panel-row').filter({hasText:email}).locator('.panel-row__d')).toHaveText(`Contributor · ${email} · Invite sent`);
 expect(rows(`select count(*)::int n from public.channel_invitees where channel_id='${channel}'`)[0].n).toBe(1);

 // The invited person accepts the invitation from the email, and reads both channels.
 await context.clearCookies(); await page.goto(link);
 await page.getByLabel('New password').fill('channel-invited-password'); await page.getByLabel('Confirm password').fill('channel-invited-password');
 await page.getByRole('button',{name:'Save password'}).click();
 await expect(page).toHaveURL(/\/c\/rs-learning\//);
 for(const path of [general,`/c/rs-learning/channels/${channel}`]) {
  await page.goto(path);
  await expect(page.locator('.ch-intro')).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Write your message in the channel',exact:true})).toBeVisible();
 }
 expect(rows(`select count(*)::int n from public.channel_people where channel_id='${channel}' and person_id=(select id from auth.users where email='${email}')`)[0].n).toBe(1);
 expect(rows(`select count(*)::int n from public.channel_invitees where channel_id='${channel}'`)[0].n).toBe(0);

 // Back as the Owner, the invited rows are their own Member rows with the name they gave.
 await context.clearCookies(); await signIn(page,'omar@example.com',`/c/rs-learning/channels/${channel}`);
 const joined=page.getByRole('complementary',{name:'Channel details'}).locator('.panel-row').filter({hasText:'channel-invite-'});
 await expect(joined.locator('.panel-row__d')).toHaveText('Contributor');
 await expect(joined.locator('.panel-row__d')).not.toContainText('Invite sent');
 await page.goto(general);
 await expect(page.getByRole('complementary',{name:'Channel details'}).locator('.panel-row').filter({hasText:'channel-invite-'}).locator('.panel-row__d')).toHaveText('Contributor');
});
