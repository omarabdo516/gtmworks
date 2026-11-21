import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { cdp, userEvent } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { CompanyAgentFace } from '@/components/company-agent-face';
import { FaceMotion } from '@/components/face-motion';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';

const reducedMotion = (on: boolean) => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
// A link the press follows, as next/link does: the app draws the page it opens, however long that takes.
const follow = (event: React.MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); history.pushState(null, '', event.currentTarget.href); };
const start = location.href;
afterEach(async () => { vi.useRealTimers(); await reducedMotion(false); history.replaceState(null, '', start); });

const agent = (id: string) => ({ connection_id: `connection-${id}`, name: `Agent ${id}` });
const features = (name: string) => document.querySelector(`[aria-label="${name}"] .face__f`)!;
const transform = (name: string) => getComputedStyle(features(name)).transform;
const identity = ['none', 'matrix(1, 0, 0, 1, 0, 0)'];
const point = (type: string, x: number, y: number, pointerType = 'mouse') => document.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerType, bubbles: true }));
// Faces laid out at known places: the 52px one's centre at (100, 100), the 20px one far below it.
function Faces() {
 return <div className="gw">
  <FaceMotion/>
  <span style={{ position: 'fixed', left: 74, top: 74 }}><CompanyAgentFace agent={agent('big')} size={52}/></span>
  <span style={{ position: 'fixed', left: 90, top: 400 }}><CompanyAgentFace agent={agent('small')} size={20}/></span>
 </div>;
}

test('a face of 24px or more turns its features toward the pointer and back; a touch and a small face move nothing', async () => {
 await render(<Faces/>);
 expect(getComputedStyle(features('Agent big')).transition).toContain('transform 0.24s cubic-bezier(0.2, 0, 0, 1)');
 point('pointermove', 400, 100);
 await expect.poll(() => transform('Agent big')).toBe('matrix(1, 0, 0, 1, 1.6, 0)');
 expect(transform('Agent small')).toBe('none');
 // The head's circle never moves.
 expect(getComputedStyle(document.querySelector('[aria-label="Agent big"] > g:not(.face__f)')!).transform).toBe('none');
 document.documentElement.dispatchEvent(new PointerEvent('pointerleave'));
 await expect.poll(() => identity.includes(transform('Agent big'))).toBe(true);
 point('pointermove', 100, 400, 'touch');
 await new Promise(resolve => setTimeout(resolve, 300));
 expect(identity).toContain(transform('Agent big'));
 expect(transform('Agent small')).toBe('none');
 // The window losing focus brings the features back too.
 point('pointermove', 100, 400);
 await expect.poll(() => transform('Agent big')).toBe('matrix(1, 0, 0, 1, 0, 1.3)');
 window.dispatchEvent(new Event('blur'));
 await expect.poll(() => identity.includes(transform('Agent big'))).toBe(true);
});

test('every 1300ms one visible face that is not working blinks for 140ms', async () => {
 vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
 await render(<div className="gw"><FaceMotion/>{['a', 'b', 'c'].map(id => <CompanyAgentFace key={id} agent={agent(id)} size={32}/>)}<CompanyAgentFace agent={agent('busy')} size={32} thinking/></div>);
 const blinking = () => document.querySelectorAll('.face.is-blink');
 expect(getComputedStyle(document.querySelector('.face__eye')!).transition).toContain('transform 0.09s cubic-bezier(0.4, 0, 1, 1)');
 await vi.advanceTimersByTimeAsync(1299);
 expect(blinking()).toHaveLength(0);
 await vi.advanceTimersByTimeAsync(1);
 expect(blinking()).toHaveLength(1);
 expect(blinking()[0].classList.contains('is-thinking')).toBe(false);
 await vi.advanceTimersByTimeAsync(140);
 expect(blinking()).toHaveLength(0);
 // The closed eyes: scaleY(0.12), the face's eyes only.
 for (let tick = 0; tick < 20; tick++) { await vi.advanceTimersByTimeAsync(1300); expect(document.querySelector('[aria-label="Agent busy"]')!.classList.contains('is-blink')).toBe(false); await vi.advanceTimersByTimeAsync(140); }
});

test('no face blinks in a hidden tab', async () => {
 vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
 const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
 await render(<div className="gw"><FaceMotion/><CompanyAgentFace agent={agent('a')} size={32}/></div>);
 await vi.advanceTimersByTimeAsync(1300 * 3);
 expect(document.querySelectorAll('.face.is-blink')).toHaveLength(0);
 hidden.mockRestore();
});

test('pressing a face, or a button holding one, makes it hop, and the same Agent drawn within 450ms hops once too', async () => {
 const screen = await render(<div className="gw"><FaceMotion/><button type="button"><CompanyAgentFace agent={agent('a')} size={32}/>Open</button></div>);
 const face = () => document.querySelector('.face')!;
 document.querySelector('button')!.click();
 expect(face().classList.contains('is-happy')).toBe(true);
 const style = getComputedStyle(face());
 expect([style.animationName, style.animationDuration, style.animationTimingFunction]).toEqual(['gw-face-hop', '0.46s', 'cubic-bezier(0.34, 1.45, 0.64, 1)']);
 // The page the press opens draws the same Agent again, inside a frame of its own: that face hops as well.
 await screen.rerender(<div className="gw"><FaceMotion key="next page"/><section><CompanyAgentFace agent={agent('a')} size={64}/></section></div>);
 await expect.poll(() => document.querySelector('section .face')?.classList.contains('is-happy')).toBe(true);
 await expect.poll(() => document.querySelector('section .face')?.classList.contains('is-happy'), { timeout: 1000 }).toBe(false);
});

test('a press that opens no page: a face drawn after 450ms does not hop', async () => {
 const screen = await render(<div className="gw"><FaceMotion/><button type="button"><CompanyAgentFace agent={agent('a')} size={32}/></button></div>);
 document.querySelector('button')!.click();
 await new Promise(resolve => setTimeout(resolve, 500));
 await screen.rerender(<div className="gw"><FaceMotion/><section><CompanyAgentFace agent={agent('a')} size={64}/></section></div>);
 await new Promise(resolve => setTimeout(resolve, 50));
 expect(document.querySelector('section .face')!.classList.contains('is-happy')).toBe(false);
});

test('a pressed link carries its hop to the page it opens however long that page takes, then for 450ms from its first face', async () => {
 const screen = await render(<div className="gw"><FaceMotion/><a href="/next-page" onClick={follow}><CompanyAgentFace agent={agent('a')} size={32}/>Open</a></div>);
 document.querySelector('a')!.click();
 expect(document.querySelector('a .face')!.classList.contains('is-happy')).toBe(true);
 // A busy machine: the opened page is drawn well after 450ms.
 await new Promise(resolve => setTimeout(resolve, 900));
 await screen.rerender(<div className="gw"><FaceMotion key="next page"/><section><CompanyAgentFace agent={agent('a')} size={64}/></section></div>);
 await expect.poll(() => document.querySelector('section .face')?.classList.contains('is-happy')).toBe(true);
 // A copy drawn on that page within 450ms of its first face hops once too; one drawn later does not.
 await screen.rerender(<div className="gw"><FaceMotion key="next page"/><section><CompanyAgentFace agent={agent('a')} size={64}/></section><aside><CompanyAgentFace agent={agent('a')} size={32}/></aside></div>);
 await expect.poll(() => document.querySelector('aside .face')?.classList.contains('is-happy')).toBe(true);
 await new Promise(resolve => setTimeout(resolve, 500));
 await screen.rerender(<div className="gw"><FaceMotion key="next page"/><section><CompanyAgentFace agent={agent('a')} size={64}/></section><aside><CompanyAgentFace agent={agent('a')} size={32}/></aside><footer><CompanyAgentFace agent={agent('a')} size={32}/></footer></div>);
 await new Promise(resolve => setTimeout(resolve, 50));
 expect(document.querySelector('footer .face')!.classList.contains('is-happy')).toBe(false);
});

test('a pressed link whose page is not drawn within 10s carries no hop', async () => {
 vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
 const screen = await render(<div className="gw"><FaceMotion/><a href="/next-page" onClick={follow}><CompanyAgentFace agent={agent('a')} size={32}/>Open</a></div>);
 document.querySelector('a')!.click();
 await vi.advanceTimersByTimeAsync(10000);
 await screen.rerender(<div className="gw"><FaceMotion key="next page"/><section><CompanyAgentFace agent={agent('a')} size={64}/></section></div>);
 await new Promise(resolve => queueMicrotask(() => resolve(null)));
 await vi.advanceTimersByTimeAsync(50);
 expect(document.querySelector('section .face')!.classList.contains('is-happy')).toBe(false);
});

test('a link press whose page has not drawn the Agent yet: copies redrawn on the old page hop within 450ms, faces drawn before the press never', async () => {
 const screen = await render(<div className="gw"><FaceMotion/><a href="/next-page" onClick={event => event.preventDefault()}><CompanyAgentFace agent={agent('a')} size={32}/>Open</a><aside><CompanyAgentFace agent={agent('a')} size={32}/></aside></div>);
 document.querySelector('a')!.click();
 // The press's page is still the one drawn: its copy redrawn now hops, as the reference's does.
 await screen.rerender(<div className="gw"><FaceMotion/><a href="/next-page" onClick={event => event.preventDefault()}><CompanyAgentFace agent={agent('a')} size={32}/>Open</a><aside><CompanyAgentFace agent={agent('a')} size={32}/></aside><section><CompanyAgentFace agent={agent('a')} size={64}/></section></div>);
 await expect.poll(() => document.querySelector('section .face')?.classList.contains('is-happy')).toBe(true);
 // The face already drawn before the press was not drawn again.
 expect(document.querySelector('aside .face')!.classList.contains('is-happy')).toBe(false);
 await new Promise(resolve => setTimeout(resolve, 500));
 await screen.rerender(<div className="gw"><FaceMotion/><a href="/next-page" onClick={event => event.preventDefault()}><CompanyAgentFace agent={agent('a')} size={32}/>Open</a><aside><CompanyAgentFace agent={agent('a')} size={32}/></aside><section><CompanyAgentFace agent={agent('a')} size={64}/></section><footer><CompanyAgentFace agent={agent('a')} size={32}/></footer></div>);
 await new Promise(resolve => setTimeout(resolve, 50));
 expect(document.querySelector('footer .face')!.classList.contains('is-happy')).toBe(false);
});

test('a press whose opened page never draws the Agent carries no hop to the page after it', async () => {
 const screen = await render(<div className="gw"><FaceMotion/><a href="/next-page" onClick={follow}><CompanyAgentFace agent={agent('a')} size={32}/>Open</a></div>);
 document.querySelector('a')!.click();
 await screen.rerender(<div className="gw"><FaceMotion key="next page"/><p>No Agent here</p></div>);
 await new Promise(resolve => setTimeout(resolve, 50));
 history.pushState(null, '', '/another-page');
 await screen.rerender(<div className="gw"><FaceMotion key="another page"/><section><CompanyAgentFace agent={agent('a')} size={64}/></section></div>);
 await new Promise(resolve => setTimeout(resolve, 50));
 expect(document.querySelector('section .face')!.classList.contains('is-happy')).toBe(false);
});

test('with reduced motion no face looks, blinks or hops', async () => {
 await reducedMotion(true);
 vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
 await render(<div className="gw"><FaceMotion/><span style={{ position: 'fixed', left: 74, top: 74 }}><button type="button"><CompanyAgentFace agent={agent('big')} size={52}/></button></span></div>);
 point('pointermove', 400, 100);
 await vi.advanceTimersByTimeAsync(1300 * 3);
 document.querySelector('button')!.click();
 expect(identity).toContain(transform('Agent big'));
 expect(document.querySelectorAll('.is-blink, .is-happy')).toHaveLength(0);
});

test('a face under 24px never scans or lifts, even when its Agent works or its tile is hovered', async () => {
 await render(<div className="gw"><a className="agent-tile" href="#"><CompanyAgentFace agent={agent('small')} size={20} thinking/></a></div>);
 const face = document.querySelector('[aria-label="Agent small"]')!;
 expect(face.classList.contains('is-thinking')).toBe(false);
 expect(getComputedStyle(features('Agent small')).animationName).toBe('none');
 await userEvent.hover(face);
 expect(getComputedStyle(face).transform).toBe('none');
});
