import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { act, type ComponentProps } from 'react';
import { userEvent } from 'vitest/browser';
import { AgentTabs } from '@/app/settings-agent-tabs';
import { AgentMemory } from '@/app/agent-memory';
import { detailsTabs } from '@/app/agent-details-tabs';
import { agentTabFocus } from '@/lib/settings-overlay.mjs';
import { OverlayFrame } from '@/app/settings-overlay-frame';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n, type Language } from '@/lib/i18n.mjs';
import '@/app/shell.css';

// The Memory tab of an Agent's Settings page (#193): a real tab beside Settings with its own address, moved between by
// pointer and by the arrow keys in the reader's direction, opening the same AgentMemory the details panel draws, with
// the same flags: a Viewer reads and is offered no buttons.
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))}/> }));
afterEach(() => push.mockReset());

const notes = [
 { id: 'memory:memory:0:4d2c1b0a9f8e', text: 'Prefers short subject lines.' },
 { id: 'memory:profile:1:7a1b2c3d4e5f', text: 'Omar works in Cairo.' },
];
const agent = { id: 'ag-1', name: 'Ads' };
const tabs = (tab: 'settings' | 'memory' = 'settings', language: Language = 'en') => render(<LanguageProvider language={language}>
 <div className="gw"><AgentTabs slug="rs-learning" agent={agent.id} tab={tab} label={agent.name}/></div>
</LanguageProvider>);

test('both tabs are drawn, each with its own address, and the open tab is the only one in the tab stop', async () => {
 const screen = await tabs();
 const settings = screen.getByRole('tab', { name: 'Settings', exact: true });
 const memory = screen.getByRole('tab', { name: 'Memory', exact: true });
 await expect.element(settings).toHaveAttribute('href', '/c/rs-learning/settings?agent=ag-1');
 await expect.element(memory).toHaveAttribute('href', '/c/rs-learning/settings?agent=ag-1&tab=memory');
 await expect.element(settings).toHaveAttribute('aria-selected', 'true');
 await expect.element(memory).toHaveAttribute('aria-selected', 'false');
 expect([settings.element().getAttribute('tabindex'), memory.element().getAttribute('tabindex')]).toEqual(['0', '-1']);
});

test('the arrow keys move to the other tab, in the reader’s direction, and leave the focus on it', async () => {
 for (const [language, key] of [['en', 'ArrowRight'], ['en', 'ArrowLeft'], ['ar', 'ArrowLeft'], ['ar', 'ArrowRight']] as const) {
  push.mockReset();
  const screen = await tabs('settings', language);
  const settings = screen.getByRole('tab', { name: language === 'en' ? 'Settings' : 'الإعدادات', exact: true });
  settings.element().focus();
  await userEvent.keyboard(`{${key}}`);
  expect(push).toHaveBeenCalledWith('/c/rs-learning/settings?agent=ag-1&tab=memory');
  await expect.element(screen.getByRole('tab', { name: language === 'en' ? 'Memory' : 'الذاكرة', exact: true })).toHaveFocus();
  await screen.unmount();
 }
});

test('the Settings memory body draws the same rows as the details panel, and a Viewer is offered no buttons', async () => {
 const memory = <AgentMemory company="co-1" agent={agent} notes={notes} main={false} canReset={false} canEdit={false} canForget={false}/>;
 const settings = await render(<LanguageProvider language="en"><div className="gw"><div className="sov-page sov-page--agents"><div className="dp-sections">{memory}</div></div></div></LanguageProvider>);
 const rows = (screen: Awaited<ReturnType<typeof render>>) => [...screen.container.querySelectorAll('.mem-note__t')].map(row => row.textContent);
 expect(rows(settings)).toEqual(notes.map(note => note.text));
 expect(settings.container.querySelectorAll('button')).toHaveLength(0);
 await settings.unmount();
 const panel = await render(<LanguageProvider language="en"><div className="gw"><div className="dp-sections">{detailsTabs({ t: i18n('en').t, slug: 'rs-learning', agent: agent.id, fileCount: 0, logCount: 0, memory }).memory}</div></div></LanguageProvider>);
 expect(rows(panel)).toEqual(notes.map(note => note.text));
});

test('an address for the Memory tab opens it with the focus on that tab', async () => {
 const screen = await render(<LanguageProvider language="en"><OverlayFrame slug="rs-learning" initialFocus={agentTabFocus('memory')}>
  <AgentTabs slug="rs-learning" agent={agent.id} tab="memory" label={agent.name}/>
 </OverlayFrame></LanguageProvider>);
 await expect.element(screen.getByRole('tab', { name: 'Memory', exact: true })).toHaveFocus();
 // The effect names the same tab the page draws, so nothing is focused before the address is drawn.
 await act(async () => { screen.rerender(<LanguageProvider language="en"><OverlayFrame slug="rs-learning" initialFocus={agentTabFocus('settings')}>
  <AgentTabs slug="rs-learning" agent={agent.id} tab="settings" label={agent.name}/>
 </OverlayFrame></LanguageProvider>); });
 await expect.element(screen.getByRole('tab', { name: 'Settings', exact: true })).toHaveFocus();
});
