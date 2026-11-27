// The journey a cloud session walks as a real person before it pushes (#485; docs/agents/cloud-verify.md), against the
// app `npm run cloud:up` started: Chromium, driven by Playwright, clicks, types and submits, and every step is checked
// on the page and in the local database. Screenshots of each step land in the output folder.
//   node scripts/cloud-verify.mjs            the whole journey: first run on an empty install, sign-in, a message to
//                                            Lead, Numbers; then, on the seed put back, the Engine's Card on the board
//   node scripts/cloud-verify.mjs --sign-in  only: the seeded Owner signs in and reaches a signed-in page
//   --out DIR                                where the screenshots go (default $TMPDIR/gtmworks-cloud/screens)
// It refuses any app or database but the local stack's (scripts/first-run-db.mjs assertLocalTarget).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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

// `next dev` compiles a page the first time it is asked for, and that compile rebuilds the client code the Company layout
// shares: the page the browser is on reloads itself and the press that asked for the new page is lost (the first-run
// answer stayed on Home while its Conversation was made). So the seeded Owner opens every page the journey walks, in a
// browser of its own, and waits on each until the dev server has stopped rebuilding (its hot reload says so in the
// console); next.config.mjs keeps them compiled while the server runs. A Conversation nobody has is enough to compile
// its page.
const journeyPages=slug=>[`/c/${slug}/home`,`/c/${slug}/conversations/${randomUUID()}`,`/c/${slug}/numbers`,`/c/${slug}/work/board`];
async function compileJourneyPages(browser) {
 const context=await browser.newContext();
 try {
  const page=await context.newPage();
  let building=false, last=Date.now();
  page.on('console',message=>{
   const text=message.text();
   if(text.startsWith('[Fast Refresh] rebuilding')) { building=true; last=Date.now(); }
   else if(/^\[Fast Refresh\] (done|performing full reload)/.test(text)) { building=false; last=Date.now(); }
  });
  page.on('load',()=>{ building=false; last=Date.now(); });
  await signIn(page,seeded.email,seeded.password);
  for(const path of journeyPages(seeded.company)) {
   // The compile this asks for can reload the page under the navigation; the page is asked for again until it answers.
   await expect(async()=>{
    const response=await page.goto(`${origin}${path}`);
    if(!response||response.status()>=500) throw new Error(`${path} answered ${response?.status()}`);
   }).toPass({timeout:120000});
   await expect.poll(()=>!building&&Date.now()-last>3000,{message:`the dev server kept rebuilding after ${path}`,timeout:120000}).toBe(true);
  }
 } finally { await context.close(); }
}

async function signInOnly(page) {
 await signIn(page,seeded.email,seeded.password);
 await expect(page.locator('.sidebar')).toBeVisible({timeout:60000});
 const file=join(out,'cloud-verify-signed-in.png'); await page.screenshot({path:file});
 const reached=page.url();
 // The pages a session walks are compiled now, so its first press on one is not lost to a reload.
 await compileJourneyPages(page.context().browser());
 return `Signed in as ${seeded.email} at ${reached} (screenshot ${file})`;
}

async function journey(page) {
 await compileJourneyPages(page.context().browser());
 step('the dev server has compiled every page the journey opens');
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
 step(`first run created the Administrator ${owner.email} and the Company "${owner.company}" (/c/${slug}); the database has them as owner (the Administrator Role)`);

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
 step('signed out, the Administrator signed in with the password and opened the workspace on a Conversation with Lead');

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
 // 5. The board, on the seed put back: the Company's Engine's own Kanban board (spec #831). The fake Engine cloud:up
 // started holds one Card being worked (scripts/cloud-hermes.mjs), and the seeded Owner finds it in In progress, read
 // through gtmworks, with its symbol.
 putSeedBack();
 step('the seeded data is back');
 await page.context().clearCookies();
 await signIn(page,seeded.email,seeded.password);
 await page.goto(`${origin}/c/${seeded.company}/home`);
 await page.locator('.sidebar').getByRole('link',{name:'Marketing board',exact:true}).click();
 await expect(page).toHaveURL(`${origin}/c/${seeded.company}/work/board`);
 await expect(page.locator('#board-cols > .col .col__name')).toHaveText(['Waiting on you','Ideas','Planned','In progress','Done']);
 const engineCard=page.locator('.col[data-column="progress"]').getByRole('article',{name:/^Weekly report for the team/});
 await expect(engineCard).toBeVisible({timeout:15000});
 await expect(engineCard.getByRole('img',{name:'Working on it now'})).toBeVisible();
 await screenshot(page,'board');
 step('the board reads the Engine: its Card "Weekly report for the team" is in In progress, working now');
}

const browser=await chromium.launch();
try {
 const page=await (await browser.newContext({viewport:{width:1440,height:900}})).newPage();
 if(mode==='sign-in') console.log(await signInOnly(page));
 else {
  // A reload the dev server forces on the page drops what was being done there; the journey names it when it fails.
  const reloads=[];
  page.on('console',message=>{ if(message.text().startsWith('[Fast Refresh] performing full reload')) reloads.push(page.url()); });
  try { await journey(page); }
  catch(error) {
   await screenshot(page,'failed').catch(()=>{});
   if(reloads.length) error.message+=`\nThe dev server reloaded the page while it compiled (on ${reloads.join(', ')}): is a page the journey opens missing from journeyPages?`;
   throw error;
  }
  // Passed or not, the journey ends on the seed as local-db.sh left it: no journey Owner, Company or Card stays behind.
  finally { putSeedBack(); }
  console.log(`Journey passed; screenshots in ${out}`);
 }
} finally { await browser.close(); }
