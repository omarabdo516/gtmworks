import { expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { ProposalNote, ProposalMark } from '@/app/settings-proposal';
import { OverlayChrome } from '@/app/settings-overlay-chrome';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n, type Language } from '@/lib/i18n.mjs';
import type { WaitingChange } from '@/lib/agent-change-waiting.mjs';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))}/> }));

// #178 (design-reference: sovAgentHTML's .sov-pend, sovAgentsHTML's row and sovNavHTML's count).
const model: WaitingChange = { id: 7, agent: 'analyst', conversation: 'talk-7', askedBy: 'omar', change: 'model', setting: null, value: 'google/gemini-2.5-pro', by: 'Lead' };
// The note's sentence, without its link.
const said = (note: { element: () => Element }) => note.element().querySelector(':scope > span')?.textContent;
const inSettings = (node: React.ReactNode, language: Language = 'en') => render(<LanguageProvider language={language}><div className="gw"><div className="sov">{node}</div></div></LanguageProvider>);

test('the Owner reads who proposed what, waiting for their OK, and opens the proposal', async () => {
 const screen = await inSettings(<ProposalNote change={model} owner owners={[]} href="/c/rs/conversations/talk-7#change-7"/>);
 const note = screen.getByRole('note');
 await expect.element(note).toBeVisible();
 expect(said(note)).toBe('Lead proposed New model: google/gemini-2.5-pro · waiting for your OK. Nothing changes here before that.');
 await expect.element(note.getByRole('link', { name: 'Open the proposal' })).toHaveAttribute('href', '/c/rs/conversations/talk-7#change-7');
 // The reference's wait colours: the note on its wait background, its text and link in the wait text colour.
 const style = getComputedStyle(note.element());
 expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
 expect(getComputedStyle(note.getByRole('link').element()).color).toBe(style.color);
});

test('another Member reads it waiting for the Owner by name, in Arabic with the values in their own direction', async () => {
 const screen = await inSettings(<ProposalNote change={{ ...model, change: 'instructions', value: 'Short.' }} owner={false} owners={['عمر']} href="/c/rs/conversations/talk-7#change-7"/>, 'ar');
 const note = screen.getByRole('note');
 await expect.element(note).toBeVisible();
 expect(said(note)).toBe('Lead اقترح تعليمات أساسية جديدة · مستني عمر. مفيش حاجة بتتغيّر هنا قبلها.');
 await expect.element(note.getByRole('link', { name: 'افتح الاقتراح' })).toBeVisible();
 expect(note.element().querySelector('bdi')?.textContent).toBe('Lead');
});

test('a switch or a setting is named with its new value; a Company with no Owner named waits for the Owner', async () => {
 const subagents = await inSettings(<ProposalNote change={{ ...model, change: 'toolset', setting: 'delegation', value: true }} owner={false} owners={[]} href={null}/>);
 await expect.element(subagents.getByRole('note')).toBeVisible();
 expect(said(subagents.getByRole('note'))).toBe('Lead proposed New value for Sub-agents: On · waiting for the Owner. Nothing changes here before that.');
 expect(subagents.getByRole('link').elements()).toHaveLength(0);
 await subagents.unmount();
 const zone = await inSettings(<ProposalNote change={{ ...model, change: 'setting', setting: 'timezone', value: 'Africa/Cairo' }} owner owners={[]} href="/c/rs/approvals#change-7"/>);
 await expect.element(zone.getByRole('note')).toBeVisible();
 expect(said(zone.getByRole('note'))).toBe('Lead proposed New value for Time zone: Africa/Cairo · waiting for your OK. Nothing changes here before that.');
});

test('on a phone a long value wraps inside the note', async () => {
 await page.viewport(390, 800);
 const screen = await inSettings(<div style={{ width: 358 }}><ProposalNote change={{ ...model, value: `openrouter/${'a'.repeat(150)}` }} owner owners={[]} href="/c/rs/approvals#change-7"/></div>);
 const note = screen.getByRole('note').element();
 expect(note.scrollWidth).toBe(note.clientWidth);
});

test('the row ends with "Proposal waiting" and the waiting dot, in the wait colour', async () => {
 const screen = await inSettings(<><div className="panel-row"><ProposalMark/></div><div className="panel-row"><span className="panel-row__meta">Idle</span></div></>);
 const mark = screen.getByText('Proposal waiting');
 await expect.element(mark).toBeVisible();
 // In the wait text colour, where another row's state is in the quieter text colour.
 const probe = document.querySelector('.sov')!.appendChild(document.createElement('i')); probe.style.color = 'var(--gw-wait-text)';
 expect(getComputedStyle(mark.element()).color).toBe(getComputedStyle(probe).color);
 expect(getComputedStyle(mark.element()).color).not.toBe(getComputedStyle(screen.getByText('Idle').element()).color);
 const dot = mark.element().querySelector('.dot--waiting')!;
 expect(dot.getAttribute('aria-hidden')).toBe('true');
 expect(getComputedStyle(dot).width).toBe('8px');
 expect(getComputedStyle(dot).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
});

test('"Agents" carries the number of waiting proposals, read out as waiting for the Owner\'s OK, and none when there are none', async () => {
 const chrome = (agentsWaiting: number, language: Language = 'en') => render(<LanguageProvider language={language}>
  <OverlayChrome t={i18n(language).t} slug="rs" companyName="RS Learning" role="owner" readOnly={false} section="agents" learningWaiting={0} agentsWaiting={agentsWaiting}><p>page</p></OverlayChrome></LanguageProvider>);
 const two = await chrome(2);
 const agents = two.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: /^Agents/ });
 await expect.element(agents).toHaveAccessibleName('Agents 2 waiting for your OK');
 await two.unmount();
 const none = await chrome(0);
 await expect.element(none.getByRole('navigation').getByRole('link', { name: /^Agents/ })).toHaveAccessibleName('Agents');
 await none.unmount();
 const arabic = await chrome(1, 'ar');
 await expect.element(arabic.getByRole('navigation').getByRole('link', { name: /^الوكلاء/ })).toHaveAccessibleName('الوكلاء 1 مستنيين موافقتك');
});
