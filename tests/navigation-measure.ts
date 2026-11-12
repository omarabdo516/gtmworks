import { expect, type Page } from '@playwright/test';

export const clickPath = [
  { name: 'home', link: '.nav a[href$="/home"]', path: '/home', content: '.home-dashboard' },
  { name: 'work', link: '.nav a[href$="/work/board"]', path: '/work/board', content: '.board' },
  { name: 'open card', link: '.board .card a[href$="/board/1"]', path: '/work/board/1', content: '.modal' },
  { name: 'close card', link: '.close-card', path: '/work/board', content: '.board' },
  { name: 'list', link: '.tabs a[href$="/work/list"]', path: '/work/list', content: '.table tbody tr' },
  { name: 'calendar', link: '.tabs a[href$="/work/calendar"]', path: '/work/calendar', content: '.calendar' },
  // The sidebar has no Inbox entry since #284; its last entry, Activity log, is measured instead.
  { name: 'activity log', link: '.nav a[href$="/history"]', path: '/history', content: '.content .empty' },
];
export type Timing = { shown: number; settled: number; progress: boolean; longest: number; all: string[] };
export const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export async function idle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

// Measure in the browser from the actual click event, excluding Playwright's actionability waits.
// The same probe also runs against origin/main for the before/after evidence.
export async function measureClick(page: Page, step: typeof clickPath[number]): Promise<Timing> {
  await page.locator(step.link).hover();
  await idle(page);
  await page.evaluate(step => {
    const state = window as typeof window & { clickTiming?: Timing };
    delete state.clickTiming;
    document.addEventListener('click', () => {
      const start = performance.now();
      let shown = 0, progress = false, longest = 0;
      let frame = 0;
      const seen = new Set<Animation>();
      const all = new Set<string>();
      const sample = () => {
        if (state.clickTiming) return;
        cancelAnimationFrame(frame);
        progress ||= !!document.querySelector('[role="progressbar"]');
        const animations = document.getAnimations().filter(a => a.playState === 'running' || a.pending);
        for (const animation of animations) {
          if (!seen.has(animation)) {
            seen.add(animation);
            void animation.finished.then(sample, sample);
          }
          const duration = Number(animation.effect?.getComputedTiming().duration);
          longest = Math.max(longest, duration);
        }
        const element = document.querySelector(step.content);
        const ready = location.pathname === `/c/rs-learning${step.path}` && element?.getBoundingClientRect().height &&
          (step.name !== 'close card' || !document.querySelector('.modal'));
        if (ready && !shown) {
          shown = performance.now() - start;
        }
        if (shown && animations.length === 0) {
          const settled = performance.now() - start;
          document.querySelectorAll('.shell *, .sidebar *').forEach(el => {
            // Pinned Paperclip SidebarSection carets use transition-all for rotation/visibility.
            // Keep that copied motion; report unlisted broad transitions elsewhere.
            const copiedCaret=el.matches('.group\\/sidebar-section svg.transition-all');
            if (!copiedCaret && getComputedStyle(el).transitionDuration.split(',').some(duration=>parseFloat(duration)>0) && getComputedStyle(el).transitionProperty.split(',').some(p => p.trim() === 'all')) {
              all.add(el.tagName.toLowerCase() + '.' + el.className);
            }
          });
          state.clickTiming = { shown, settled, progress, longest, all: [...all] };
        } else frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
    }, { once: true, capture: true });
  }, step);
  await page.locator(step.link).click();
  await page.waitForFunction(() => !!(window as typeof window & { clickTiming?: Timing }).clickTiming);
  const timing = await page.evaluate(() => (window as typeof window & { clickTiming: Timing }).clickTiming);
  expect(timing.settled).toBeGreaterThanOrEqual(timing.shown);
  return timing;
}
