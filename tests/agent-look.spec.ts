import { test, expect, freshSeed } from './fresh-seed';
import { execFileSync } from 'node:child_process';
import { signIn } from './sign-in';
import { appOrigin } from './lane.mjs';

// The Owner changes an Agent's look in its window (#698): from the Look row in Settings and the pencil on the details'
// face; every face of the Agent behind it changes at once, the change is kept and in the Activity log, and a Manager
// sees it on their next read with no way to change it.
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const company='10000000-0000-0000-0000-000000000001';
const reach='69800000-0000-0000-0000-000000000001';
const sidebarFace=(page:import('@playwright/test').Page)=>page.locator(`.agent-tile[data-agent="${reach}"] .face`);

test.describe.configure({mode:'serial'});
test.beforeAll(({},testInfo)=>{
 freshSeed(testInfo.file,testInfo.retry>0||testInfo.repeatEachIndex>0);
 query(`do $$ begin insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
  ('${reach}','${company}','69800000-0000-0000-0000-0000000000c1','Reach','Runs the ads.',false,'look-reach');
  insert into public.member_agent_access(company_id,person_id,agent_id) values ('${company}','20000000-0000-0000-0000-000000000002','${reach}'); end $$`);
});

test('the Owner changes a look from Settings and the details; it is kept, logged, and a Manager sees it with no way to change it',async({page,browser})=>{
 await page.setViewportSize({width:1440,height:900});
 await signIn(page,'omar@example.com',`/c/rs-learning/settings?agent=${reach}`);
 const before=await sidebarFace(page).getAttribute('data-colour');
 const row=page.locator('#set-look');
 await expect(row.locator('#set-look-val')).toHaveText(/^Automatic · /);
 await row.getByRole('button',{name:'Change Reach’s look'}).click();
 const window=page.getByRole('dialog',{name:'Change Reach’s look'});
 await expect(window.getByRole('radio',{name:'Circle'})).toBeFocused();
 await expect(window.getByRole('button',{name:'Reset to automatic'})).toBeDisabled();
 const colour=before==='rose'?'Teal':'Rose';
 await window.getByRole('radio',{name:colour}).click();
 // At once in every face behind the window, the sidebar's included.
 await expect(sidebarFace(page)).toHaveAttribute('data-colour',colour.toLowerCase());
 await expect(row.locator('#set-look-val')).toHaveText(new RegExp(`^Custom · ${colour} · `));
 await expect(window.getByRole('button',{name:'Reset to automatic'})).toBeEnabled();
 await page.screenshot({path:test.info().outputPath('look-window.png')});
 await page.keyboard.press('Escape');
 await expect(window).toHaveCount(0);
 await expect(row.getByRole('button',{name:'Change Reach’s look'})).toBeFocused();
 // Kept: a new page reads it back.
 await page.reload();
 await expect(sidebarFace(page)).toHaveAttribute('data-colour',colour.toLowerCase());
 // The Activity log names the part and the values.
 await page.goto('/c/rs-learning/log');
 await expect(page.getByText('changed the colour of Reach').first()).toBeVisible();
 // A Manager sees it on their next read, and has no pencil, no Change.
 const context=await browser.newContext({baseURL:appOrigin});
 try {
  const manager=await context.newPage();
  await manager.setViewportSize({width:1440,height:900});
  await signIn(manager,'manager@example.com',`/c/rs-learning/chat/${reach}`);
  await expect(sidebarFace(manager)).toHaveAttribute('data-colour',colour.toLowerCase());
  await expect(manager.getByRole('button',{name:'Change Reach’s look'})).toHaveCount(0);
  await manager.goto(`/c/rs-learning/settings?agent=${reach}`);
  await expect(manager.locator('#set-look-val')).toHaveText(new RegExp(`^Custom · ${colour} · `));
  await expect(manager.getByRole('button',{name:'Change Reach’s look'})).toHaveCount(0);
 } finally { await context.close(); }
 // The Owner resets it from the pencil on the details' face.
 await page.goto(`/c/rs-learning/chat/${reach}`);
 await page.locator('#dp-look').click();
 const again=page.getByRole('dialog',{name:'Change Reach’s look'});
 await again.getByRole('button',{name:'Reset to automatic'}).click();
 await expect(sidebarFace(page)).toHaveAttribute('data-colour',before!);
 await page.keyboard.press('Escape');
 await expect(page.locator('#dp-look')).toBeFocused();
 await page.reload();
 await expect(sidebarFace(page)).toHaveAttribute('data-colour',before!);
});
