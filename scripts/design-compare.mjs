// Captures a named screen of the approved design reference and the same built screen at one width, language and
// theme, and writes them side by side (#285). Usage and flags: design/COMPARE.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';
import { anonymousCaptureUrl, defaultSignIn, outputPaths, parseArgs, referenceRoot, screens, startStaticServer } from './design-compare-lib.mjs';

const height = 900;

async function settle(page, network = true) {
  if (network) await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

// One step of the screen table. Below 1024 px the prototype's sidebar sits behind #mobile-menu (the built app's below
// 768 px, behind button.mobile-menu), so a hidden target inside it opens the menu first.
async function runStep(page, step) {
  const [[action, value]] = Object.entries(step);
  if (action === 'goto') return page.goto(new URL(value, page.url()).toString(), { waitUntil: 'commit' });
  const [selector, text] = Array.isArray(value) ? value : [value];
  const target = page.locator(selector).first();
  if (action === 'waitFor') return target.waitFor({ state: 'visible' });
  if (action === 'fill') return target.fill(text);
  if (action === 'waitGone') return page.locator(selector).waitFor({ state: 'hidden' });
  if (action === 'scrollTo') return target.scrollIntoViewIfNeeded();
  if (action === 'press') return page.keyboard.press(value);
  if (action === 'finish') {
    await target.waitFor({ state: 'attached' });
    return target.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  }
  // A narrow sidebar still sliding shut (after the "viewing as" switch) reads as visible until its transition ends;
  // an endless one (a pulse, a spinner) never ends and is not waited for.
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getComputedTiming().endTime === Infinity));
  const menu = page.locator('#mobile-menu, button.mobile-menu').first();
  if (!await target.isVisible() && await menu.isVisible()) await menu.click();
  await target.click();
}

async function captureReference(browser, options) {
  const server = await startStaticServer(referenceRoot);
  const context = await browser.newContext({ viewport: { width: options.width, height }, colorScheme: options.theme, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    // The prototype keeps its theme under this key and reads it before it draws.
    await page.addInitScript(theme => { localStorage.setItem('gtm-theme-v2', theme); }, options.theme);
    // A loading state the prototype shows for a moment (#172): it stays, since what replaces it waits on a timer.
    if (screens[options.screen].reference.hold) await page.addInitScript(() => {
      const start = window.setTimeout.bind(window);
      window.setTimeout = ((run, ms, ...rest) => (ms ?? 0) >= 100 ? 0 : start(run, ms, ...rest));
    });
    const fontFailures = [];
    page.on('requestfailed', request => { if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) fontFailures.push(request.url()); });
    const { port } = server.address();
    await page.goto(`http://127.0.0.1:${port}/index.html?lang=${options.lang}`);
    await settle(page);
    for (const step of screens[options.screen].reference.steps) await runStep(page, step);
    await settle(page);
    if (fontFailures.length) console.warn('Warning: IBM Plex could not be loaded from Google Fonts; the reference is drawn with fallback fonts.');
    return await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
  }
}

// The password sign-in of tests/sign-in.ts, with the local seed's password unless GTMWORKS_SIGN_IN_PASSWORD names another.
async function signIn(page, options) {
  await page.goto(`${options.builtUrl}/sign-in`);
  await page.getByLabel('Email', { exact: true }).fill(options.signIn);
  await page.getByLabel('Password', { exact: true }).fill(process.env.GTMWORKS_SIGN_IN_PASSWORD || 'local-seed-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  try { await page.waitForURL(url => !url.pathname.startsWith('/sign-in'), { timeout: 30000 }); }
  catch { throw new Error(`Could not sign in as ${options.signIn} with a password.`); }
  await settle(page);
}

// Language is a saved account setting, chosen in the settings overlay's "Your account".
async function chooseLanguage(page, options) {
  const company = options.builtPath.match(/^\/c\/[^/]+/)?.[0] ?? '/c/rs-learning';
  await page.goto(`${options.builtUrl}${company}/settings?section=account`);
  const choice = page.locator(`#ac-lang-${options.lang}`);
  if (!await choice.count()) return console.warn('Warning: no language setting was found; the built screen keeps its current language.');
  if (await choice.getAttribute('aria-checked') !== 'true') await choice.click();
  await page.waitForFunction(lang => document.documentElement.lang === lang, options.lang);
}

async function captureBuilt(browser, options) {
  // The product follows the device's colour scheme while the account's theme is "device", the seeded default.
  const context = await browser.newContext({ viewport: { width: options.width, height }, colorScheme: options.theme, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    if (options.signIn) {
      await signIn(page, options);
      await chooseLanguage(page, options);
      await page.goto(`${options.builtUrl}${options.builtPath}`);
    } else {
      // A visitor has no saved language; capture the page reached in the asked language and never navigate past it.
      await page.goto(`${options.builtUrl}${options.builtPath}`);
      const capture = anonymousCaptureUrl(page.url(), options.lang);
      if (capture !== page.url()) await page.goto(capture);
    }
    await settle(page);
    const screen = screens[options.screen];
    for (const step of screen.builtSteps ?? []) await runStep(page, step);
    if (screen.builtSteps) await settle(page, screen.builtSettle !== false);
    const shown = await page.evaluate(() => document.documentElement.lang);
    if (shown !== options.lang) console.warn(`Warning: the built page shows ${shown}, not ${options.lang}; its caption still says ${options.lang}.`);
    const landed = new URL(page.url()).pathname;
    if (landed.startsWith('/sign-in')) console.warn(`The built page asked for sign-in; pass --sign-in ${defaultSignIn} to reach ${options.builtPath}. The image shows the sign-in page.`);
    const saved = await page.locator('html').getAttribute('data-theme');
    if (saved && saved !== 'device' && saved !== options.theme) console.warn(`Warning: this account saved the ${saved} theme, so the built screen is ${saved}, not ${options.theme}.`);
    return await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
  } finally {
    await context.close();
  }
}

async function compose(browser, options, shots) {
  const caption = side => `${side} · ${options.width}px · ${options.lang} · ${options.theme}`;
  const column = (side, png) => `<figure><figcaption>${caption(side)}</figcaption><img src="data:image/png;base64,${png.toString('base64')}"></figure>`;
  const html = `<!doctype html><html lang="en" dir="ltr"><style>
    body { margin: 0; background: #e5e5e5; font: 600 20px/1 system-ui, sans-serif; color: #171717; }
    main { display: flex; gap: 16px; padding: 16px; align-items: flex-start; width: max-content; }
    figure { margin: 0; background: #fff; }
    figcaption { padding: 12px 16px; border-bottom: 1px solid #d4d4d4; }
    img { display: block; width: ${options.width}px; }
  </style><main>${column('reference', shots.reference)}${shots.built ? column('built', shots.built) : ''}</main></html>`;
  const page = await browser.newPage({ viewport: { width: (shots.built ? 2 : 1) * options.width + (shots.built ? 48 : 32), height } });
  try {
    await page.setContent(html);
    await page.evaluate(() => Promise.all(Array.from(document.images, image => image.decode())));
    return await page.screenshot({ fullPage: true });
  } finally {
    await page.close();
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(error.exitCode ?? 1);
  }
  const paths = outputPaths(options);
  const browser = await chromium.launch();
  try {
    const shots = { reference: await captureReference(browser, options) };
    if (!options.referenceOnly) shots.built = await captureBuilt(browser, options);
    mkdirSync(dirname(paths.sideBySide), { recursive: true });
    writeFileSync(paths.reference, shots.reference);
    if (shots.built) writeFileSync(paths.built, shots.built);
    writeFileSync(paths.sideBySide, await compose(browser, options, shots));
  } finally {
    await browser.close();
  }
  console.log(paths.sideBySide);
}

await main();
