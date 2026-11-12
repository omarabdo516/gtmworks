import { test, expect, type Page, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { signIn } from './sign-in';

// Clicks Save and waits until the server action has answered and the page has drawn its result. React resets an action form when the action ends, so typing before that would be wiped.
async function save(page:Page,button:Locator) {
 await Promise.all([page.waitForResponse(response=>response.request().method()==='POST'),button.click()]);
 await page.waitForLoadState('networkidle');
 await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
}

async function chooseLanguage(page:Page,language:'en'|'ar') {
 await page.goto('/c/rs-learning/settings');
 await page.locator('select[name=language]').selectOption(language);
 await page.locator('form').filter({has:page.locator('select[name=language]')}).getByRole('button').click();
 await expect(page.locator('html')).toHaveAttribute('lang',language);
}
// The picture of the page as it is now, phone and desktop; the CI step keeps test-results/screenshots for the pull request.
async function shoot(page:Page,name:string) {
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:900});
  await page.screenshot({path:`test-results/screenshots/${name}-${width}.png`});
 }
 await page.setViewportSize({width:1280,height:720});
}

test('a project is created, a card is filed into it, and the board and list show only that card',async({page})=>{
 await mkdir('test-results/screenshots',{recursive:true});
 await signIn(page,'omar@example.com','/c/rs-consultations/projects');
 // A company without projects shows the empty state.
 await expect(page.locator('.content .empty')).toHaveText('No projects yet');
 await page.goto('/c/rs-learning/projects');
 const name=`Spring launch ${Date.now()}`;
 const form=page.getByRole('form',{name:'New project',exact:true});
 await form.getByLabel('Project name').fill(name);
 await form.getByLabel('Goal').fill('Sell the spring course');
 await form.getByRole('button',{name:'Create project'}).click();
 const row=page.getByRole('form',{name,exact:true});
 await expect(row).toBeVisible();
 await expect(row.getByLabel('Goal')).toHaveValue('Sell the spring course');
 await expect(row.getByLabel('Project status')).toHaveValue('active');
 await expect(row).toContainText('Cards: 0');
 await row.getByLabel('Project status').selectOption('paused');
 await save(page,row.getByRole('button',{name:'Save'}));
 // The form is reset after the save: the status must stay on the saved value without a reload, so a second save (a new goal) keeps it.
 await expect(row.getByLabel('Project status')).toHaveValue('paused');
 await row.getByLabel('Goal').fill('Sell the spring course to returning students');
 await save(page,row.getByRole('button',{name:'Save'}));
 await expect(row.getByLabel('Goal')).toHaveValue('Sell the spring course to returning students');
 await expect(row.getByLabel('Project status')).toHaveValue('paused');
 await page.reload();
 await expect(page.getByRole('form',{name,exact:true}).getByLabel('Project status')).toHaveValue('paused');
 await expect(page.getByRole('form',{name,exact:true}).getByLabel('Goal')).toHaveValue('Sell the spring course to returning students');

 // File one card into it from the card.
 await page.goto('/c/rs-learning/work/board');
 const total=await page.locator('.card').count();
 expect(total).toBeGreaterThan(1);
 const title=(await page.locator('.card strong').first().innerText()).trim();
 await page.locator('.card a').first().click();
 await expect(page).toHaveURL(/\/work\/board\/\d+$/);
 const section=page.locator('[data-card-section=project]');
 await section.getByLabel('Project',{exact:true}).selectOption({label:name});
 await save(page,section.getByRole('button',{name:'Save'}));
 await expect(page.locator('.card-stage-line')).toContainText(name);
 // The picker keeps the saved project after the form resets, so another Save does not take the card out.
 await expect(section.getByLabel('Project',{exact:true})).toHaveValue(/^\d+$/);
 await save(page,section.getByRole('button',{name:'Save'}));
 await expect(section.getByLabel('Project',{exact:true})).toHaveValue(/^\d+$/);
 await expect(page.locator('.card-stage-line')).toContainText(name);
 await expect(page.locator('.detail-row').filter({hasText:`Filed the card in ${name}`})).toHaveCount(1);

 // The board and the list filter by project.
 await page.goto('/c/rs-learning/work/board');
 await page.getByLabel('Project',{exact:true}).selectOption({label:name});
 await expect(page.locator('.card')).toHaveCount(1);
 await expect(page.locator('.card').first()).toContainText(title);
 await page.getByLabel('Project',{exact:true}).selectOption({label:'All projects'});
 await expect(page.locator('.card')).toHaveCount(total);
 await page.goto('/c/rs-learning/work/list');
 await page.getByLabel('Project',{exact:true}).selectOption({label:name});
 await expect(page.locator('tbody tr')).toHaveCount(1);
 await expect(page.locator('tbody tr').first()).toContainText(title);

 // The project page counts it.
 await page.goto('/c/rs-learning/projects');
 await expect(page.getByRole('form',{name,exact:true})).toContainText('Cards: 1');
 await expect(page.getByRole('form',{name,exact:true})).toBeVisible();
 // The same three pages in both languages, phone and desktop.
 try {
  for(const language of ['en','ar'] as const) {
   await chooseLanguage(page,language);
   await page.goto('/c/rs-learning/projects');
   await expect(page.getByRole('form',{name,exact:true})).toBeVisible();
   await shoot(page,`projects-page-${language}`);
   await page.goto('/c/rs-learning/work/board');
   await page.locator('.work-filters select[data-toolbar-control]').selectOption({label:name});
   await expect(page.locator('.card')).toHaveCount(1);
   await shoot(page,`projects-board-${language}`);
   await page.locator('.card a').first().click();
   await expect(page).toHaveURL(/\/work\/board\/\d+$/);
   await expect(page.locator('[data-card-section=project] select')).toBeVisible();
   await shoot(page,`projects-card-${language}`);
  }
 } finally { await chooseLanguage(page,'en'); }
});

test('a viewer sees projects but cannot change them',async({page})=>{
 await signIn(page,'viewer@example.com','/c/rs-learning/projects');
 await expect(page.locator('.content .settings-row').first()).toBeVisible();
 await expect(page.getByRole('form',{name:'New project',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Create project'})).toHaveCount(0);
});
