import { test, expect } from './fresh-seed';
import type { Locator, Page } from '@playwright/test';
import { signIn } from './sign-in';
import { chooseLanguageInSettings } from './choose-language';
import en from '../lib/messages/en.json' with { type: 'json' };
import ar from '../lib/messages/ar.json' with { type: 'json' };

// #614: Settings rows stay short. A page or a section names itself with no paragraph under it, a row carries at most one
// short grey line, and the longer help waits behind an "i" that a mouse, the keyboard or a tap opens and closes.
// Company knowledge needs a running Engine to draw at all; tests/company-knowledge.spec.ts checks its head there.
const sections = ['company', 'agents', 'learning', 'models', 'apps', 'routines', 'usage', 'backup', 'account'];
// The explanations that were paragraphs under a name, by catalogue key; none may show until its "i" is opened.
const help = ['settingsCompanySub', 'settingsAgentsSub', 'settingsTalkTip', 'settingsUsageSub', 'settingsAccountSub', 'settingsModelsSub',
 'settingsKnowledgeSub', 'settingsLearningSub', 'settingsBackupSub', 'settingsRoutinesSub', 'settingsTeamHint',
 'settingsModelsDefaultHint', 'settingsModelsEachHint', 'settingsSpeechHint', 'settingsLearnSuggestHint', 'settingsLearnTapHint',
 'settingsLearnAskHint', 'settingsLearnOwnerHint', 'settingsChatsStayArabic'] as const;
const overlayOf = (page: Page) => page.locator('.sov');


async function expectConcise(page: Page, catalogue: Record<string, string>) {
 const overlay = overlayOf(page);
 await expect(overlay.locator('#sov-h')).toBeVisible();
 // No subtitle under the page's name, and no banner of tips.
 await expect(overlay.locator('.sov-head p')).toHaveCount(0);
 await expect(overlay.locator('.talk-tip > span')).toHaveCount(0);
 for (const key of help) await expect(overlay.getByText(catalogue[key], { exact: true }), key).toBeHidden();
 // Each row has its name and at most one short grey line.
 for (const row of await overlay.locator('.panel-row').all()) expect(await row.locator(':scope > .panel-row__text > .panel-row__d').count()).toBeLessThanOrEqual(1);
}
const shown = (info: Locator) => info.locator('.info__pop');

test('every Settings page names itself without a paragraph under it, in English and in Arabic', async ({ page }) => {
 await signIn(page, 'omar@example.com', '/c/rs-learning/settings');
 for (const [language, catalogue] of [['ar', ar], ['en', en]] as const) {
  await chooseLanguageInSettings(page, language);
  for (const section of sections) {
   await page.goto(`/c/rs-learning/settings?section=${section}`);
   await expectConcise(page, catalogue);
  }
 }
});

test('the help opens on a resting mouse and the keyboard, and Escape closes it without closing Settings', async ({ page }) => {
 await signIn(page, 'omar@example.com', '/c/rs-learning/settings?section=models');
 const overlay = overlayOf(page);
 const info = overlay.locator('.sov-head .info');
 const button = info.getByRole('button', { name: `More about ${en.settingsModels}` });
 await expect(button).toHaveAttribute('aria-expanded', 'false');
 // A resting mouse shows it; moving away hides it.
 await expect(async () => { await button.hover(); await expect(shown(info)).toBeVisible({ timeout: 2000 }); await expect(shown(info)).toHaveText(en.settingsModelsSub); }).toPass({ timeout: 30000 });
 await overlay.locator('#sov-h').hover();
 await expect(shown(info)).toBeHidden();
 // A click keeps it while the mouse is elsewhere; a second click hides it.
 await button.click();
 await overlay.locator('#sov-h').hover();
 await expect(shown(info)).toBeVisible();
 await button.click();
 await expect(shown(info)).toBeHidden();
 // The keyboard: landing on it shows it, Escape hides it and Settings stays open with the focus where it was.
 await button.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
 await expect(button).toBeFocused();
 await expect(shown(info)).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(shown(info)).toBeHidden();
 await expect(button).toBeFocused();
 await expect(page).toHaveURL(/section=models/);
 await expect(overlay).toBeVisible();
 // With nothing open, Escape is the overlay's own again.
 await page.keyboard.press('Escape');
 await expect(overlay).toHaveCount(0);
});

test('on an Arabic phone a tap opens the help inside the screen and a tap elsewhere closes it', async ({ browser, baseURL }) => {
 const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
 const page = await context.newPage();
 try {
  await signIn(page, 'omar@example.com', '/c/rs-learning/settings?section=account');
  await chooseLanguageInSettings(page, 'ar');
  for (const section of ['company', 'models', 'learning']) {
   await page.goto(`/c/rs-learning/settings?section=${section}`);
   const info = overlayOf(page).locator('.sov-head .info');
   const button = info.getByRole('button');
   await expect(async () => { await button.tap(); await expect(shown(info)).toBeVisible({ timeout: 2000 }); }).toPass({ timeout: 30000 });
   await expect(button).toHaveAttribute('aria-expanded', 'true');
   const box = (await shown(info).boundingBox())!;
   expect(box.x).toBeGreaterThanOrEqual(16);
   expect(box.x + box.width).toBeLessThanOrEqual(390 - 16);
   expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
   await page.screenshot({ path: test.info().outputPath(`help-${section}-ar-390.png`) });
   await overlayOf(page).locator('#sov-h').tap();
   await expect(shown(info)).toBeHidden();
  }
  await chooseLanguageInSettings(page, 'en');
 } finally { await context.close(); }
});
