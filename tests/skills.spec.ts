import { test, expect, type Page } from './fresh-seed';
import { chooseLanguageInSettings } from './choose-language';
import { mkdir } from 'node:fs/promises';
import { signIn } from './sign-in';
const written=`---\nname: weekly-recap\ndescription: Writes the Friday recap of what shipped.\npermissions: [cards.read]\n---\n\n1. List the cards that moved to done this week.\n2. Write three lines about them.\n`;
async function chooseLanguage(page:Page,language:'en'|'ar') {
 await chooseLanguageInSettings(page,language);
 await expect(page.locator('html')).toHaveAttribute('lang',language);
}
test('a team member installs and enables a skill for the Writer, and a bad skill is refused', async ({page}) => {
 await mkdir('test-results/screenshots',{recursive:true});
 await signIn(page,'omar@example.com','/c/rs-learning/skills');
 try {
  await chooseLanguage(page,'en');
  await page.goto('/c/rs-learning/skills');
  await expect(page.locator('.content .empty')).toHaveText('No skills yet');
  // An upload with an install script is refused with the reason and stores nothing.
  await page.locator('input[type=file]').setInputFiles({name:'SKILL.md',mimeType:'text/markdown',buffer:Buffer.from('---\nname: shady\ndescription: Sets itself up\npostinstall: ./setup.sh\npermissions: none\n---\nDo things.\n')});
  await page.getByRole('button',{name:'Install skill',exact:true}).click();
  const refusal=page.locator('section[role=alert]');
  await expect(refusal).toContainText('This skill was not installed:');
  await expect(refusal).toContainText('it runs a script when installed');
  await expect(page.locator('.content .empty')).toHaveText('No skills yet');
  // Install from the library, then enable it for the Writer only.
  await page.getByRole('button',{name:'Install caption-hooks'}).click();
  await expect(page.getByRole('group',{name:'caption-hooks',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Install post-visual-brief'}).click();
  const writer=page.getByRole('form',{name:'caption-hooks Writer',exact:true});
  await expect(writer.getByText('Not enabled',{exact:true})).toBeVisible();
  await writer.getByRole('button',{name:'Enable caption-hooks for Writer'}).click();
  await expect(writer.getByText('Enabled',{exact:true})).toBeVisible();
  const designer=page.getByRole('form',{name:'post-visual-brief Designer',exact:true});
  await designer.getByRole('button',{name:'Enable post-visual-brief for Designer'}).click();
  await expect(designer.getByText('Enabled',{exact:true})).toBeVisible();
  // A skill the team writes goes through the same check and lands under My skills.
  await page.getByLabel('Skill text (SKILL.md)').fill(written);
  await page.getByRole('button',{name:'Save skill'}).click();
  await expect(page.getByRole('group',{name:'weekly-recap',exact:true})).toContainText('Written by the team');
  // The same page in Arabic, at phone and desktop width.
  for(const copy of [{language:'en' as const,heading:'Installed skills'},{language:'ar' as const,heading:'المهارات المثبّتة'}]) {
   await chooseLanguage(page,copy.language);
   await page.goto('/c/rs-learning/skills');
   await expect(page.getByRole('heading',{name:copy.heading})).toBeVisible();
   for(const width of [390,1440]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:`test-results/screenshots/skills-page-${copy.language}-${width}.png`,fullPage:true});
   }
  }
 } finally {
  await chooseLanguage(page,'en');
  // Leave nothing enabled for the next spec.
  await page.goto('/c/rs-learning/skills');
  for(const name of ['Disable caption-hooks for Writer','Disable post-visual-brief for Designer']) {
   const button=page.getByRole('button',{name});
   if(await button.count()) { await button.click(); await expect(button).toHaveCount(0); }
  }
 }
});
