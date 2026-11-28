import { test, expect, freshSeed, laneRows, type Page } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { signIn, openNavigation, seededPassword } from './sign-in';

// #954, ADR 0019: a Member who forgot their password gets back in through a password link an Administrator or a
// Manager of their Company makes from the Team page. Opening the link, as a chat app's preview does, uses nothing; its
// form sets the new password, signs the Member in and ends their other sessions. It works once and ends after 24 hours;
// a Manager gets none for an Administrator. The sign-in page sends no reset email. The rows behind it are proven in
// supabase/tests/password_links.sql.
const company='10000000-0000-0000-0000-000000000001';
const viewer='20000000-0000-0000-0000-000000000004';
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const rows=<T,>(sql:string)=>laneRows(sql) as T[];
const hash=(secret:string)=>createHash('sha256').update(secret).digest('hex');
const refusedPage='This password link was already used, was replaced by a newer one, or has ended. Ask an Administrator or a Manager of your Company for a new one.';
const newPassword='viewer-new-password-954';
const alertWith=(page:Page,text:string)=>page.getByRole('alert').filter({hasText:text});

test.describe.configure({mode:'serial'});
test.beforeAll(({},testInfo)=>{
 freshSeed(testInfo);
 query(`update public.people set language='en' where id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','${viewer}')`);
});
// Later tests sign in with the seeded password.
test.afterAll(()=>{
 query(`update auth.users set encrypted_password=extensions.crypt('${seededPassword}',extensions.gen_salt('bf')) where email='viewer@example.com'`);
});

async function openTeam(page:Page) {
 await openNavigation(page);
 const item=page.getByRole('menu').getByRole('menuitem').filter({hasText:/^Team/});
 await expect(async()=>{ if(!await item.isVisible()) await page.locator('.sidebar #btn-me').click(); await expect(item).toBeVisible({timeout:2000}); }).toPass({timeout:30000});
 await item.click();
 const dialog=page.getByRole('dialog',{name:'Team'});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('row').first()).toBeVisible();
 return dialog;
}

test('Forgot password sends no email and says whom to ask',async({page})=>{
 await page.goto('/sign-in');
 await page.getByRole('link',{name:'Forgot password?'}).click();
 await expect(page).toHaveURL(/\/forgot-password\?language=en$/);
 await expect(page.getByRole('status').filter({hasText:'Ask an'})).toHaveText('Ask an Administrator or a Manager of your Company for a password link. They make one from the Team page; it works once, for 24 hours.');
 // Nothing to send: no email field and no button.
 await expect(page.getByLabel('Email')).toHaveCount(0);
 await expect(page.getByRole('button')).toHaveCount(0);
 await page.getByRole('link',{name:'Back to sign in'}).click();
 await expect(page).toHaveURL(/\/sign-in\?language=en$/);
});

test('a Manager makes a password link for a Viewer; a preview leaves it unused; the Viewer sets a new password once, is signed in, and their other session ends',async({page,browser,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 // The Viewer is signed in on another device.
 const device=await browser.newContext();
 const old=await device.newPage();
 await signIn(old,'viewer@example.com','/c/rs-learning/home');
 await expect(old).toHaveURL(/\/c\/rs-learning\/home$/);

 await signIn(page,'manager@example.com','/c/rs-learning/work/board');
 const dialog=await openTeam(page);
 // A Manager gets no password link for an Administrator, nor for themself.
 await expect(dialog.getByRole('button',{name:'Make a password link for مراجع'})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Make a password link for عمر'})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Make a password link for مدير'})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Make a password link for مشاهد'}).click();
 const field=dialog.getByRole('textbox',{name:'Password link for مشاهد'});
 await expect(field).toHaveValue(/\/password#code=[a-f0-9]{64}$/);
 const link=await field.inputValue();
 const secret=link.split('#code=')[1];
 await dialog.getByRole('button',{name:'Copy the link'}).click();
 await expect(page.getByText('Link copied. Send it to مشاهد any way you like.')).toBeVisible();
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(link);
 // Only the secret's hash is kept, and it ends after 24 hours.
 const [kept]=rows<{secret_hash:string,hours:number,used_at:string|null}>(`select secret_hash,(extract(epoch from ends_at-created_at)/3600)::int as hours,used_at from public.company_links where kind='password' and person_id='${viewer}'`);
 expect(kept).toEqual({secret_hash:hash(secret),hours:24,used_at:null});

 // A chat app's preview fetches the page: nothing is used.
 const preview=await page.request.get(link.split('#')[0]);
 expect(preview.status()).toBe(200);
 expect(await preview.text()).not.toContain(secret);

 // The Viewer opens it in a fresh browser.
 const fresh=await browser.newContext();
 const person=await fresh.newPage();
 await person.goto(link);
 await expect(person.getByRole('heading',{name:'Set a new password'})).toBeVisible();
 await expect(person.getByText('For مشاهد in RS Learning')).toBeVisible();
 expect(rows<{used_at:string|null}>(`select used_at from public.company_links where secret_hash='${hash(secret)}'`)[0].used_at).toBeNull();
 // The usual rule: a short password is refused and the link stays unused.
 await person.getByLabel('New password').fill('too-short');
 await person.getByLabel('Confirm password').fill('too-short');
 await person.getByRole('button',{name:'Save and sign in'}).click();
 await expect(alertWith(person,'Use at least 10 characters for your password.')).toBeVisible();
 expect(rows<{used_at:string|null}>(`select used_at from public.company_links where secret_hash='${hash(secret)}'`)[0].used_at).toBeNull();
 await person.getByLabel('New password').fill(newPassword);
 await person.getByLabel('Confirm password').fill(newPassword);
 await person.getByRole('button',{name:'Save and sign in'}).click();
 await expect(person).toHaveURL(/\/c\/rs-learning\/home$/);

 // The other device's session ended.
 await old.reload();
 await expect(old).toHaveURL(/\/sign-in/);
 await device.close();

 // Made and used are in the Company log; the new password signs in, the old one no longer does.
 expect(rows<{action:string,actor_id:string}>(`select action,actor_id from public.company_log where company_id='${company}' and action like 'password_link_%' order by id`))
  .toEqual([{action:'password_link_made',actor_id:'20000000-0000-0000-0000-000000000002'},{action:'password_link_used',actor_id:viewer}]);
 await fresh.clearCookies();
 await person.goto('/sign-in');
 await person.getByLabel('Email',{exact:true}).fill('viewer@example.com');
 await person.getByLabel('Password',{exact:true}).fill(seededPassword);
 await person.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(alertWith(person,'Wrong email or password.')).toBeVisible();
 await signIn(person,'viewer@example.com','/c/rs-learning/home',newPassword);
 await expect(person).toHaveURL(/\/c\/rs-learning\/home$/);

 // A second use is refused with the clear page, and its submit too.
 await fresh.clearCookies();
 await person.goto(link);
 await expect(alertWith(person,refusedPage)).toHaveText(refusedPage);
 await expect(person.getByLabel('New password')).toHaveCount(0);
 const again=await person.request.post('/password/submit',{form:{code:secret,language:'en',password:'another-password-954',confirm:'another-password-954'}});
 expect(again.status()).toBe(410);
 expect(await again.text()).toBe(refusedPage);
 await fresh.close();
});

test('an Administrator makes a password link for a Manager; an ended link and one replaced by a newer link are refused with the clear page',async({page,browser})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/work/board');
 const dialog=await openTeam(page);
 await dialog.getByRole('button',{name:'Make a password link for مدير'}).click();
 const first=await dialog.getByRole('textbox',{name:'Password link for مدير'}).inputValue();
 await dialog.locator('#pwl-h').getByRole('button',{name:'Done'}).click();
 await expect(dialog.getByRole('textbox',{name:'Password link for مدير'})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Make a password link for مدير'}).click();
 await expect(dialog.getByRole('textbox',{name:'Password link for مدير'})).not.toHaveValue(first);
 const second=await dialog.getByRole('textbox',{name:'Password link for مدير'}).inputValue();

 const fresh=await browser.newContext();
 const person=await fresh.newPage();
 // The first link was replaced by the second.
 await person.goto(first);
 await expect(alertWith(person,refusedPage)).toHaveText(refusedPage);
 // The second, once its 24 hours are over.
 query(`update public.company_links set created_at=now()-interval '2 days',ends_at=now()-interval '1 day' where secret_hash='${hash(second.split('#code=')[1])}'`);
 await person.goto('about:blank');
 await person.goto(second);
 await expect(alertWith(person,refusedPage)).toHaveText(refusedPage);
 const ended=await person.request.post('/password/submit',{form:{code:second.split('#code=')[1],language:'en',password:'manager-new-password',confirm:'manager-new-password'}});
 expect(ended.status()).toBe(410);
 await fresh.close();
 // The Manager's password never changed.
 await page.context().clearCookies();
 await signIn(page,'manager@example.com','/c/rs-learning/home');
});
