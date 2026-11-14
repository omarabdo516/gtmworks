import { test, expect, type Page } from '@playwright/test';
import { chooseLanguageInSettings } from './choose-language';
import { mkdir } from 'node:fs/promises';
import { signIn } from './sign-in';
const headers={Authorization:'Bearer agt_local_fixture_for_tests_only'};
const own='/api/v1/companies/rs-learning/cards?next_actor=me';
const other='/api/v1/companies/aleem/cards?next_actor=me';
async function chooseLanguage(page:Page,language:'en'|'ar') {
 await chooseLanguageInSettings(page,language);
 await expect(page.locator('html')).toHaveAttribute('lang',language);
}
test('an owner revokes and grants the Writer for one company and the agent API follows, in both languages', async ({page}) => {
 await mkdir('test-results/screenshots',{recursive:true});
 await signIn(page,'omar@example.com','/c/rs-learning/agents');
 try {
  for(const copy of [
   {language:'en' as const,name:'Writer',has:'Has access',none:'No access',revoke:'Revoke access from Writer',grant:'Grant access to Writer'},
   {language:'ar' as const,name:'الكاتب',has:'لديه وصول',none:'بلا وصول',revoke:'سحب الوصول من الكاتب',grant:'منح الوصول إلى الكاتب'},
  ]) {
   await chooseLanguage(page,copy.language);
   await page.goto('/c/rs-learning/agents');
   const row=page.getByRole('form',{name:copy.name,exact:true});
   await expect(row.getByText(copy.has,{exact:true})).toBeVisible();
   expect((await page.request.get(own,{headers})).status()).toBe(200);
   // A company-A-only agent is not found in company B.
   expect((await page.request.get(other,{headers})).status()).toBe(404);
   await row.getByRole('button',{name:copy.revoke}).click();
   await expect(row.getByText(copy.none,{exact:true})).toBeVisible();
   await expect.poll(async()=> (await page.request.get(own,{headers})).status()).toBe(404);
   expect(await (await page.request.get(own,{headers})).json()).toEqual({error:'not found'});
   await row.getByRole('button',{name:copy.grant}).click();
   await expect(row.getByText(copy.has,{exact:true})).toBeVisible();
   await expect.poll(async()=> (await page.request.get(own,{headers})).status()).toBe(200);
   for(const width of [390,1440]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:`test-results/screenshots/agents-page-${copy.language}-${width}.png`,fullPage:true});
   }
  }
  await chooseLanguage(page,'en');
  await page.goto('/c/rs-learning/settings/members');
  await expect(page.getByText('Revoked agent access').first()).toBeVisible();
  await expect(page.getByText('Granted agent access').first()).toBeVisible();
 } finally { await chooseLanguage(page,'en'); }
});
