import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { cdp } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import { AgentFaceDot } from '@/app/agent-face-dot';
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
  {reading && <Conversation id={id} open={open}/>}
 </div>;
}
function Conversation({ id, open }: { id: string, open: boolean }) { useReportRun(id, open); return null; }

const wrap = () => document.querySelector('.face-wrap')!;
const dot = () => document.querySelector('.face-wrap > .dot')!;
const phase = () => ({ thinking: wrap().classList.contains('is-thinking'), think: !!wrap().querySelector('.think'), check: !!wrap().querySelector('.done-ck'), dot: dot().className });

test('while a Run is open in the Conversation the tile thinks with the working dot, and a dot waiting on the reader stays waiting', async () => {
 const screen = await render(<Page id="a1" open={false}/>);
 expect(phase()).toEqual({ thinking: false, think: false, check: false, dot: 'dot dot--idle' });
 await screen.rerender(<Page id="a1" open/>);
 await expect.poll(phase).toEqual({ thinking: true, think: true, check: false, dot: 'dot dot--working' });
 expect(wrap().querySelectorAll('.think i')).toHaveLength(3);
 expect(getComputedStyle(dot()).backgroundColor).toBe(getComputedStyle(dot(), '::after').backgroundColor);
 await screen.rerender(<Page id="a1" open status="waiting"/>);
 await expect.poll(phase).toEqual({ thinking: true, think: true, check: false, dot: 'dot dot--waiting' });
});

test('when the Run ends a check shows for 1600ms, then the dot is back to the state the server read', async () => {
 const screen = await render(<Page id="a2" open status="working"/>);
 await expect.poll(phase).toEqual({ thinking: true, think: true, check: false, dot: 'dot dot--working' });
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 await screen.rerender(<Page id="a2" open={false} status="working"/>);
 await expect.poll(phase).toEqual({ thinking: false, think: false, check: true, dot: 'dot dot--working' });
 await vi.advanceTimersByTimeAsync(1599);
 expect(phase().check).toBe(true);
 await screen.rerender(<Page id="a2" open={false} status="idle"/>);
 await vi.advanceTimersByTimeAsync(1);
 await expect.poll(phase).toEqual({ thinking: false, think: false, check: false, dot: 'dot dot--idle' });
});

test('leaving the Conversation mid-Run forgets it: no check marks a Run nobody saw end', async () => {
 const screen = await render(<Page id="a3" open/>);
 await expect.poll(phase).toEqual({ thinking: true, think: true, check: false, dot: 'dot dot--working' });
 await screen.rerender(<Page id="a3" open reading={false}/>);
 await expect.poll(phase).toEqual({ thinking: false, think: false, check: false, dot: 'dot dot--idle' });
});

test('a face in Settings shows the state and never the working motion', async () => {
 await render(<div className="gw"><div className="sov"><AgentFaceDot agent={agent('a4')} size={36} status="working"/></div><Conversation id="a4" open/></div>);
 await expect.poll(() => dot().className).toBe('dot dot--working');
 expect(wrap().classList.contains('is-thinking')).toBe(false);
 expect(wrap().querySelector('.think, .done-ck')).toBeNull();
});

test('with reduced motion the state still changes, and the eyes, the thinking dots and the ping stay still', async () => {
 await render(<Page id="a5" open/>);
 await expect.poll(phase).toEqual({ thinking: true, think: true, check: false, dot: 'dot dot--working' });
 const animations = () => [getComputedStyle(wrap().querySelector('.face__f')!).animationName, getComputedStyle(wrap().querySelector('.think i')!).animationName, getComputedStyle(dot(), '::after').animationName];
 expect(animations()).toEqual(['gw-face-scan', 'gw-think-dot', 'gw-dot-ping']);
 await reducedMotion(true);
 await expect.poll(animations).toEqual(['none', 'none', 'none']);
});
