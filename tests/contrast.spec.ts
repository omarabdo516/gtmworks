import { test, expect, type Page } from './fresh-seed';
import { signIn, openNavigation } from './sign-in';
import { idle } from './navigation-measure';
import { asAdmin } from './slow-reads';
import { expectDarkContrast, expectQuietContrast, type QuietCheck } from './contrast';

// Text contrast on the key screens, measured from the styles the browser draws with, never from a picture (#805): every
// visible text run keeps 4.5:1 in the dark theme, in Arabic and English at 1440 and 390, and the quiet labels of Home, the
// board and a Card keep 4.5:1 and stay weaker than the body text in the light theme. These checks were the visual lane's
// (#257); the lane went, and contrast checks never go away (#218).
const omar = '20000000-0000-0000-0000-000000000001';
const screens: { name: string, path: string, ready: string, quiet?: QuietCheck[] }[] = [
  { name: 'home', path: '/c/rs-learning/home', ready: '.home-dashboard', quiet: [['chart subtitle', '.home-charts article h2 + span'], ['sidebar heading', '.sidebar .sb-label'], ['account role', '.sidebar .me__role']] },
  { name: 'board', path: '/c/rs-learning/work/board', ready: '.board', quiet: [['toolbar label', '.work-toolbar .tabs a:not(.active), .work-toolbar .tabs button:not(.active)']] },
  { name: 'card', path: '/c/rs-learning/work/board/1', ready: '.modal', quiet: [['comment placeholder', '.modal textarea[name=body]', '::placeholder']] },
  { name: 'chat', path: '/c/rs-learning/chat', ready: '.chat' },
  { name: 'agents', path: '/c/rs-learning/agents', ready: '.company-hermes-agents' },
  { name: 'members', path: '/c/rs-learning/settings/members', ready: '.member-row' },
  { name: 'numbers', path: '/c/rs-learning/numbers', ready: '.numbers-page' },
  { name: 'approvals', path: '/c/rs-learning/approvals', ready: '.approvals' },
];
const widths = [1440, 390];
const languages = ['ar', 'en'] as const;

async function open(page: Page, path: string, ready: string, language: string) {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.locator(ready).first()).toBeVisible();
  await idle(page);
}

test.afterAll(() => asAdmin(`update public.people set language='en' where id='${omar}'`));

for (const language of languages) {
  test(`every key screen keeps its text at 4.5:1 in ${language}, dark and light`, async ({ page }) => {
    test.setTimeout(180000);
    asAdmin(`update public.people set language='${language}' where id='${omar}'`);
    await signIn(page, 'omar@example.com', '/c/rs-learning/home');
    for (const screen of screens) for (const width of widths) {
      await test.step(`${screen.name} ${width}`, async () => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: 'dark' });
        await open(page, screen.path, screen.ready, language);
        await expectDarkContrast(page);
        if (!screen.quiet) return;
        await page.emulateMedia({ colorScheme: 'light' });
        await open(page, screen.path, screen.ready, language);
        if (screen.quiet.some(([, selector]) => selector.startsWith('.sidebar'))) await openNavigation(page);
        await expectQuietContrast(page, screen.quiet);
      });
    }
  });
}

test('the sign-in page keeps its text at 4.5:1 in the dark theme, in Arabic and English at 1440 and 390', async ({ page }) => {
  for (const language of languages) for (const width of widths) {
    await test.step(`${language} ${width}`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto('/sign-in');
      await page.locator('select').selectOption(language);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('input[name=email]')).toBeVisible();
      await idle(page);
      await expectDarkContrast(page);
    });
  }
});
