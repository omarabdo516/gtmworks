import { expect, type Page } from '@playwright/test';

// The interface language is chosen in the settings overlay's "Your account" (#26) and saved to the account at once.
// A choice clicked before the page has hydrated does nothing, so the click is repeated until the page follows it.
export async function chooseLanguageInSettings(page:Page,language:string,company='rs-learning') {
 await page.goto(`/c/${company}/settings?section=account`);
 const choice=page.locator(`#ac-lang-${language}`);
 await expect(async()=>{
  if(await choice.getAttribute('aria-checked')!=='true') await choice.click();
  await expect(page.locator('html')).toHaveAttribute('lang',language,{timeout:3000});
 }).toPass({timeout:30000});
}
