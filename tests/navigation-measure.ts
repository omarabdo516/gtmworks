import { expect, type Page } from '@playwright/test';

type Step = { name: string, link: string, path: string, content: string, search?: string, gone?: string, motion?: { shown: number, settled: number } };
// Each step leaves from a sidebar entry the shell has (#8): Numbers opens its own page (#35) where Home used to be the
// first entry, and Activity log opens /log (#11). On the board a Card opens in its Card window (#835). The window's own
// motion is its allowance over the budgets (app/card-window.css, .cw): the 280ms rise runs after it is shown, and the
// 190ms leave runs before the board is shown again. The list reads the same board (#845): its Card opens the board
// with that Card's window.
// A step that opens a new page counts `settled` from the end of the reference's own motion (#135): the page region's
// fadeIn (design-reference/index.html .view-enter, 200ms, after the page is shown) and the 150ms fade of the row that
// becomes current (.sb-item, .agent-tile), which runs beside it. A Card's sheet opens over the same page, which does not fade.
// A step that opens the board (Marketing board, and the Inbox, which is the board on "Waiting on you") also waits for the
// board's entrance (#131, #559): its progress bars grow for 700ms from when it is shown (app/board.css gw-bar-grow;
// design-reference boardEnter), beside the page's fade.
const pageFadeIn = 200, rowFade = 150, boardEnter = 700;
const opensPage = { shown: 0, settled: Math.max(pageFadeIn, rowFade) };
const opensBoard = { shown: 0, settled: Math.max(pageFadeIn, rowFade, boardEnter) };
// The Card the measured path opens over the board: a task id of the Engine's own form (t_ and eight hex digits).
export const measuredCard = 't_0000c0de';
export const clickPath: Step[] = [
  { name: 'numbers', link: '.nav a[href$="/numbers"]', path: '/numbers', content: '.numbers-page', motion: opensPage },
  { name: 'work', link: '.nav a[href$="/work/board"]', path: '/work/board', content: '.board', motion: opensBoard },
  // The board is the Engine's own Kanban board (spec #831): a Card opens over it in the Card window (#835), whose own
  // 280ms rise is its allowance, and its 190ms leave runs before the board is shown again. The Card is the one
  // navigation.spec.ts puts on the lane's fake Engine, at a fixed id.
  { name: 'open sheet', link: `#board-cols .kcard[data-card="${measuredCard}"] a`, path: '/work/board', search: `?card=${measuredCard}`, content: '.cw[open]', motion: { shown: 0, settled: 280 } },
  { name: 'close sheet', link: '.cw[open] .cw-head .circle-btn[aria-label="Close the card"]', path: '/work/board', search: '', content: '.board', gone: '.cw[open]', motion: { shown: 190, settled: 190 } },
  { name: 'list', link: '.tabs a[href$="/work/list"]', path: '/work/list', content: '.table tbody tr', motion: opensPage },
  { name: 'open card', link: `.table a[href$="?card=${measuredCard}"]`, path: '/work/board', search: `?card=${measuredCard}`, content: '.cw[open]', motion: opensBoard },
  { name: 'close card', link: '.cw[open] .cw-head .circle-btn[aria-label="Close the card"]', path: '/work/board', search: '', content: '.board', gone: '.cw[open]', motion: { shown: 190, settled: 190 } },
  { name: 'calendar', link: '.tabs a[href$="/work/calendar"]', path: '/work/calendar', content: '.calendar', motion: opensPage },
  // The Inbox opens from the approvals entry beside Marketing board; Activity log is the sidebar's last entry.
  { name: 'inbox', link: '.nav a[href$="/approvals"]', path: '/approvals', content: '.approvals', motion: opensBoard },
  { name: 'activity log', link: '.nav a[href$="/log"]', path: '/log', content: '.log-page', motion: opensPage },
];
// An Agent face's own life is not part of opening a page (#133, #697): its breath, a state's loop and its dot's ring,
// the CSS animations below by name, all of them infinite; the eyes' and the highlight's lean toward the pointer and the
// tile's hover lift, the CSS transitions of these face parts (app/face.css); and its blinks, glances and moments, the
// script animations components/face-life plays on a face's parts. Every other transition inside a face, its expression
// easing to a new state among them, is part of the page and is measured.
export const faceAnimations = ['gw-face-breath', 'gw-face-bounce', 'gw-face-sway', 'gw-face-drift', 'gw-face-tick', 'gw-face-settle', 'gw-face-glow', 'gw-face-gaze', 'gw-face-swirl', 'gw-face-nudge', 'gw-dot-ping'];
export const faceTransitions = '.face, .face .f-eyes, .face .f-specs';
export const faceParts = '.face, .face *';
export type Timing = { shown: number; settled: number; progress: boolean; longest: number };
export const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export async function idle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async ({ names, parts, life }) => {
    await document.fonts.ready;
    const face = (animation: Animation) => { const target = (animation.effect as KeyframeEffect | null)?.target as Element | null;
      return animation instanceof CSSAnimation ? names.includes(animation.animationName)
        : animation instanceof CSSTransition ? !!target?.matches(parts) : !!target?.matches(life); };
    await Promise.all(document.getAnimations().filter(animation => !face(animation)).map(animation => animation.finished.catch(() => {})));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, { names: faceAnimations, parts: faceTransitions, life: faceParts });
}

// Measure in the browser from the actual click event, excluding Playwright's actionability waits.
// The same probe also runs against origin/main for the before/after evidence.
// A link prepares its page when it is pointed at (lib/link, #771), so a prepared click points first and presses once
// that page has wholly arrived: the request the pointing started has finished (lib/link's progress waits for the same
// whole response). A link whose page is already prepared asks for nothing, and the press follows at once.
// The count is kept in the page, as lib/link keeps its own: a page request (RSC) is on its way from its fetch until its
// whole body has arrived. Playwright's `networkidle` cannot say this: it is a load state a document reaches once, so
// idle() answers at once for a request the pointer starts later (#810).
export async function measureClick(page: Page, step: Step): Promise<Timing> {
  await page.evaluate(() => {
    const state = window as typeof window & { pageRequestsOnTheirWay?: number };
    if (state.pageRequestsOnTheirWay !== undefined) return;
    state.pageRequestsOnTheirWay = 0;
    const fetch = window.fetch;
    window.fetch = async (input, init) => {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (headers.get('RSC') !== '1') return fetch.call(window, input, init);
      state.pageRequestsOnTheirWay!++;
      const arrived = () => { state.pageRequestsOnTheirWay!--; };
      try {
        const response = await fetch.call(window, input, init);
        void response.clone().text().then(arrived, arrived);
        return response;
      } catch (error) { arrived(); throw error; }
    };
  });
  await page.locator(step.link).hover();
  // The pointer's prefetch is asked for from its own handler; a frame and a task later it is counted.
  await expect.poll(() => page.evaluate(() => new Promise<number>(resolve => requestAnimationFrame(() => setTimeout(() =>
    resolve((window as typeof window & { pageRequestsOnTheirWay: number }).pageRequestsOnTheirWay))))),
  { message: `${step.name}: the page the pointer asked for arrives`, intervals: [16] }).toBe(0);
  await idle(page);
  await page.evaluate(({ step, names, parts, life }) => {
    const face = (animation: Animation) => { const target = (animation.effect as KeyframeEffect | null)?.target as Element | null;
      return animation instanceof CSSAnimation ? names.includes(animation.animationName)
        : animation instanceof CSSTransition ? !!target?.matches(parts) : !!target?.matches(life); };
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
  }, { step, names: faceAnimations, parts: faceTransitions, life: faceParts });
  await page.locator(step.link).click();
  await page.waitForFunction(() => !!(window as typeof window & { clickTiming?: Timing }).clickTiming);
  const timing = await page.evaluate(() => (window as typeof window & { clickTiming: Timing }).clickTiming);
  expect(timing.settled).toBeGreaterThanOrEqual(timing.shown);
  return timing;
}
