import { afterEach, expect, inject, onTestFinished, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { cdp, commands, page } from 'vitest/browser';
// Gives cdp() Playwright's session type (its send), as the config's provider does at run time.
import type {} from '@vitest/browser-playwright';
import { BoardPager } from '@/components/paperclip/KanbanBoard';
import { LanguageProvider } from '@/lib/i18n-client';
import { later, prefersReducedMotion, useLeave } from '@/lib/motion';
import { motionTable, type MotionRow } from '../motion-table.mjs';
import type { ComputedMotion, ComputedStyle } from '../motion-css.mjs';

declare module 'vitest' {
 interface ProvidedContext { languages: string[], widths: number[] }
}
declare module 'vitest/browser' {
 interface BrowserCommands {
  referenceComputed: (selector: string, width: number) => Promise<ComputedMotion>,
  computedMotion: (style: ComputedStyle) => Promise<ComputedMotion>,
 }
}

const reducedMotion = (on: boolean) => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
afterEach(async () => { vi.useRealTimers(); await reducedMotion(false); });

// Six columns wider than their scroller, as the board draws them, so the pager offers its arrows.
const board = () => render(<LanguageProvider language="en">
 <div id="board-cols" style={{ display: 'flex', width: 600, overflowX: 'auto' }}>{Array.from({ length: 6 }, (_, index) => <section key={index} className="col" style={{ flex: 'none', width: 272, height: 40 }}/>)}</div>
 <BoardPager/>
</LanguageProvider>);

test.each([['on', true, 'auto'], ['off', false, 'smooth']] as const)('with reduced motion %s the helper says %s and the pager scrolls the columns with behavior %s', async (_, on, behavior) => {
 await reducedMotion(on);
 expect(prefersReducedMotion()).toBe(on);
 const screen = await board();
 const scrollBy = vi.spyOn(document.getElementById('board-cols')!, 'scrollBy');
 await screen.getByRole('button', { name: 'Next columns' }).click();
 expect(scrollBy).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ behavior }));
});

test.each([['on', 120], ['off', 1000]] as const)('with reduced motion %s a wait of 1000ms ends after %sms', async (on, ms) => {
 await reducedMotion(on === 'on');
 vi.useFakeTimers();
 const done = vi.fn();
 later(1000, done);
 vi.advanceTimersByTime(ms - 1);
 expect(done).not.toHaveBeenCalled();
 vi.advanceTimersByTime(1);
 expect(done).toHaveBeenCalledOnce();
});

// A part that leaves with the dialog's 190ms exit, then runs what closing leads to (#130): what the gallery, the settings
// overlay and first run each do.
function Leaving({ after }: { after: () => void }) {
 const leaving = useLeave(190);
 return <>
  {!leaving.gone && <div data-testid="part" className={leaving.closing ? 'is-closing' : undefined}/>}
  <button type="button" onClick={() => leaving.close(after)}>Close</button>
  <button type="button" onClick={leaving.cancel}>Open</button>
 </>;
}
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const leavingPart = async () => {
 const after = vi.fn();
 const screen = await render(<Leaving after={after}/>);
 const press = (name: string) => (screen.getByRole('button', { name }).element() as HTMLButtonElement).click();
 const part = () => document.querySelector('[data-testid="part"]');
 return { after, press, part };
};

test('a part that leaves is marked closing and stays in the page while its 190ms leave runs, then is gone and what follows runs once', async () => {
 const { after, press, part } = await leavingPart();
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 press('Close');
 await frame();
 expect(part()?.className).toBe('is-closing');
 vi.advanceTimersByTime(150);
 press('Close');
 await frame();
 expect(part()).not.toBeNull();
 expect(after).not.toHaveBeenCalled();
 vi.advanceTimersByTime(40);
 await frame();
 expect(part()).toBeNull();
 expect(after).toHaveBeenCalledOnce();
 vi.advanceTimersByTime(1000);
 expect(after).toHaveBeenCalledOnce();
});

test('opening the part again while it leaves cancels the leave', async () => {
 const { after, press, part } = await leavingPart();
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 press('Close');
 vi.advanceTimersByTime(100);
 press('Open');
 await frame();
 expect(part()?.className).toBe('');
 vi.advanceTimersByTime(1000);
 await frame();
 expect(part()).not.toBeNull();
 expect(after).not.toHaveBeenCalled();
});

test('with reduced motion a part that leaves is gone in the same tick, never marked closing, and what follows runs once', async () => {
 await reducedMotion(true);
 const { after, press, part } = await leavingPart();
 const marked: string[] = [];
 const watch = new MutationObserver(() => { const name = part()?.className; if (name) marked.push(name); });
 watch.observe(document.body, { subtree: true, attributes: true, childList: true });
 onTestFinished(() => watch.disconnect());
 press('Close');
 expect(after).toHaveBeenCalledOnce();
 // React draws the update before the task ends.
 await Promise.resolve();
 expect(part()).toBeNull();
 press('Close');
 await frame();
 expect(after).toHaveBeenCalledOnce();
 expect(marked).toEqual([]);
});

const languages = inject('languages'), widths = inject('widths');

// The part in its row's markup, styled by app/globals.css (with the reduced-motion rule), the tokens and keyframes in
// app/tokens.css, app/shell.css and its own file, in the order the app loads them. Each is the stylesheet Vite builds for the app
// (globals.css with Tailwind), taken as text so the next part starts without this one's file.
// A row may name a part's ::before or ::after: the element is found without it and the pseudo-element is read.
const pseudoOf = (row: MotionRow) => row.built.match(/::(?:before|after)$/)?.[0] ?? null;
async function mount(row: MotionRow): Promise<Element> {
 const files = [...new Set(['app/globals.css', 'app/tokens.css', 'app/shell.css', row.file])];
 const sheets: string[] = await Promise.all(files.map(async file => (await import(/* @vite-ignore */ `/${file}?inline`)).default));
 const host = document.createElement('div');
 host.innerHTML = row.html;
 host.prepend(...sheets.map(css => Object.assign(document.createElement('style'), { textContent: css })));
 document.body.append(host);
 const { lang, dir } = document.documentElement;
 onTestFinished(() => { host.remove(); Object.assign(document.documentElement, { lang, dir }); });
 const parts = host.querySelectorAll(row.built.replace(/::(?:before|after)$/, ''));
 expect(parts, `${row.built} matches one element of ${row.html}`).toHaveLength(1);
 return parts[0];
}

// As app/layout.tsx sets them.
const speak = (language: string) => Object.assign(document.documentElement, { lang: language, dir: language === 'ar' ? 'rtl' : 'ltr' });

const styleOf = (part: Element, pseudo: string | null = null): ComputedStyle => {
 const { transitionProperty, transitionDuration, transitionDelay, transitionTimingFunction, animationName, animationDuration, animationTimingFunction } = getComputedStyle(part, pseudo);
 return { transitionProperty, transitionDuration, transitionDelay, transitionTimingFunction, animationName, animationDuration, animationTimingFunction };
};

// What still moves under .gw: a transition or an animation longer than 1ms, an animation that repeats, a smooth scroll.
const moving = () => [...document.querySelectorAll('.gw, .gw *')].flatMap(element => [null, '::before', '::after'].flatMap(pseudo => {
 const style = getComputedStyle(element, pseudo);
 const longest = (times: string) => Math.max(...times.split(',').map(time => parseFloat(time) * 1000));
 const repeats = style.animationName !== 'none' && style.animationIterationCount.split(',').some(count => count.trim() === 'infinite' || Number(count) > 1);
 return longest(style.transitionDuration) > 1 || longest(style.animationDuration) > 1 || repeats || style.scrollBehavior === 'smooth'
  ? [`${element.tagName.toLowerCase()}.${String(element.className)}${pseudo ?? ''}: transition ${style.transitionDuration}, animation ${style.animationDuration} × ${style.animationIterationCount}, scroll ${style.scrollBehavior}`]
  : [];
}));

for (const row of motionTable) test(`${row.built} (${row.file}) moves as the reference's ${row.ref} at ${widths.join(' and ')} wide in ${languages.join(' and ')}, and stops under reduced motion`, async () => {
 const part = await mount(row);
 for (const width of widths) {
  await page.viewport(width, 900);
  const reference = await commands.referenceComputed(row.ref, width);
  for (const language of languages) {
   speak(language);
   expect.soft(await commands.computedMotion(styleOf(part, pseudoOf(row))), `${language} at ${width}px`).toEqual(reference);
  }
 }
 await reducedMotion(true);
 for (const width of widths) {
  await page.viewport(width, 900);
  for (const language of languages) {
   speak(language);
   expect.soft(moving(), `what still moves with reduced motion in ${language} at ${width}px`).toEqual([]);
  }
 }
});

// A person holding the part down: the mouse pressed at its centre and not yet released, its transitions run to their end.
// At 1440 wide, where the sidebar and the details are panes beside the page rather than drawers off it.
const heldScale = (held: number) => held === 1 ? 'none' : `matrix(${held}, 0, 0, ${held}, 0, 0)`;
for (const row of motionTable.filter(row => row.held !== undefined)) test(`${row.html} held down is at ${heldScale(row.held!)}`, async () => {
 await page.viewport(1440, 900);
 const part = await mount(row);
 part.scrollIntoView({ block: 'center' });
 const box = part.getBoundingClientRect();
 const at = { x: box.left + box.width / 2, y: box.top + box.height / 2, button: 'left', clickCount: 1 } as const;
 await cdp().send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at });
 onTestFinished(async () => { await cdp().send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at }); });
 part.getAnimations().forEach(animation => animation.finish());
 expect(getComputedStyle(part).transform).toBe(heldScale(row.held!));
});
