import { test, expect, type Page } from './fresh-seed';
import { chooseLanguageInSettings } from './choose-language';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';
// Supabase CLI targets the local test database by default; never pass --remote.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
// Spec #695: a new Card's request goes to one of the Company's own Agents; the seed gives RS Learning none, so this file
// makes its main Agent and removes it after each test.
// The old board's Cards stay on the board opened on Waiting on you (/approvals) until the Engine's board makes Cards
// (#836) and the old board is switched off (#846).
const lead='a6950000-0000-0000-0000-000000000001';
test.beforeEach(()=>{ query(`insert into public.hermes_agents(id,company_id,name,speciality,profile,is_default) values ('${lead}','10000000-0000-0000-0000-000000000001','Lead','General','request-lead-${process.pid}',true) on conflict (id) do nothing`); });
test.afterEach(()=>{ query(`delete from public.hermes_agents where id='${lead}'`); });
async function chooseLanguage(page:Page,language:'en'|'ar') {
 await chooseLanguageInSettings(page,language);
 await expect(page.locator('html')).toHaveAttribute('lang',language);
}

test('a message to an agent makes one card in Ideas with its message, assignment and mode, in both languages',async({page})=>{
 await mkdir('test-results/screenshots',{recursive:true});
 await signIn(page,'omar@example.com','/c/rs-learning/work/new');
 try {
  const message=`Plan the launch post ${Date.now()}\nMention the early price`;
  const title=message.split('\n')[0];
  await chooseLanguage(page,'en');
  await page.goto('/c/rs-learning/work/new');
  // The main Agent is preselected and the mode is chosen before sending.
  await expect(page.locator('input[name=agent]')).toHaveValue(lead);
  await page.getByLabel('Message',{exact:true}).fill(message);
  await page.locator('select[name=mode]').selectOption('do');
  // A double click is one submit; the key is also reused by a retried request.
  await page.getByRole('button',{name:'Create card',exact:true}).dblclick();
  await expect(page).toHaveURL(/\/work\/board\/\d+$/);
  const cardPath=new URL(page.url()).pathname;
  await expect(page.locator('.modal .comment-body').filter({hasText:'Mention the early price'})).toBeVisible();
  await expect(page.locator('.card-stage-line .mode-chip')).toHaveText('Do it now');
  await page.goto('/c/rs-learning/approvals');
  const onBoard=page.locator('.column[data-stage-name="أفكار"] .card').filter({hasText:title});
  await expect(onBoard).toHaveCount(1);
  await expect(page.locator('.card').filter({hasText:title})).toHaveCount(1);
  await expect(onBoard.locator('.mode-chip')).toHaveText('Do it now');
  // The chip is drawn in the board's own border, the same for every Agent: role colours are gone (#697).
  expect(await onBoard.locator('.mode-chip').evaluate(element=>{ const probe=document.createElement('span'); probe.style.borderColor='var(--gw-border-2)'; element.parentElement!.append(probe);
   const same=getComputedStyle(element).borderTopColor===getComputedStyle(probe).borderTopColor; probe.remove(); return same; })).toBe(true);
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:900});
   await page.screenshot({path:`test-results/screenshots/card-request-board-en-${width}.png`});
  }
  await page.setViewportSize({width:1280,height:720});
  await chooseLanguage(page,'ar');
  await page.goto(cardPath);
  await expect(page.locator('.card-stage-line .mode-chip')).toHaveText('نفّذ الآن');
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:900});
   await page.screenshot({path:`test-results/screenshots/card-request-card-ar-${width}.png`});
  }
 } finally { await chooseLanguage(page,'en'); }
});

test('the composer loads when it is opened and shows the page-opening bar while it arrives',async({page})=>{
 await signIn(page,'omar@example.com','/c/rs-learning/approvals');
 await expect(page.locator('.column').first()).toBeVisible();
 await page.waitForLoadState('networkidle');
 // Scripts that are still missing now are fetched on demand; hold them back to see the wait.
 let release:()=>void=()=>{}; const gate=new Promise<void>(resolve=>{release=resolve;});
 let held=0;
 await page.route('**/_next/static/chunks/**',async route=>{held++; await gate; await route.continue();});
 await page.getByRole('button',{name:'+ New card'}).click();
 await expect(page.getByRole('progressbar',{name:'Opening page'})).toBeVisible();
 await expect(page.getByLabel('Message',{exact:true})).toHaveCount(0);
 expect(held,'the composer is its own script').toBeGreaterThan(0);
 release();
 await expect(page.getByLabel('Message',{exact:true})).toBeVisible();
 await expect(page.getByRole('progressbar',{name:'Opening page'})).toHaveCount(0);
 await expect(page.locator('input[name=agent]')).toHaveValue(lead);
});
