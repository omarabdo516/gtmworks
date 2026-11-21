import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import AgentGrid from '@/app/agent-grid';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';

afterEach(() => { vi.useRealTimers(); });

// The sidebar's Agents grid as app/shell.tsx draws it, one tile per Agent.
const grid = (company: string, agents: string[]) => <div className="gw"><aside className="sidebar"><AgentGrid company={company} agents={agents}>
 {agents.map(id => <li key={id}><a className="agent-tile" data-agent={id} href={`#${id}`}>{id}</a></li>)}
</AgentGrid></aside></div>;
const tile = (id: string) => document.querySelector<HTMLElement>(`.agent-tile[data-agent="${id}"]`)!;
const motion = (id: string) => { const { animationName, animationDuration, animationTimingFunction } = getComputedStyle(tile(id)); return { animationName, animationDuration, animationTimingFunction }; };
const none = { animationName: 'none', animationDuration: '0s', animationTimingFunction: 'ease' };

// #134 (design-reference: is-flash after an Agent is made, tileFlash).
test('a tile that arrives in the grid during the visit flashes once for 1.4s and loses its mark after 1500ms; nothing flashes when the grid is first drawn', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const screen = await render(grid('company-a', ['lead', 'ads']));
 expect([motion('lead'), motion('ads')]).toEqual([none, none]);
 await screen.rerender(grid('company-a', ['lead', 'ads', 'analyst']));
 expect(tile('analyst').classList.contains('is-flash')).toBe(true);
 expect(motion('analyst')).toEqual({ animationName: 'gw-ring-flash', animationDuration: '1.4s', animationTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)' });
 expect([motion('lead'), motion('ads')]).toEqual([none, none]);
 vi.advanceTimersByTime(1499);
 expect(tile('analyst').classList.contains('is-flash')).toBe(true);
 vi.advanceTimersByTime(1);
 expect(tile('analyst').classList.contains('is-flash')).toBe(false);
 // Drawn again with the same Agents (another page of the visit), nothing flashes.
 await screen.rerender(grid('company-a', ['lead', 'ads', 'analyst']));
 expect(document.querySelectorAll('.is-flash')).toHaveLength(0);
 // A tile the grid left out for a moment (a read between two writes) does not flash when it is back.
 await screen.rerender(grid('company-a', ['lead', 'ads']));
 await screen.rerender(grid('company-a', ['lead', 'ads', 'analyst']));
 expect(document.querySelectorAll('.is-flash')).toHaveLength(0);
 // Another Company the visit has not shown yet: its tiles are all new to the grid, and none flashes.
 await screen.rerender(grid('company-b', ['lead-b', 'writer']));
 expect(document.querySelectorAll('.is-flash')).toHaveLength(0);
});
