import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { cdp } from 'vitest/browser';
// Gives cdp() Playwright's session type (its send), as the config's provider does at run time.
import type {} from '@vitest/browser-playwright';
import { BoardPager } from '@/components/paperclip/KanbanBoard';
import { LanguageProvider } from '@/lib/i18n-client';
import { later, prefersReducedMotion } from '@/lib/motion';

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

test.each([['on', true, 120], ['off', false, 1000]] as const)('with reduced motion %s a wait of 1000ms ends after %sms', async (_, on, ms) => {
 await reducedMotion(on);
 vi.useFakeTimers();
 const done = vi.fn();
 later(1000, done);
 vi.advanceTimersByTime(ms - 1);
 expect(done).not.toHaveBeenCalled();
 vi.advanceTimersByTime(1);
 expect(done).toHaveBeenCalledOnce();
});
