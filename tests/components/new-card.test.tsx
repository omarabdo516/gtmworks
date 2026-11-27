import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { cdp, page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import type {} from '@vitest/browser-playwright';
import NewCard from '@/app/c/[slug]/[[...section]]/new-card';
import BoardViews from '@/app/c/[slug]/[[...section]]/board-views';
import { LanguageProvider } from '@/lib/i18n-client';
import { LooksProvider } from '@/lib/agent-looks-client';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/work/board' }));
vi.mock('@/lib/link', () => ({ default: ({ prefetch: _prefetch, scroll: _scroll, ...props }: ComponentProps<'a'> & { prefetch?: unknown, scroll?: unknown }) => <a {...props}/> }));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ decideAgentRule: vi.fn(), answerAgentRequest: vi.fn() }));
afterEach(async () => { vi.unstubAllGlobals(); await cdp().send('Emulation.setEmulatedMedia', { features: [] }); });

// New card (spec #831, #836; design-reference-card: ncOpen): one small form over the board. Whom a Card may be given
// to comes from the board's own route; a Card is made by one request, whatever is pressed twice.
const company = '10000000-0000-0000-0000-000000000001';
const me = '20000000-0000-0000-0000-000000000003';
const choices = { me, agents: [{ id: 'a1', name: 'Lead' }, { id: 'a2', name: 'Ads' }], people: [{ id: '20000000-0000-0000-0000-000000000002', name: 'Mona' }, { id: me, name: 'Sami' }] };
const answer = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function engine(made: (body: Record<string, unknown>) => Response = () => answer({ made: 't_0000abcd', cards: [], main: null })) {
 const sent: Record<string, unknown>[] = [];
 vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
  if (init?.method === 'POST') { const body = JSON.parse(String(init.body)); sent.push(body); return made(body); }
  return answer(url.startsWith(`/api/board/cards?company=${company}`) ? choices : {}, url.startsWith('/api/board/cards') ? 200 : 404);
 });
 return sent;
}
const open = (language: 'en' | 'ar' = 'en', handlers: Partial<ComponentProps<typeof NewCard>> = {}) => render(<LanguageProvider language={language}><LooksProvider looks={{ agents: {}, requests: {}, removed: {} }}>
 <NewCard company={company} onClose={() => {}} onMade={() => {}} {...handlers}/></LooksProvider></LanguageProvider>);

for (const language of ['en', 'ar'] as const) for (const width of [1440, 390]) test(`in ${language} at ${width}px New card fits the window, starts on its title, and Close closes it making nothing`, async () => {
 await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
 await page.viewport(width, 900);
 const sent = engine(); const onClose = vi.fn();
 const screen = await open(language, { onClose });
 const dialog = screen.getByRole('dialog');
 await expect.element(dialog).toBeInViewport({ ratio: 1 });
 expect(document.activeElement?.id).toBe('nc-t');
 await expect.poll(() => { const box = dialog.element().getBoundingClientRect(); return box.left >= 0 && box.top >= 0 && box.right <= width && box.bottom <= 900; }).toBe(true);
 await dialog.getByRole('button', { name: language === 'en' ? 'Close' : 'إغلاق', exact: true }).click();
 await expect.poll(() => onClose.mock.calls.length).toBe(1);
 expect(sent).toEqual([]);
});

test('a Card needs a title: Add card without one says so and sends nothing; Escape closes it', async () => {
 const sent = engine(); const onClose = vi.fn();
 const screen = await open('en', { onClose });
 await screen.getByRole('button', { name: 'Add card' }).click();
 await expect.element(screen.getByText('Write a title for the card, even two words.')).toBeVisible();
 await expect.element(screen.getByPlaceholder('Title')).toHaveAttribute('aria-invalid', 'true');
 expect(sent).toEqual([]);
 await userEvent.keyboard('{Escape}');
 await expect.poll(() => onClose.mock.calls.length).toBe(1);
});

test('the Assignee menu offers Assign to me, the Agents, the People and No one yet; an Agent shows it starts at once', async () => {
 engine();
 const screen = await open();
 const pick = screen.getByRole('button', { name: 'Assignee: No one yet' });
 await pick.click();
 const items = screen.getByRole('menuitemradio');
 await expect.poll(async () => (await items.all()).map(item => item.element().querySelector('.menu__t')?.textContent)).toEqual(['Assign to me', 'Lead', 'Ads', 'Mona', 'Sami (you)', 'No one yet']);
 await expect.element(screen.getByRole('menuitemradio', { name: 'No one yet' })).toHaveAttribute('aria-checked', 'true');
 await screen.getByRole('menuitemradio', { name: 'Ads' }).click();
 await expect.element(screen.getByRole('button', { name: 'Assignee: Ads' })).toBeVisible();
 await expect.element(screen.getByRole('img', { name: 'Ads starts on it at once' })).toBeVisible();
 await screen.getByRole('button', { name: 'Assignee: Ads' }).click();
 await screen.getByRole('menuitemradio', { name: 'Assign to me' }).click();
 await expect.element(screen.getByRole('button', { name: 'Assignee: Sami' })).toBeVisible();
 await expect.element(screen.getByRole('img', { name: /starts on it at once/ })).not.toBeInTheDocument();
});

test('Add card sends its title, description, Assignee and publishing date once, with one key, and hands the board on', async () => {
 const sent = engine(); const onMade = vi.fn();
 const screen = await open('en', { onMade });
 await userEvent.fill(screen.getByPlaceholder('Title'), 'December ad copy');
 await userEvent.fill(screen.getByPlaceholder('Description'), '- [ ] Three headlines');
 await screen.getByRole('button', { name: 'Assignee: No one yet' }).click();
 await screen.getByRole('menuitemradio', { name: 'Mona' }).click();
 await userEvent.fill(screen.getByLabelText('Publishing date'), '2026-12-24');
 await screen.getByRole('button', { name: 'Add card' }).dblClick();
 await expect.poll(() => onMade.mock.calls.length).toBe(1);
 expect(sent).toHaveLength(1);
 expect(sent[0]).toEqual({ company, key: expect.stringMatching(/^[0-9a-f-]{36}$/), title: 'December ad copy', description: '- [ ] Three headlines', assignee: 'member:20000000-0000-0000-0000-000000000002', publishOn: '2026-12-24' });
 expect(onMade.mock.calls[0][0]).toMatchObject({ made: 't_0000abcd' });
});

test('a refused Card says so and keeps the form, and a retry sends the same key', async () => {
 let tries = 0;
 const sent = engine(() => ++tries === 1 ? answer({ error: 'boardUnreachable' }, 503) : answer({ made: 't_0000abcd' }));
 const onMade = vi.fn();
 const screen = await open('en', { onMade });
 await userEvent.fill(screen.getByPlaceholder('Title'), 'Weekly report');
 await screen.getByRole('button', { name: 'Add card' }).click();
 await expect.element(screen.getByRole('alert')).toHaveTextContent('The card wasn’t added. Try again.');
 await expect.element(screen.getByPlaceholder('Title')).toHaveValue('Weekly report');
 await screen.getByRole('button', { name: 'Add card' }).click();
 await expect.poll(() => onMade.mock.calls.length).toBe(1);
 expect(sent.map(body => body.key)).toEqual([sent[0].key, sent[0].key]);
});

// The list and the calendar read the board (#845); their socket to the board's live stream never opens here.
for (const view of ['list', 'calendar'] as const) test(`on the ${view}, + New card leads to New card on the board`, async () => {
 engine(); vi.stubGlobal('WebSocket', class extends EventTarget { close() {} });
 const screen = await render(<LanguageProvider language="en"><LooksProvider looks={{ agents: {}, requests: {}, removed: {} }}><BoardViews company={company} slug="rs-learning" view={view} writer/></LooksProvider></LanguageProvider>);
 await expect.element(screen.getByRole('link', { name: '+ New card' })).toHaveAttribute('href', '/c/rs-learning/work/new');
});

