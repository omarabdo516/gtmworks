// The journey a cloud session walks as a real person before it pushes (#485; docs/agents/cloud-verify.md), against the
// app `npm run cloud:up` started: Chromium, driven by Playwright, clicks, types and submits, and every step is checked
// on the page and in the local database. Screenshots of each step land in the output folder.
//   node scripts/cloud-verify.mjs            the whole journey: first run on an empty install, sign-in, a message to
//                                            Lead, Numbers; then, on the seed put back, a Card made and moved on the board
//   node scripts/cloud-verify.mjs --sign-in  only: the seeded Owner signs in and reaches a signed-in page
//   --out DIR                                where the screenshots go (default $TMPDIR/gtmworks-cloud/screens)
// It refuses any app or database but the local stack's (scripts/first-run-db.mjs assertLocalTarget).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { assertLocalTarget, localQuery, localStatement, resetRetryPause } from './first-run-db.mjs';
import { dbContainerOf, seedSnapshotOf } from '../tests/lane.mjs';

const origin='http://127.0.0.1:3000';
const args=process.argv.slice(2);
const usage=()=>{ console.error('usage: node scripts/cloud-verify.mjs [--sign-in] [--out DIR]'); process.exit(2); };
const outAt=args.indexOf('--out');
if(outAt>=0&&!args[outAt+1]) usage();
// cloud:up keeps its files outside the checkout (scripts/cloud-up.sh), where the dev server's watcher does not see them.
const state=join(tmpdir(),'gtmworks-cloud');
const out=resolve(outAt>=0?args[outAt+1]:join(state,'screens'));
const flags=outAt<0?args:args.filter((arg,i)=>i!==outAt&&i!==outAt+1);
if(flags.some(flag=>flag!=='--sign-in')||flags.length>1) usage();
const mode=flags.length?'sign-in':'journey';
// The checks run against the stack's own address only: the app and its API are the local ones.
assertLocalTarget(origin);
mkdirSync(out,{recursive:true});
// A journey's screenshots (cloud-verify-NN-step.png) replace the last journey's; nothing else in the folder is touched.
if(mode!=='sign-in') for(const file of readdirSync(out)) if(/^cloud-verify-\d{2}-[a-z-]+\.png$/.test(file)) rmSync(join(out,file));

const quote=value=>`'${String(value).replaceAll("'","''")}'`;
const query=sql=>localQuery(sql,origin);
let shot=0;
const screenshot=async(page,name)=>{ const file=join(out,`cloud-verify-${String(++shot).padStart(2,'0')}-${name}.png`); await page.screenshot({path:file}); return file; };
const step=text=>console.log(`✓ ${text}`);
// The seeded Owner of RS Learning (supabase/seed.sql); every seeded person has this password.
const seeded={email:'omar@example.com',password:'local-seed-password',company:'rs-learning'};

// The dev server shows a page before React takes it over, and what was typed or chosen before then is lost: the field
// is filled (or the radio checked, for a null value) again until the button it unlocks is enabled.
async function hydrated(field,value,button) {
 await expect(async()=>{ await (value===null?field.check():field.fill(value)); await expect(button).toBeEnabled({timeout:2000}); }).toPass({timeout:60000});
}

async function signIn(page,email,password) {
 await page.goto(`${origin}/sign-in`);
 for(let attempt=1;;attempt++) {
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  const outcome=async()=>!new URL(page.url()).pathname.startsWith('/sign-in')?'signed in':await page.getByText('Wrong email or password.').isVisible()?'wrong':await page.getByText('Too many sign-in attempts. Try again later.').isVisible()?'limited':'waiting';
  await expect.poll(outcome,{timeout:30000}).not.toBe('waiting');
  const result=await outcome();
  if(result==='signed in') return;
  if(result==='wrong') throw new Error(`Sign-in refused for ${email}: wrong email or password`);
  if(attempt>=10) throw new Error(`Sign-in for ${email} still rate limited after ${attempt} attempts`);
  await page.waitForTimeout(3000); await page.reload();
 }
}

// The seeded data back as local-db.sh saved it, on this machine's own Docker (as resetFirstRun pins it).
function putSeedBack() {
 // One transaction, as tests/fresh-seed.ts restores: the running app and worker never see half a seed, and a restore
 // that meets them in a deadlock is rolled back whole and tried again (resetRetryPause); any other error fails at once.
 for(let attempt=1;;attempt++) {
  try {
   execFileSync('docker',['--host','unix:///var/run/docker.sock','exec','-i','-e','PGOPTIONS=-c client_min_messages=warning',dbContainerOf(0),'psql','-X','-q','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','--single-transaction','--file=-'],
    {input:readFileSync(seedSnapshotOf(0)),stdio:['pipe','ignore','pipe']});
   return;
  } catch(error) {
   const pause=resetRetryPause(error?.stderr,attempt);
   if(pause===null) throw new Error(`Putting the seed back failed: ${error?.stderr||error}`);
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,pause);
  }
 }
}

async function signInOnly(page) {
 await signIn(page,seeded.email,seeded.password);
 await expect(page.locator('.sidebar')).toBeVisible({timeout:60000});
 const file=join(out,'cloud-verify-signed-in.png'); await page.screenshot({path:file});
 return `Signed in as ${seeded.email} at ${page.url()} (screenshot ${file})`;
}

async function journey(page) {
 const owner={name:'Cloud owner',email:'cloud-owner@example.test',password:'cloud-owner-password',company:'Cloud Company'};
 const code=readFileSync(join(state,'setup-code'),'utf8').trim();
 // In a process of its own, so the truncate's notices stay out of the journey's lines unless it fails.
 execFileSync(process.execPath,['--input-type=module','-e',`import { resetFirstRun } from './scripts/first-run-db.mjs'; resetFirstRun(${JSON.stringify(origin)});`],{stdio:['ignore','ignore','pipe']});
 step('the install is empty: no people, no Company, first run open');

 // 1. First run: the setup link creates the Owner and the first Company, and signs them in.
 await page.goto(`${origin}/first-run?language=en#code=${code}`);
 await page.getByLabel('Your name').fill(owner.name);
 await page.getByLabel('Email').fill(owner.email);
 await page.getByLabel('Password',{exact:true}).fill(owner.password);
 await page.getByLabel('Confirm password').fill(owner.password);
 await page.getByLabel('First company name').fill(owner.company);
 await screenshot(page,'first-run-filled');
 await page.getByRole('button',{name:'Create and sign in'}).click();
 await expect(page).toHaveURL(/\/c\/cloud-company-[a-f0-9]{8}\/home$/,{timeout:60000});
 const slug=new URL(page.url()).pathname.split('/')[2];
 const [company]=query(`select c.id,c.name,m.role,u.email,public.company_engine_profile(c.id) profile from public.companies c
  join public.members m on m.company_id=c.id join auth.users u on u.id=m.person_id where c.slug=${quote(slug)}`);
 expect(company).toMatchObject({name:owner.company,role:'owner',email:owner.email});
 await screenshot(page,'first-run-done');
 step(`first run created the Owner ${owner.email} and the Company "${owner.company}" (/c/${slug}); the database has them as owner`);

 // The worker's step on an install with the bundled Engine: the Company's own profile, and Lead on it. The fake Engine
 // answers every profile with its one key, so the step is the database function the worker calls.
 localStatement(`insert into public.company_profiles(company_id,profile,tools_confirmed,tools_pending,skills_shared)
  select id,public.company_engine_profile(id),true,false,true from public.companies where id=${quote(company.id)}`,origin);
 expect(query(`select public.attach_company_profile(${quote(company.id)}) attached`)).toEqual([{attached:true}]);

 // 2. Signed out, the Owner signs in with that email and password and answers the first question.
 await page.context().clearCookies();
 await signIn(page,owner.email,owner.password);
 await expect(page).toHaveURL(`${origin}/c/${slug}/home`);
 const question=page.getByRole('dialog',{name:'Will you work alone or with a team?'});
 const open=question.getByRole('button',{name:'Open the workspace'});
 await hydrated(question.getByRole('radio',{name:'Alone'}),null,open);
 await screenshot(page,'signed-in-question');
 await open.click();
 await expect(page).toHaveURL(new RegExp(`/c/${slug}/conversations/[0-9a-f-]{36}$`),{timeout:30000});
 const conversation=new URL(page.url()).pathname.split('/').pop();
 step('signed out, the Owner signed in with the password and opened the workspace on a Conversation with Lead');

 // 3. A message to Lead gets the Engine's reply in the same Conversation, and both are in the database.
 const message=`Plan the launch ${Date.now()}`;
 await page.locator('.composer__input').fill(message);
 await page.locator('.composer__input').press('Enter');
 await expect(page.locator('.msg').filter({hasText:`Reply to: ${message}`})).toBeVisible({timeout:30000});
 await screenshot(page,'chat-reply');
 await expect.poll(()=>query(`select author,body from public.conversation_messages where conversation_id=${quote(conversation)} and body like ${quote(`%${message}`)} order by id`),{timeout:15000})
  .toEqual([{author:'person',body:message},{author:'agent',body:`Reply to: ${message}`}]);
 step(`sent "${message}" to Lead; the reply shows in the Conversation and both messages are in conversation_messages`);

 // 4. Numbers, the KPI dashboard, from the sidebar.
 await page.locator('.sidebar').getByRole('link',{name:'Numbers',exact:true}).click();
 await expect(page).toHaveURL(`${origin}/c/${slug}/numbers`);
 await expect(page.getByRole('heading',{level:1,name:'Numbers'})).toBeVisible();
 await expect(page.getByText('Leads per day',{exact:true})).toBeVisible();
 await screenshot(page,'numbers');
 step('opened Numbers from the sidebar');
 // 5. The board, on the seed put back. A new Card is asked of one of the Company's own Agents (spec #695); the seed gives
 // RS Learning none, so the journey gives it its main Agent, which the seed put back at the end takes away again. The
 // seeded Owner makes a Card in RS Learning and carries it by mouse from Ideas to Planned; the move is in the database.
 putSeedBack();
 step('the seeded data is back');
 query(`insert into public.hermes_agents(company_id,name,speciality,profile,is_default) select id,'Lead','General','cloud-verify-lead',true from public.companies where slug='${seeded.company}' returning id`);
 await page.context().clearCookies();
 await signIn(page,seeded.email,seeded.password);
 // The seeded Owner lands in another of their Companies; RS Learning is the one whose Agents take Cards.
 await page.goto(`${origin}/c/${seeded.company}/home`);
 await page.locator('.sidebar').getByRole('link',{name:'Marketing board',exact:true}).click();
 await expect(page).toHaveURL(`${origin}/c/${seeded.company}/work/board`);
 await expect(page.locator('#board-cols > .col')).toHaveCount(6);
 await page.goto(`${origin}/c/${seeded.company}/work/new`);
 const title=`Cloud card ${Date.now()}`;
 const create=page.getByRole('button',{name:'Create card'});
 await hydrated(page.getByLabel('Message',{exact:true}),title,create);
 await create.click();
 await expect(page).toHaveURL(/\/work\/board\/\d+$/,{timeout:30000});
 const card=Number(new URL(page.url()).pathname.split('/').pop());
 await page.goto(`${origin}/c/${seeded.company}/work/board`);
 const source=page.locator(`.kcard[data-card-id="${card}"]`);
 await expect(page.locator(`.col[data-column="ideas"] .kcard[data-card-id="${card}"]`)).toBeVisible();
 await screenshot(page,'board-before-move');
 const from=await source.boundingBox(),to=await page.locator('.col[data-column="planned"] .col__body').boundingBox();
 await page.mouse.move(from.x+from.width/2,from.y+20);
 await page.mouse.down();
 await page.mouse.move(from.x+from.width/2+8,from.y+20,{steps:2});
 await page.mouse.move(to.x+to.width/2,to.y+40,{steps:10});
 await page.mouse.up();
 await expect(page.locator('.toast')).toContainText('Moved to “Planned”');
 await expect(page.locator(`.col[data-column="planned"] .kcard[data-card-id="${card}"]`)).toBeVisible();
 await screenshot(page,'board-after-move');
 await expect.poll(()=>query(`select c.title,s.board_column from public.work_cards c join public.work_stages s on s.id=c.stage_id where c.id=${card}`))
  .toEqual([{title,board_column:'planned'}]);
 step(`made the Card "${title}" and dragged it from Ideas to Planned; work_cards has it in the planned column`);
}

const browser=await chromium.launch();
try {
 const page=await (await browser.newContext({viewport:{width:1440,height:900}})).newPage();
 if(mode==='sign-in') console.log(await signInOnly(page));
 else {
  try { await journey(page); }
  catch(error) { await screenshot(page,'failed').catch(()=>{}); throw error; }
  // Passed or not, the journey ends on the seed as local-db.sh left it: no journey Owner, Company or Card stays behind.
  finally { putSeedBack(); }
  console.log(`Journey passed; screenshots in ${out}`);
 }
} finally { await browser.close(); }
