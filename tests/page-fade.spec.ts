import { test, expect, type Page } from './fresh-seed';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';
import { faceAnimations, faceTransitions } from './navigation-measure';

// A page fades in when it opens, as the reference's view does (#135, design-reference setView and .view-enter): the
// page drawn in the page region (.app-content), or on a chat page the chat beside the details panel, plays fadeIn once per page opened
// from the sidebar; a Conversation's polling plays nothing; the sidebar and the details panel never fade; and the row or
// tile that becomes current fades to its fill over the shared 150ms.
// Supabase CLI targets the local test database by default; never pass --remote.
const query = (sql: string) => execFileSync('npx', ['--no-install', 'supabase', 'db', 'query', sql, '-o', 'json', '--agent', 'no'], { encoding: 'utf8' });
const company = '10000000-0000-0000-0000-000000000001';

// Every animation that starts under the frame, by the part it runs on, and the lowest opacity the sidebar and the details
// panel show on any frame.
async function watch(page: Page) {
 await page.addInitScript(() => {
  const state = window as typeof window & { fades?: string[], rows?: string[], lowest?: Record<string, number> };
  state.fades = []; state.lowest = { sidebar: 1, details: 1 };
  document.addEventListener('animationstart', event => {
   const target = event.target as Element;
   const part = target.matches('.app-content > :not(.convo-page), .app-content > .convo-page .convo > :not(.details, .dp-scrim)') ? 'page'
    : target.closest('.details, .dp-scrim') ? 'details' : target.closest('.sidebar') ? 'sidebar' : 'other';
   if (part !== 'other') state.fades!.push(`${part} ${event.animationName}`);
  }, true);
  // The row or tile that is current changes its fill: by its transition, or by its arrival when its sidebar is drawn anew.
  state.rows = [];
  const filled = (event: Event) => {
   const target = event.target as Element;
   if (!target.matches?.('.sidebar :is(.sb-item, .agent-tile)[aria-current]')) return;
   if (event instanceof TransitionEvent && event.propertyName !== 'background-color') return;
   state.rows!.push(new URL((target as HTMLAnchorElement).href).pathname);
  };
  document.addEventListener('transitionrun', filled, true);
  document.addEventListener('animationstart', filled, true);
  const sample = () => {
   for (const part of ['sidebar', 'details']) {
    const element = document.querySelector(`.${part}`);
    if (element) state.lowest![part] = Math.min(state.lowest![part], Number(getComputedStyle(element).opacity));
   }
   requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
 });
}
const pageFades = (page: Page) => page.evaluate(() => (window as typeof window & { fades: string[] }).fades.filter(fade => fade.startsWith('page ')));
const stillFades = (page: Page) => page.evaluate(() => (window as typeof window & { fades: string[] }).fades.filter(fade => /^(sidebar|details) gw-fade-in$/.test(fade)));
const lowest = (page: Page) => page.evaluate(() => (window as typeof window & { lowest: Record<string, number> }).lowest);
// The part that fades: the chat on a chat page, the page drawn in the page region elsewhere.
const region = (page: Page) => page.evaluate(() => {
 const element = document.querySelector('.app-content > .convo-page .convo > .chat') ?? document.querySelector('.app-content > *')!;
 const style = getComputedStyle(element); return [style.animationName, style.animationDuration, style.animationTimingFunction];
});
// The shared five-property 150ms transition of everything a person can press (#128).
const pressFade = (element: Element) => { const style = getComputedStyle(element); return [style.transitionProperty, [...new Set(style.transitionDuration.split(', '))].join()]; };
const shared = ['background-color, box-shadow, color, border-color, transform', '0.15s'];
// Every motion on the page has ended, but an Agent face's own life, which never ends (#697): left out as the measured
// navigation leaves it out (tests/navigation-measure.ts).
const settle = (page: Page) => page.evaluate(async ({ names, parts }) => {
 const face = (animation: Animation) => animation instanceof CSSAnimation ? names.includes(animation.animationName)
  : !!((animation.effect as KeyframeEffect | null)?.target as Element | null)?.matches(parts);
 await Promise.all(document.getAnimations().filter(animation => !face(animation)).map(animation => animation.finished.catch(() => {})));
}, { names: faceAnimations, parts: faceTransitions });

test('each page opened from the sidebar fades in once, polling fades nothing, and the current row fades to its fill', async ({ page }) => {
 test.setTimeout(120000);
 const fake = await laneHermes(); fake.settings.pendingReads = 2;
 const agent = { id: randomUUID(), connection: randomUUID(), profile: `fade-${randomUUID().slice(0, 8)}` };
 try {
  query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values ('${agent.id}','${company}','${agent.connection}','Salma','Marketing',false,'${agent.profile}')`);
  query(`update public.people set language='en' where id='20000000-0000-0000-0000-000000000001'`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await watch(page);
  await signIn(page, 'omar@example.com', '/c/rs-learning/work/board');
  await expect(page.locator('.board')).toBeVisible();
  await settle(page);
  // The first screen after sign-in faded in as it was drawn.
  expect(await pageFades(page)).toContain('page gw-fade-in');
  let opened = (await pageFades(page)).length;
  const open = async (link: string, content: string) => {
   const href = await page.locator(link).getAttribute('href');
   await page.locator(link).click();
   await expect(page).toHaveURL(url => url.pathname === href);
   await expect(page.locator(content).first()).toBeVisible();
   expect(await region(page), link).toEqual(['gw-fade-in', '0.2s', 'cubic-bezier(0.2, 0, 0, 1)']);
   await settle(page);
   const fades = await pageFades(page);
   expect(fades.length - opened, `${link}: one fade per page opened`).toBe(1);
   expect(await page.evaluate(() => (window as typeof window & { rows: string[] }).rows), `${link}: the row that becomes current fades to its fill`).toContain(href);
   opened = fades.length;
  };
  await open('.nav a.sb-item[href$="/numbers"]', '.numbers-page');
  await open('.nav a.sb-item[href$="/log"]', '.log-page');
  await open('.nav a.sb-item[href$="/work/board"]', '.board');
  // The current row and the current tile fade to their fill like any other change of their background.
  const current = page.locator('.nav .sb-item[aria-current="page"]');
  await expect(current).toHaveAttribute('href', /\/work\/board$/);
  expect(await current.evaluate(pressFade)).toEqual(shared);
  await open(`.sidebar .agent-tile[href$="/chat/${agent.id}"]`, '.chat');
  const tile = page.locator(`.sidebar .agent-tile[href$="/chat/${agent.id}"]`);
  await expect(tile).toHaveAttribute('aria-current', 'true');
  expect(await tile.evaluate(pressFade)).toEqual(shared);
  // The Agent's details panel stands beside the chat and does not fade with it.
  await expect(page.locator('.details')).toBeVisible();
  expect(await page.locator('.details').evaluate(element => getComputedStyle(element).animationName)).toBe('none');

  // The first message starts the Conversation: the chat goes on as the same page, and its polling until the reply
  // arrives redraws it without fading it again.
  let polls = 0;
  page.on('request', request => { if (/\/api\/conversations\?company=.*&conversation=/.test(request.url())) polls++; });
  const text = `Plan the fade week ${Date.now()}`;
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL(/\/c\/rs-learning\/conversations\/[0-9a-f-]{36}$/);
  await expect(page.locator('.msg[data-author=agent]')).toContainText(`Reply to: ${text}`);
  expect(polls, 'the Conversation asked for its record while the Run was open').toBeGreaterThan(0);
  await settle(page);
  expect((await pageFades(page)).length, 'the Conversation and its polling do not fade the page again').toBe(opened);

  // Chats, from the sidebar, fades in once.
  await open('.nav a.sb-item[href$="/chat"]', '.chat');
  expect(await stillFades(page)).toEqual([]);
  expect(await lowest(page)).toEqual({ sidebar: 1, details: 1 });
 } finally {
  try { query(`delete from public.hermes_agents where id='${agent.id}'`); } finally { await fake.close(); }
 }
});
