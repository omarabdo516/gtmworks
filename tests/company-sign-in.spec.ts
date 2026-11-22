import { test, expect } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import en from '../lib/messages/en.json';
import ar from '../lib/messages/ar.json';

// A company connects its own ChatGPT subscription on the root profile of its own Engine (#384, ADR 0018), and every
// Agent of the Company uses it. Against a fake Hermes, the Owner sees the code and the link, the page says Connected
// once the sign-in finishes, a second account is added beside the first (#618), and Disconnect removes one account from
// that Engine and leaves the other; a member sees the state only, with no button,
// and the server refuses them too. Claude is the install's command, and the page says one account serves one Company.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const aleem='10000000-0000-0000-0000-000000000003';
const omar='20000000-0000-0000-0000-000000000001';
const member='20000000-0000-0000-0000-000000000005';
const profile='co-10000000000000000000000000000003';

test('the Owner signs the company in to ChatGPT and out again; a member only sees whether it is connected',async({page,browser})=>{
 // The driver reaches the management listener on port 9119 of the bundled Hermes address, as in the install.
 const fake=await laneHermes();
 fake.settings.profiles.set(profile,{soul:'',provider:'auto',model:'',key:fake.settings.key,config:{},credentials:{}});
 const languages=JSON.parse(query(`select id,language from public.people where id in ('${omar}','${member}')`)) as {id:string,language:string}[];
 const agent=randomUUID();
 try {
  query(`update public.people set language='en' where id in ('${omar}','${member}')`);
  await signIn(page,'omar@example.com','/c/aleem/settings?section=models');
  // Lead on the company's own profile of the bundled Hermes, with the profile recorded, as the worker leaves it.
  query(`insert into public.hermes_agents(id,company_id,name,speciality,profile) values ('${agent}','${aleem}','Lead','General','${profile}')`);
  query(`insert into public.company_profiles(company_id,profile,tools_confirmed) values ('${aleem}','${profile}',true)`);

  // A member: the state, no button, and the server refuses a start.
  const context=await browser.newContext(); const other=await context.newPage();
  await signIn(other,'multi@example.com','/c/aleem/settings?section=models');
  // No subscription is connected yet, and a member has no row to connect one (#617). This Company has no space in the
  // Engine for keys, so they read as unread rather than as nothing connected.
  await expect(other.locator('#pv-keys-unread')).toHaveText(en.settingsModelsKeyUnread);
  await expect(other.locator('#md-providers .pv-row')).toHaveCount(0);
  await expect(other.locator('#md-providers').getByRole('button')).toHaveCount(0);
  const refused=await other.request.post('/api/company-sign-in',{data:{company:aleem,provider:'openai-codex',intent:'start'}});
  expect(refused.status()).toBe(403);
  expect(fake.settings.signInSessions.size).toBe(0);
  await context.close();

  // The Owner: the code and the link, then Connected on the Company's own Engine's root profile.
  // ChatGPT is connected from the list's last row, which a desktop opens first while nothing is connected (#617).
  await page.goto('/c/aleem/settings?section=models');
  const add=page.locator('#pv-d-add');
  const chatgpt=page.locator('#add-sub-openai-codex');
  await expect(chatgpt.getByText('Not connected')).toBeVisible();
  // The sign-in says, in one line, that another account is added beside the others and one account serves one Company.
  await expect(add).toContainText(`${en.signInWhat} ${en.providersAnotherAccount} ${en.signInOneAccount}`);
  await chatgpt.getByRole('button',{name:'Connect ChatGPT'}).click();
  await expect(chatgpt.getByText('ABCD-1234')).toBeVisible();
  await expect(chatgpt.getByRole('link',{name:'Open the sign-in page'})).toHaveAttribute('href','https://auth.provider.test/codex/device');
  const [session]=[...fake.settings.signInSessions.keys()];
  expect(fake.settings.signInSessions.get(session)?.profile).toBe('default');
  fake.settings.approve(session,'said');
  // Once connected it is a Provider of its own, whose details open in the place of the row that connected it.
  const [first]=fake.settings.defaultPool['openai-codex'];
  const firstDetail=page.locator(`#pv-d-sub-openai-codex-${first.id}`);
  await expect(firstDetail.locator(`#sub-openai-codex-${first.id}-state`)).toHaveText('Connected',{timeout:20000});
  await expect(page.getByRole('region',{name:'ChatGPT'}).getByRole('heading',{name:'ChatGPT'})).toBeVisible();
  // The credential is on the Engine's root profile only, and the page never shows it.
  const credential=fake.settings.defaultCredentials['openai-codex'];
  expect(credential).toBeTruthy();
  expect(fake.settings.profiles.get(profile)!.credentials['openai-codex']).toBeUndefined();
  expect(await page.content()).not.toContain(credential!.slice(-6));

  // A second ChatGPT account (#618): connected from the same last row, it is added beside the first, which still serves.
  await page.locator('#pv-row-add').click();
  await expect(chatgpt.getByText('Connected',{exact:true})).toBeVisible();
  await chatgpt.getByRole('button',{name:'Connect another ChatGPT account'}).click();
  await expect(chatgpt.getByText('ABCD-1234')).toBeVisible();
  const second=[...fake.settings.signInSessions.keys()].find(id=>id!==session)!;
  fake.settings.approve(second,'omar');
  const secondId=fake.settings.defaultPool['openai-codex'][1].id;
  await expect(page.locator(`#pv-row-sub-openai-codex-${secondId}`)).toContainText('ChatGPT 2',{timeout:20000});
  await expect(page.locator(`#pv-row-sub-openai-codex-${first.id}`)).toContainText('ChatGPT');
  expect(fake.settings.defaultPool['openai-codex'].map(row=>row.id)).toEqual([first.id,secondId]);
  expect(fake.settings.defaultCredentials['openai-codex']).toBe(credential);
  // Claude signs in from the install's command line, for this Company.
  await page.locator('#pv-row-add').click();
  await expect(page.locator('#add-sub-anthropic code')).toContainText('gtmworks sign-in claude --company "Aleem"');

  // Disconnecting the second account leaves the first connected.
  await page.locator(`#pv-row-sub-openai-codex-${secondId}`).click();
  await page.locator(`#pv-d-sub-openai-codex-${secondId}`).getByRole('button',{name:'Disconnect ChatGPT 2'}).click();
  await expect(page.locator(`#pv-row-sub-openai-codex-${secondId}`)).toHaveCount(0);
  await expect(page.locator(`#pv-row-sub-openai-codex-${first.id}`)).toBeVisible();
  expect(fake.settings.defaultCredentials['openai-codex']).toBe(credential);
  // And the first, last, leaves nothing connected.
  await page.locator(`#pv-row-sub-openai-codex-${first.id}`).click();
  await firstDetail.getByRole('button',{name:'Disconnect ChatGPT'}).click();
  await expect(page.locator(`#pv-row-sub-openai-codex-${first.id}`)).toHaveCount(0);
  await expect(chatgpt.getByText('Not connected')).toBeVisible();
  expect(fake.settings.defaultCredentials['openai-codex']).toBeUndefined();

  // The same one line in Arabic.
  query(`update public.people set language='ar' where id='${omar}'`);
  await page.goto('/c/aleem/settings?section=models');
  await expect(page.locator('html')).toHaveAttribute('lang','ar');
  await expect(page.locator('#pv-d-add')).toContainText(`${ar.signInWhat} ${ar.providersAnotherAccount} ${ar.signInOneAccount}`);
 } finally {
  query(`delete from public.company_profiles where company_id='${aleem}'`);
  query(`delete from public.hermes_agents where id='${agent}'`);
  for(const person of languages) query(`update public.people set language='${person.language}' where id='${person.id}'`);
  await fake.close();
 }
});
