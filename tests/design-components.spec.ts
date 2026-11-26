import { test, expect } from './fresh-seed';
import { signIn } from './sign-in';
import { idle } from './navigation-measure';
import { asAdmin } from './slow-reads';
import { design, differences, expected, placements, split, type Language, type Theme } from './design-components';
import { laneHermes } from './lane-hermes';

// Every component DESIGN.md names is drawn with its values (#808): its background, text colour, radius, padding, height,
// shadow and font, read from the computed styles where a screen of the seed draws it, in light and dark, in English and
// Arabic, and its hover where DESIGN.md names one. No picture is compared.
const omar = '20000000-0000-0000-0000-000000000001';
const languages: Language[] = ['en', 'ar'];
const themes: Theme[] = ['light', 'dark'];

// The board is the Company's Engine's own Kanban board (spec #831): its tile is drawn from a Card on the fake Engine.
let fake: Awaited<ReturnType<typeof laneHermes>>;
test.beforeAll(async () => {
  fake = await laneHermes();
  fake.settings.kanban.task({ title: 'Weekly report for the team', status: 'ready' });
});
test.afterAll(async () => {
  asAdmin(`update public.people set language='en' where id='${omar}'`);
  await fake?.close();
});

test('every component DESIGN.md names has a place on a screen, and only those', () => {
  expect(Object.keys(placements).sort()).toEqual(Object.keys(design.components).sort());
});

for (const language of languages) {
  test(`every component is drawn with DESIGN.md's values in ${language}, light and dark`, async ({ page }) => {
    test.setTimeout(180000);
    asAdmin(`update public.people set language='${language}' where id='${omar}'`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, 'omar@example.com', '/c/rs-learning/home');
    const problems: string[] = [];
    for (const theme of themes) {
      await page.emulateMedia({ colorScheme: theme });
      for (const [name, place] of Object.entries(placements)) {
        await test.step(`${name}, ${theme}`, async () => {
          await page.goto(place.path);
          await expect(page.locator('html')).toHaveAttribute('lang', language);
          await idle(page);
          if (place.open) await place.open(page);
          const element = page.locator(place.selector).first();
          await expect(element).toBeVisible();
          if (place.hover) {
            await element.hover();
            // The hover's colour transition runs out before the colour is read.
            await expect.poll(() => element.evaluate(found => found.getAnimations().length)).toBe(0);
          }
          for (const [selector, values] of split(place, expected(name, theme, language))) problems.push(...(await differences(page, name, selector, values)).map(problem => `${language}, ${theme}: ${problem}`));
        });
      }
    }
    expect(problems).toEqual([]);
  });
}
