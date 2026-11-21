import { expect, type Page } from '@playwright/test';

type Step = { name: string, link: string, path: string, content: string, search?: string, gone?: string, motion?: { shown: number, settled: number } };
// Each step leaves from a sidebar entry the shell has (#8): Numbers opens its own page (#35) where Home used to be the
// first entry, and Activity log opens /log (#11). On the board a Card opens as its sheet (#116). The sheet's approved
// motion is its allowance over the budgets (design-reference/index.html, .sheet): the 280ms slide-in runs after it is
// shown, and the 190ms slide-out runs before the board is shown again. The Card's page still opens from the list.
// A step that opens a new page counts `settled` from the end of the reference's own motion (#135): the page region's
// fadeIn (design-reference/index.html .view-enter, 200ms, after the page is shown) and the 150ms fade of the row that
// becomes current (.sb-item, .agent-tile), which runs beside it. A Card's sheet opens over the same page, which does not fade.
const pageFadeIn = 200, rowFade = 150;
const opensPage = { shown: 0, settled: Math.max(pageFadeIn, rowFade) };
export const clickPath: Step[] = [
  { name: 'numbers', link: '.nav a[href$="/numbers"]', path: '/numbers', content: '.numbers-page', motion: opensPage },
  { name: 'work', link: '.nav a[href$="/work/board"]', path: '/work/board', content: '.board', motion: opensPage },
  { name: 'open sheet', link: '#board-cols .kcard[data-card-id="1"] a', path: '/work/board', search: '?card=1', content: '.sheet[open]', motion: { shown: 0, settled: 280 } },
  { name: 'close sheet', link: '.sheet[open] .sheet__top .circle-btn', path: '/work/board', search: '', content: '.board', gone: '.sheet[open]', motion: { shown: 190, settled: 190 } },
  { name: 'list', link: '.tabs a[href$="/work/list"]', path: '/work/list', content: '.table tbody tr', motion: opensPage },
  { name: 'open card', link: '.table a[href$="/board/1"]', path: '/work/board/1', content: '.modal', motion: opensPage },
  { name: 'close card', link: '.close-card', path: '/work/board', content: '.board', gone: '.modal', motion: opensPage },
  { name: 'calendar', link: '.tabs a[href$="/work/calendar"]', path: '/work/calendar', content: '.calendar', motion: opensPage },
  // The Inbox opens from the approvals entry beside Marketing board; Activity log is the sidebar's last entry.
  { name: 'inbox', link: '.nav a[href$="/approvals"]', path: '/approvals', content: '.approvals', motion: opensPage },
  { name: 'activity log', link: '.nav a[href$="/log"]', path: '/log', content: '.log-page', motion: opensPage },
];
// An Agent face's own life is not part of opening a page (#133): its look toward the pointer, its blink, its hop, the
// tile's hover lift and a working Agent's loop (design-reference: faceSVG, applyLive). These animations, by name, and
// these transitions, by the face part they move, are left out of "settled" and of idle(), as the copied carets are.
export const faceAnimations = ['gw-face-scan', 'gw-face-hop', 'gw-think-dot', 'gw-think-in', 'gw-dot-ping', 'gw-ck-pop', 'gw-draw-check'];
export const faceTransitions = '.face, .face__f, .face__eye';
export type Timing = { shown: number; settled: number; progress: boolean; longest: number; all: string[] };
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
      const all = new Set<string>();
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
          document.querySelectorAll('.gw, .gw *').forEach(el => {
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
  }, { step, names: faceAnimations, parts: faceTransitions });
  await page.locator(step.link).click();
  await page.waitForFunction(() => !!(window as typeof window & { clickTiming?: Timing }).clickTiming);
  const timing = await page.evaluate(() => (window as typeof window & { clickTiming: Timing }).clickTiming);
  expect(timing.settled).toBeGreaterThanOrEqual(timing.shown);
  return timing;
}
