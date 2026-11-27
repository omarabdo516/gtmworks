import { test, expect, type Page } from './offline-browser';
import { localQuery, localStatement, resetFirstRun } from '../scripts/first-run-db.mjs';
import { generateOwnerSecret, ownerLink, ownerSecretHash } from '../lib/owner-link.mjs';

// A first-Owner link (#383, ADR 0019) makes a Company that was held behind it: its sender types a name, email and password
// on the first-run screen with the Company's name preset, becomes that Company's Owner and lands in it signed in. Opening
// the page never uses the link up; sending the form does, once. An email that already has an account is refused and the
// link stays open, pointing the install owner at `company add --owner`.
const input={name:'Second Owner',email:'second-owner@example.test',password:'second-owner-password',confirm:'second-owner-password',language:'en'};
const held='Held Company';
// The command makes the Company's Engine first and holds its name behind a link (#382, #383): this makes that waiting
// Engine record and the link on it, and returns the secret only the installer's printed link would hold.
function holdCompany(baseURL:string,name=held) {
 const secret=generateOwnerSecret();
 localStatement(`with e as (insert into public.company_engines(address,key_encrypted) values ('http://gtmworks-engine-held:8642','cipher') returning id)
  insert into public.company_owner_links(engine_id,company_name,secret_hash) select id,'${name}','${ownerSecretHash(secret)}' from e`,baseURL);
 return secret;
}
const setupCode=process.env.SETUP_CODE!;
// First run's screen, which is the same screen the link opens: it makes the account that an email already has.
async function firstRun(page:Page,email:string) {
 await page.goto(`/first-run#code=${setupCode}`);
 await page.getByLabel('Your name').fill('Already Here');
 await page.getByLabel('Email').fill(email);
 await page.getByLabel('Password',{exact:true}).fill('already-here-password');
 await page.getByLabel('Confirm password').fill('already-here-password');
 await page.getByLabel('First company name').fill('First Company');
 await page.getByRole('button',{name:'Create and sign in'}).click();
 await expect(page).toHaveURL(/\/c\/first-company-[a-f0-9]{8}\/home$/);
}
const counts=(baseURL:string)=>localQuery(`select
 (select count(*)::int from auth.users) accounts,
 (select count(*)::int from public.people) people,
 (select count(*)::int from public.companies) companies,
 (select count(*)::int from public.members where role='owner') owners`,baseURL)[0];
const linkState=(baseURL:string)=>localQuery(`select claimed_at is not null used, secret_hash from public.company_owner_links`,baseURL);
async function fillOwner(page:Page,values:typeof input=input) {
 await page.getByLabel(/^(Your name|اسمك)$/).fill(values.name);
 await page.getByLabel(/^(Email|البريد الإلكتروني)$/).fill(values.email);
 await page.getByLabel(/^(Password|كلمة المرور)$/).fill(values.password);
 await page.getByLabel(/^(Confirm password|تأكيد كلمة المرور)$/).fill(values.confirm);
}
test.beforeEach(({baseURL})=>resetFirstRun(baseURL));
test.afterAll(({baseURL})=>resetFirstRun(baseURL,true));

test('a first-owner link makes the Company with its sender as Owner, signed in; opening it without sending keeps it, and a second send is refused',async({page,baseURL})=>{
 const secret=holdCompany(baseURL!);
 const requests:string[]=[];
 page.on('request',request=>requests.push(request.url()));
 expect(counts(baseURL!)).toEqual({accounts:0,people:0,companies:0,owners:0});
 // Opening the link shows the first-run screen with the Company's name preset (no new look): no Company exists yet.
 await page.goto(ownerLink(baseURL!,secret));
 await expect(page.getByLabel('Company')).toHaveValue(held);
 await expect(page.getByLabel('Company')).toHaveAttribute('readonly','');
 await expect(page.getByRole('button',{name:'Create and sign in'})).toBeVisible();
 // Leaving without sending uses nothing up.
 await page.goto('/sign-in');
 expect(counts(baseURL!)).toEqual({accounts:0,people:0,companies:0,owners:0});
 expect(linkState(baseURL!)).toEqual([{used:false,secret_hash:ownerSecretHash(secret)}]);
 // Sending the form makes the Company on the waiting Engine record with this person as its Owner, and signs them in.
 await page.goto(ownerLink(baseURL!,secret));
 await fillOwner(page);
 await page.getByRole('button',{name:'Create and sign in'}).click();
 await expect(page).toHaveURL(/\/c\/held-company-[a-f0-9]{8}\/home$/);
 await expect(page.locator('.home-dashboard')).toBeVisible();
 expect(counts(baseURL!)).toEqual({accounts:1,people:1,companies:1,owners:1});
 expect(localQuery(`select c.name,c.engine_id is not null attached,m.role,m.grant_publishing,m.grant_money_figures,m.grant_customer_data,p.name person
  from public.companies c join public.members m on m.company_id=c.id join public.people p on p.id=m.person_id`,baseURL)).toEqual([
  {name:held,attached:true,role:'owner',grant_publishing:true,grant_money_figures:true,grant_customer_data:true,person:input.name}]);
 expect(linkState(baseURL!)).toEqual([{used:true,secret_hash:ownerSecretHash(secret)}]);
 // Only the hash was kept: the secret is in no row, as only a printed link holds it.
 expect(localQuery(`select count(*)::int rows from public.company_owner_links where secret_hash='${secret}'`,baseURL)[0]).toEqual({rows:0});
 // The fragment is never sent to the server: no request address holds the secret.
 expect(requests.filter(url=>url.includes(secret))).toEqual([]);
 // Opening the used link again says so in the page's own words, in both languages, and shows no form.
 for(const [language,message] of [['en','This first-Administrator link has been used, or a newer one replaced it. Ask the install owner to print a new one.'],['ar','هذا الرابط الخاص بأول أدمن مستخدم بالفعل، أو حلّ محله رابط أحدث. اطلب من صاحب التثبيت طباعة رابط جديد.']]) {
  await page.goto(`/first-owner?language=${language}#code=${secret}`);
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(message);
  await expect(page.getByLabel('Your name')).toHaveCount(0);
 }
 // A second send of the same link is refused and creates no second account, person or Company.
 const again=await page.request.post('/first-owner/submit',{form:{...input,email:'late@example.test',code:secret},maxRedirects:0});
 expect(again.status()).toBe(410);
 expect(await again.text()).toBe('This first-Administrator link has been used, or a newer one replaced it. Ask the install owner to print a new one.');
 expect(counts(baseURL!)).toEqual({accounts:1,people:1,companies:1,owners:1});
});

test('an email that already has an account is refused, points to naming the Owner in the command, and leaves the link open',async({page,baseURL})=>{
 // The person already has an account on this install, made the way the product makes one: through first run.
 const existing='already-here@example.test';
 await firstRun(page,existing);
 const secret=holdCompany(baseURL!);
 await page.goto(ownerLink(baseURL!,secret));
 await fillOwner(page,{...input,email:existing});
 await page.getByRole('button',{name:'Create and sign in'}).click();
 // Back on the form, keeping the link's secret in the fragment, with a message that names the command to use instead.
 await expect(page).toHaveURL(new RegExp(`/first-owner\\?invalid=emailTaken&language=en#code=${secret}$`));
 await expect(page.getByRole('main').getByRole('alert')).toHaveText('This email already has an account. Ask the install owner to name it as the Administrator with gtmworks company add --owner <email>.');
 await expect(page.getByLabel('Your name')).toBeVisible();
 // Nothing was made and the link is still open: the same link works once, for someone else.
 expect(counts(baseURL!)).toEqual({accounts:1,people:1,companies:1,owners:1});
 expect(linkState(baseURL!)).toEqual([{used:false,secret_hash:ownerSecretHash(secret)}]);
 await fillOwner(page,{...input,email:'someone-new@example.test'});
 await page.getByRole('button',{name:'Create and sign in'}).click();
 await expect(page).toHaveURL(/\/c\/held-company-[a-f0-9]{8}\/home$/);
 expect(counts(baseURL!)).toEqual({accounts:2,people:2,companies:2,owners:2});
});
