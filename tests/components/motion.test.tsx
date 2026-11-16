import { afterEach, expect, inject, onTestFinished, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { cdp, commands, page } from 'vitest/browser';
// Gives cdp() Playwright's session type (its send), as the config's provider does at run time.
import type {} from '@vitest/browser-playwright';
import { BoardPager } from '@/components/paperclip/KanbanBoard';
import { LanguageProvider } from '@/lib/i18n-client';
import { later, prefersReducedMotion } from '@/lib/motion';
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

const languages = inject('languages'), widths = inject('widths');

// The part in its row's markup, styled by app/globals.css (with the reduced-motion rule), the tokens and keyframes in
// app/shell.css and its own file, in the order the app loads them. Each is the stylesheet Vite builds for the app
// (globals.css with Tailwind), taken as text so the next part starts without this one's file.
async function mount(row: MotionRow): Promise<Element> {
 const files = [...new Set(['app/globals.css', 'app/shell.css', row.file])];
 const sheets: string[] = await Promise.all(files.map(async file => (await import(/* @vite-ignore */ `/${file}?inline`)).default));
 const host = document.createElement('div');
 host.innerHTML = row.html;
 host.prepend(...sheets.map(css => Object.assign(document.createElement('style'), { textContent: css })));
 document.body.append(host);
 const { lang, dir } = document.documentElement;
 onTestFinished(() => { host.remove(); Object.assign(document.documentElement, { lang, dir }); });
 const parts = host.querySelectorAll(row.built);
 expect(parts, `${row.built} matches one element of ${row.html}`).toHaveLength(1);
 return parts[0];
}

// As app/layout.tsx sets them.
const speak = (language: string) => Object.assign(document.documentElement, { lang: language, dir: language === 'ar' ? 'rtl' : 'ltr' });

const styleOf = (part: Element): ComputedStyle => {
 const { transitionProperty, transitionDuration, transitionDelay, transitionTimingFunction, animationName, animationDuration, animationTimingFunction } = getComputedStyle(part);
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
   expect.soft(await commands.computedMotion(styleOf(part)), `${language} at ${width}px`).toEqual(reference);
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
