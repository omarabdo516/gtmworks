import { expect, type Page } from '@playwright/test';

type Step = { name: string, link: string, path: string, content: string, search?: string, gone?: string, motion?: { shown: number, settled: number } };
// Each step leaves from a sidebar entry the shell has (#8): Numbers opens its own page (#35) where Home used to be the
// first entry, and Activity log opens /log (#11). On the board a Card opens as its sheet (#116). The sheet's own
// motion is its allowance over the budgets (app/shell.css, .sheet): the 280ms slide-in runs after it is
// shown, and the 190ms slide-out runs before the board is shown again. The Card's page still opens from the list.
// A step that opens a new page counts `settled` from the end of the reference's own motion (#135): the page region's
// fadeIn (design-reference/index.html .view-enter, 200ms, after the page is shown) and the 150ms fade of the row that
// becomes current (.sb-item, .agent-tile), which runs beside it. A Card's sheet opens over the same page, which does not fade.
// A step that opens the board (Marketing board, and the Inbox, which is the board on "Waiting on you") also waits for the
// board's entrance (#131, #559): its progress bars grow for 700ms from when it is shown (app/board.css gw-bar-grow;
// design-reference boardEnter), beside the page's fade.
const pageFadeIn = 200, rowFade = 150, boardEnter = 700;
const opensPage = { shown: 0, settled: Math.max(pageFadeIn, rowFade) };
const opensBoard = { shown: 0, settled: Math.max(pageFadeIn, rowFade, boardEnter) };
export const clickPath: Step[] = [
  { name: 'numbers', link: '.nav a[href$="/numbers"]', path: '/numbers', content: '.numbers-page', motion: opensPage },
  { name: 'work', link: '.nav a[href$="/work/board"]', path: '/work/board', content: '.board', motion: opensBoard },
  { name: 'open sheet', link: '#board-cols .kcard[data-card-id="1"] a', path: '/work/board', search: '?card=1', content: '.sheet[open]', motion: { shown: 0, settled: 280 } },
  // The sheet's top bar can hold the Card's More menu beside Close (#692), so this step names Close (#706).
  { name: 'close sheet', link: '.sheet[open] .sheet__top .circle-btn[aria-label="Close"]', path: '/work/board', search: '', content: '.board', gone: '.sheet[open]', motion: { shown: 190, settled: 190 } },
  { name: 'list', link: '.tabs a[href$="/work/list"]', path: '/work/list', content: '.table tbody tr', motion: opensPage },
  { name: 'open card', link: '.table a[href$="/board/1"]', path: '/work/board/1', content: '.modal', motion: opensPage },
  { name: 'close card', link: '.close-card', path: '/work/board', content: '.board', gone: '.modal', motion: opensBoard },
  { name: 'calendar', link: '.tabs a[href$="/work/calendar"]', path: '/work/calendar', content: '.calendar', motion: opensPage },
  // The Inbox opens from the approvals entry beside Marketing board; Activity log is the sidebar's last entry.
  { name: 'inbox', link: '.nav a[href$="/approvals"]', path: '/approvals', content: '.approvals', motion: opensBoard },
  { name: 'activity log', link: '.nav a[href$="/log"]', path: '/log', content: '.log-page', motion: opensPage },
];
// An Agent face's own life is not part of opening a page (#133): its look toward the pointer, its blink, its hop, the
// tile's hover lift and a working Agent's loop (design-reference: faceSVG, applyLive). These animations, by name, and
// these transitions, by the face part they move, are left out of "settled" and of idle().
export const faceAnimations = ['gw-face-scan', 'gw-face-hop', 'gw-think-dot', 'gw-think-in', 'gw-dot-ping', 'gw-ck-pop', 'gw-draw-check'];
export const faceTransitions = '.face, .face__f, .face__eye';
export type Timing = { shown: number; settled: number; progress: boolean; longest: number };
export const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export async function idle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async ({ names, parts }) => {
    await document.fonts.ready;
    const face = (animation: Animation) => animation instanceof CSSAnimation ? names.includes(animation.animationName)
      : animation instanceof CSSTransition && !!((animation.effect as KeyframeEffect | null)?.target as Element | null)?.matches(parts);
    await Promise.all(document.getAnimations().filter(animation => !face(animation)).map(animation => animation.finished.catch(() => {})));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, { names: faceAnimations, parts: faceTransitions });
}

// Measure in the browser from the actual click event, excluding Playwright's actionability waits.
// The same probe also runs against origin/main for the before/after evidence.
export async function measureClick(page: Page, step: Step): Promise<Timing> {
  await page.locator(step.link).hover();
  await idle(page);
  await page.evaluate(({ step, names, parts }) => {
    const face = (animation: Animation) => animation instanceof CSSAnimation ? names.includes(animation.animationName)
      : animation instanceof CSSTransition && !!((animation.effect as KeyframeEffect | null)?.target as Element | null)?.matches(parts);
    const state = window as typeof window & { clickTiming?: Timing };
    delete state.clickTiming;
    document.addEventListener('click', () => {
      const start = performance.now();
      let shown = 0, progress = false, longest = 0;
      let frame = 0;
      const seen = new Set<Animation>();
      const sample = () => {
        if (state.clickTiming) return;
        cancelAnimationFrame(frame);
        // The page-opening feedback (lib/link and the new-card fallback). The board's cards carry their own progress
        // bars since #34, which are content, not navigation feedback.
        progress ||= !!document.querySelector('.navigation-progress[role="progressbar"]');
        const animations = document.getAnimations().filter(a => (a.playState === 'running' || a.pending) && !face(a));
        for (const animation of animations) {
          if (!seen.has(animation)) {
            seen.add(animation);
            void animation.finished.then(sample, sample);
          }
          const duration = Number(animation.effect?.getComputedTiming().duration);
          longest = Math.max(longest, duration);
        }
        const element = document.querySelector(step.content);
        const ready = location.pathname === `/c/rs-learning${step.path}` && (step.search === undefined || location.search === step.search) &&
          element?.getBoundingClientRect().height && (!step.gone || !document.querySelector(step.gone));
        if (ready && !shown) {
          shown = performance.now() - start;
        }
        if (shown && animations.length === 0) {
          const settled = performance.now() - start;
          state.clickTiming = { shown, settled, progress, longest };
        } else frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
    }, { once: true, capture: true });
  }, { step, names: faceAnimations, parts: faceTransitions });
  await page.locator(step.link).click();
  await page.waitForFunction(() => !!(window as typeof window & { clickTiming?: Timing }).clickTiming);
  const timing = await page.evaluate(() => (window as typeof window & { clickTiming: Timing }).clickTiming);
  expect(timing.settled).toBeGreaterThanOrEqual(timing.shown);
  return timing;
}
