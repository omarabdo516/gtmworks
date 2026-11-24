import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { cdp, userEvent } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { AgentFace } from '@/components/agent-face';
import { LooksProvider } from '@/lib/agent-looks-client';
import type { CompanyLooks } from '@/lib/agent-looks';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';

const reducedMotion = (on: boolean) => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
// A link the press follows, as next/link does: the app draws the page it opens, however long that takes.
const follow = (event: React.MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); history.pushState(null, '', event.currentTarget.href); };
const start = location.href;
afterEach(async () => { vi.restoreAllMocks(); await reducedMotion(false); history.replaceState(null, '', start); });

const looks: CompanyLooks = { agents: { a: { shape: 'circle', colour: 'indigo', temperament: 'calm' }, b: { shape: 'squircle', colour: 'jade', temperament: 'neat' } }, requests: {}, removed: {} };
const Company = ({ children }: { children: React.ReactNode }) => <div className="gw"><LooksProvider looks={looks}>{children}</LooksProvider></div>;
const faceIn = (selector: string) => document.querySelector<HTMLElement>(`${selector} .face`)!;
const lean = (face: Element) => { const eyes = getComputedStyle(face.querySelector('.f-eyes')!), light = getComputedStyle(face.querySelector('.f-specs')!); return [eyes.getPropertyValue('--lx'), light.getPropertyValue('--lx')]; };
const point = (x: number, y: number, pointerType = 'mouse') => window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType, bubbles: true }));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// Whether a face's eyes blink in the next `ms`, watched frame by frame.
async function blinksWithin(face: Element, ms: number) {
 const until = performance.now() + ms;
 while (performance.now() < until) {
  if ([...face.querySelectorAll('.f-eye')].some(eye => eye.getAnimations().length)) return true;
  await new Promise(resolve => requestAnimationFrame(resolve));
 }
 return false;
}
const hopping = (face: Element | null) => face instanceof HTMLElement && face.dataset.moment === 'press';

// Faces at known places: the 56px one's centre at (100, 100), a 20px one below it, one far off screen.
function Faces() {
 return <Company>
  <span id="big" style={{ position: 'fixed', left: 72, top: 72 }}><AgentFace agent="a" size={56}/></span>
  <span id="small" style={{ position: 'fixed', left: 90, top: 300 }}><AgentFace agent="b" size={20}/></span>
  <span id="away" style={{ position: 'absolute', left: 0, top: 6000 }}><AgentFace agent="b" size={56}/></span>
 </Company>;
}

test('the eyes and the highlight of a face on screen lean toward the pointer and back; a touch and a face under 24px move nothing', async () => {
 await render(<Faces/>);
 await expect.poll(() => faceIn('#big').classList.contains('is-vis')).toBe(true);
 point(400, 100);
 await expect.poll(() => lean(faceIn('#big'))).toEqual(['1.00', '1.00']);
 expect(getComputedStyle(faceIn('#big').querySelector('.f-eyes')!).transform).not.toBe('none');
 expect(lean(faceIn('#small'))).toEqual(['', '']);
 document.documentElement.dispatchEvent(new PointerEvent('pointerleave'));
 await expect.poll(() => lean(faceIn('#big'))).toEqual(['', '']);
 point(100, 400, 'touch');
 await wait(200);
 expect(lean(faceIn('#big'))).toEqual(['', '']);
 point(100, 400);
 await expect.poll(() => getComputedStyle(faceIn('#big').querySelector('.f-eyes')!).getPropertyValue('--ly')).toBe('1.00');
 window.dispatchEvent(new Event('blur'));
 await expect.poll(() => lean(faceIn('#big'))).toEqual(['', '']);
});

test('a face on screen blinks and glances by itself; one off screen, one under 24px and every face in a hidden tab stay still', async () => {
 vi.spyOn(Math, 'random').mockReturnValue(0);
 await render(<Faces/>);
 await expect.poll(() => faceIn('#big').classList.contains('is-vis')).toBe(true);
 expect(faceIn('#away').classList.contains('is-vis')).toBe(false);
 // Off screen its breath is paused.
 expect(getComputedStyle(faceIn('#away').querySelector('.f-breath')!).animationPlayState).toBe('paused');
 expect(await blinksWithin(faceIn('#big'), 1500)).toBe(true);
 // Calm looks to the side and back (design-reference-orb: steady).
 await expect.poll(() => getComputedStyle(faceIn('#big').querySelector('.f-eyes')!).getPropertyValue('--gx'), { timeout: 3000 }).toBe('-0.55');
 expect(await blinksWithin(faceIn('#away'), 300)).toBe(false);
 expect(await blinksWithin(faceIn('#small'), 300)).toBe(false);
 const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
 await wait(200);
 expect(await blinksWithin(faceIn('#big'), 4500)).toBe(false);
 hidden.mockRestore();
});

test('a pressed face hops, and the same Agent drawn within 450ms hops once too; one drawn later does not', async () => {
 const screen = await render(<Company><button type="button"><AgentFace agent="a" size={32}/>Open</button></Company>);
 document.querySelector('button')!.click();
 expect(hopping(faceIn('button'))).toBe(true);
 expect(faceIn('button').querySelector('.f-act')!.getAnimations()).toHaveLength(1);
 await screen.rerender(<Company><button type="button"><AgentFace agent="a" size={32}/>Open</button><section><AgentFace agent="a" size={72}/></section></Company>);
 await expect.poll(() => hopping(faceIn('section'))).toBe(true);
 await wait(500);
 await screen.rerender(<Company><button type="button"><AgentFace agent="a" size={32}/>Open</button><section><AgentFace agent="a" size={72}/></section><footer><AgentFace agent="a" size={32}/></footer></Company>);
 await wait(50);
 expect(hopping(faceIn('footer'))).toBe(false);
});

test('a pressed link carries its hop to the page it opens however long that takes, and to no page after it', async () => {
 const screen = await render(<Company><a href="/next-page" onClick={follow}><AgentFace agent="a" size={56}/>Open</a></Company>);
 document.querySelector('a')!.click();
 await wait(900);
 await screen.rerender(<Company><section><AgentFace agent="a" size={72}/></section></Company>);
 await expect.poll(() => hopping(faceIn('section'))).toBe(true);
 history.pushState(null, '', '/another-page');
 await screen.rerender(<Company><aside><AgentFace agent="a" size={72}/></aside></Company>);
 await wait(50);
 expect(hopping(faceIn('aside'))).toBe(false);
});

test('a face that is done hops and sparkles once', async () => {
 const screen = await render(<Company><AgentFace agent="a" size={56} state="working"/></Company>);
 await screen.rerender(<Company><AgentFace agent="a" size={56} state="done"/></Company>);
 const face = faceIn('.gw');
 expect(face.dataset.moment).toBe('done');
 expect(face.querySelectorAll('.f-spark i')[0].getAnimations()).toHaveLength(1);
});

test('with reduced motion nothing leans, blinks or hops: a press shows its still frames instead', async () => {
 await reducedMotion(true);
 vi.spyOn(Math, 'random').mockReturnValue(0);
 await render(<Company><span style={{ position: 'fixed', left: 72, top: 72 }}><button type="button"><AgentFace agent="a" size={56}/></button></span></Company>);
 await expect.poll(() => faceIn('button').classList.contains('is-vis')).toBe(true);
 point(400, 100);
 expect(await blinksWithin(faceIn('button'), 1500)).toBe(false);
 expect(lean(faceIn('button'))).toEqual(['', '']);
 await userEvent.click(document.querySelector('button')!);
 expect(faceIn('button').classList.contains('is-squint')).toBe(true);
 expect(faceIn('button').getAnimations({ subtree: true })).toHaveLength(0);
});

test('turning reduced motion on stops a moment that plays', async () => {
 await render(<Company><button type="button"><AgentFace agent="a" size={56}/></button></Company>);
 document.querySelector('button')!.click();
 expect(hopping(faceIn('button'))).toBe(true);
 await reducedMotion(true);
 await expect.poll(() => faceIn('button').querySelector('.f-act')!.getAnimations()).toHaveLength(0);
 expect(hopping(faceIn('button'))).toBe(false);
});
