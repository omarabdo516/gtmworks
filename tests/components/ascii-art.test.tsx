import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { cdp } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { AsciiArtAnimation } from '@/components/paperclip/AsciiArtAnimation';
import '@/app/globals.css';

const reducedMotion = (on: boolean) => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
afterEach(async () => { vi.useRealTimers(); await cdp().send('Emulation.setEmulatedMedia', { features: [] }); });

// The sign-in page's artwork, at the size of its half of a wide window. Its frames are counted in animation frames, so
// the page's clock for them is the test's.
test('with reduced motion the sign-in artwork holds one frame of paperclips; without it the paperclips move, and they hold still again when reduced motion comes back', async () => {
 vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
 const frames = (ms: number) => { vi.advanceTimersByTime(ms); return art.textContent; };
 await reducedMotion(true);
 await render(<div style={{ width: 720, height: 900 }}><AsciiArtAnimation/></div>);
 const art = document.querySelector('pre[aria-hidden="true"]')!;
 await expect.poll(() => art.textContent).toContain('╭');
 const still = art.textContent;
 expect(frames(1000), 'a second later').toBe(still);
 await reducedMotion(false);
 // Moving: each of two steps draws a new picture, which one redraw of the still frame (after a resize) cannot do.
 await expect.poll(() => { const shown = art.textContent; const next = frames(100); return next !== shown && frames(100) !== next; }, { message: 'two steps in a row draw new pictures' }).toBe(true);
 await expect.poll(() => frames(100)).toContain('│');
 await reducedMotion(true);
 await expect.poll(() => { const shown = art.textContent!; return shown.includes('╭') && frames(1000) === shown; }, { message: 'a frame of paperclips that a second later is the same' }).toBe(true);
});
