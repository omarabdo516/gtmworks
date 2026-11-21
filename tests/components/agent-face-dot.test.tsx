import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { cdp } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { AgentFaceDot, LiveFace, LiveFaceWrap } from '@/app/agent-face-dot';
import { useReportRun } from '@/lib/live-runs';
import type { AgentStatus } from '@/lib/agent-details.mjs';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

const reducedMotion = (on: boolean) => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
afterEach(async () => { vi.useRealTimers(); await reducedMotion(false); });

const agent = (id: string) => ({ id, connection_id: `connection-${id}`, name: 'Ads' });
// The sidebar's tile (live) beside the Conversation that reports its Agent's Run, as the app draws them.
function Page({ id, open, reading = true, status = 'idle', live = true }: { id: string, open: boolean, reading?: boolean, status?: AgentStatus, live?: boolean }) {
 return <div className="gw">
  <a className="agent-tile" href="#"><AgentFaceDot live={live} agent={agent(id)} size={52} status={status}/></a>
  <a className="agent-tile" href="#"><AgentFaceDot agent={agent(`${id}-still`)} size={52} status="working"/></a>
  {reading && <Conversation id={id} open={open}/>}
 </div>;
}
function Conversation({ id, open }: { id: string, open: boolean }) { useReportRun(id, open); return null; }

const wrap = () => document.querySelector('.face-wrap')!;
const dot = () => document.querySelector('.face-wrap > .dot')!;
// The second tile's dot, never live, shows the accent a working dot is painted.
const accent = () => getComputedStyle(document.querySelectorAll('.face-wrap > .dot')[1]).backgroundColor;
const phase = () => ({ thinking: wrap().classList.contains('is-thinking'), think: !!wrap().querySelector('.think'), check: !!wrap().querySelector('.done-ck'), dot: dot().className, accent: getComputedStyle(dot()).backgroundColor === accent() });

test('while a Run is open in the Conversation the tile thinks and its dot pulses in the accent, a dot waiting on the reader too', async () => {
 const screen = await render(<Page id="a1" open={false}/>);
 expect(phase()).toEqual({ thinking: false, think: false, check: false, dot: 'dot dot--idle', accent: false });
 await screen.rerender(<Page id="a1" open/>);
 await expect.poll(phase).toEqual({ thinking: true, think: true, check: false, dot: 'dot dot--idle', accent: true });
 expect(wrap().querySelectorAll('.think i')).toHaveLength(3);
 expect(getComputedStyle(dot()).backgroundColor).toBe(getComputedStyle(dot(), '::after').backgroundColor);
 await screen.rerender(<Page id="a1" open status="waiting"/>);
 await expect.poll(phase).toEqual({ thinking: true, think: true, check: false, dot: 'dot dot--waiting', accent: true });
});

test('when the Run ends a check shows for 1600ms, then the dot is back to the state the server read', async () => {
 const screen = await render(<Page id="a2" open status="working"/>);
 await expect.poll(phase).toEqual({ thinking: true, think: true, check: false, dot: 'dot dot--working', accent: true });
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 await screen.rerender(<Page id="a2" open={false} status="working"/>);
 await expect.poll(phase).toEqual({ thinking: false, think: false, check: true, dot: 'dot dot--working', accent: true });
 await vi.advanceTimersByTimeAsync(1599);
 expect(phase().check).toBe(true);
 await screen.rerender(<Page id="a2" open={false} status="idle"/>);
 await vi.advanceTimersByTimeAsync(1);
 await expect.poll(phase).toEqual({ thinking: false, think: false, check: false, dot: 'dot dot--idle', accent: false });
});

test('leaving the Conversation mid-Run forgets it: no check marks a Run nobody saw end', async () => {
 const screen = await render(<Page id="a3" open/>);
 await expect.poll(phase).toEqual({ thinking: true, think: true, check: false, dot: 'dot dot--idle', accent: true });
 await screen.rerender(<Page id="a3" open reading={false}/>);
 await expect.poll(phase).toEqual({ thinking: false, think: false, check: false, dot: 'dot dot--idle', accent: false });
});

test('a face in Settings shows the state and never the working motion', async () => {
 await render(<div className="gw"><div className="sov"><AgentFaceDot agent={agent('a4')} size={36} status="working"/></div><Conversation id="a4" open/></div>);
 await expect.poll(() => dot().className).toBe('dot dot--working');
 expect(wrap().classList.contains('is-thinking')).toBe(false);
 expect(wrap().querySelector('.think, .done-ck')).toBeNull();
});

test('with reduced motion the state still changes, and the eyes, the thinking dots and the ping stay still', async () => {
 await render(<Page id="a5" open/>);
 await expect.poll(phase).toEqual({ thinking: true, think: true, check: false, dot: 'dot dot--idle', accent: true });
 const animations = () => [getComputedStyle(wrap().querySelector('.face__f')!).animationName, getComputedStyle(wrap().querySelector('.think i')!).animationName, getComputedStyle(dot(), '::after').animationName];
 expect(animations()).toEqual(['gw-face-scan', 'gw-think-dot', 'gw-dot-ping']);
 await reducedMotion(true);
 await expect.poll(animations).toEqual(['none', 'none', 'none']);
});

// The details panel's face (its dot read from the server) and the chat's title pill, beside the Conversation whose Run it reports (#133).
function Panel({ id, open }: { id: string, open: boolean }) {
 return <div className="gw">
  <aside className="details"><LiveFaceWrap agent={agent(id)} size={64} lg><span className="dot dot--working"/></LiveFaceWrap></aside>
  <button type="button" className="head-pill"><span aria-hidden="true"><LiveFace agentId={id} agent={agent(id)} size={24}/></span></button>
  <Conversation id={id} open={open}/>
 </div>;
}
const timing = (element: Element, pseudo?: string) => { const style = getComputedStyle(element, pseudo); return [style.animationName, style.animationDuration, style.animationDelay, style.animationIterationCount, style.animationTimingFunction]; };
const panelWrap = () => document.querySelector('.details .face-wrap')!;

test('while a Run is open the details panel face scans, its dots think and its dot sends a ring; the title pill face scans too', async () => {
 const screen = await render(<Panel id="d1" open={false}/>);
 expect(panelWrap().classList.contains('is-thinking')).toBe(false);
 expect(document.querySelector('.head-pill .face')!.classList.contains('is-thinking')).toBe(false);
 await screen.rerender(<Panel id="d1" open/>);
 await expect.poll(() => panelWrap().classList.contains('is-thinking')).toBe(true);
 expect(panelWrap().getAttribute('aria-hidden')).toBe('true');
 expect(timing(panelWrap().querySelector('.face__f')!)).toEqual(['gw-face-scan', '2.4s', '0s', 'infinite', 'ease-in-out']);
 expect(timing(document.querySelector('.head-pill .face__f')!)).toEqual(['gw-face-scan', '2.4s', '0s', 'infinite', 'ease-in-out']);
 expect(timing(panelWrap().querySelector('.think')!).slice(0, 4)).toEqual(['gw-think-in', '0.2s', '0s', '1']);
 expect([...panelWrap().querySelectorAll('.think i')].map(dot => timing(dot))).toEqual(['0s', '0.15s', '0.3s'].map(delay => ['gw-think-dot', '1.2s', delay, 'infinite', 'ease-in-out']));
 expect(timing(panelWrap().querySelector('.dot')!, '::after')).toEqual(['gw-dot-ping', '1.6s', '0s', 'infinite', 'cubic-bezier(0.2, 0, 0, 1)']);
});

test('when the Run ends the details panel shows a check that pops and draws itself for 1600ms, and not after', async () => {
 const screen = await render(<Panel id="d2" open/>);
 await expect.poll(() => panelWrap().classList.contains('is-thinking')).toBe(true);
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 await screen.rerender(<Panel id="d2" open={false}/>);
 await expect.poll(() => !!panelWrap().querySelector('.done-ck')).toBe(true);
 expect(timing(panelWrap().querySelector('.done-ck')!)).toEqual(['gw-ck-pop', '0.32s', '0s', '1', 'cubic-bezier(0.34, 1.45, 0.64, 1)']);
 expect(timing(panelWrap().querySelector('.done-ck path')!)).toEqual(['gw-draw-check', '0.36s', '0.14s', '1', 'cubic-bezier(0.2, 0, 0, 1)']);
 expect(panelWrap().querySelector('.think')).toBeNull();
 await vi.advanceTimersByTimeAsync(1599);
 expect(panelWrap().querySelector('.done-ck')).not.toBeNull();
 await vi.advanceTimersByTimeAsync(1);
 await expect.poll(() => panelWrap().querySelector('.done-ck')).toBeNull();
});

test('with reduced motion the details panel still shows the dots and the check, and nothing moves', async () => {
 await reducedMotion(true);
 const screen = await render(<Panel id="d3" open/>);
 await expect.poll(() => !!panelWrap().querySelector('.think')).toBe(true);
 const still = (element: Element, pseudo?: string) => { const [name, duration] = timing(element, pseudo); return name === 'none' || parseFloat(duration) <= 0.001; };
 expect([panelWrap().querySelector('.face__f')!, document.querySelector('.head-pill .face__f')!, ...panelWrap().querySelectorAll('.think i')].every(element => still(element))).toBe(true);
 expect(still(panelWrap().querySelector('.dot')!, '::after')).toBe(true);
 expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(getComputedStyle(panelWrap().querySelector('.face__f')!).transform);
 await screen.rerender(<Panel id="d3" open={false}/>);
 await expect.poll(() => !!panelWrap().querySelector('.done-ck')).toBe(true);
});
