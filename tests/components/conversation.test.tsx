import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import ConversationView from '@/app/c/[slug]/conversations/[id]/conversation';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ConversationRecord } from '@/lib/conversation-record';
import type { AgentRequestView } from '@/lib/conversations';
import '@/app/shell.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const at = '2026-06-10T09:41:00Z';
const reason = 'Ads follows WhatsApp leads now.';
const asked = { id: 7, name: 'FollowUp', job: 'Follows up the WhatsApp leads.', apps: ['WhatsApp Business'], askedBy: 'Youssef', askedWith: 'The leads go cold' };
const record = (request: AgentRequestView, decided: ConversationRecord['messages'] = []): ConversationRecord => ({
 conversation: { id: 'cv-1', agent_name: 'Lead', face: 'c-1' },
 messages: [
  { id: 1, author: 'person', author_name: 'Youssef', body: 'The leads go cold', created_at: at },
  { id: 2, author: 'agent', author_name: 'Lead', body: 'I prepared your request and sent it to the Owner.', created_at: at, cards: [{ kind: 'request', request }] },
  ...decided,
 ],
 usage: { input: 0, output: 0, unknown: 0 }, pending: false, failed: false, working: null, canStop: false,
});
const waiting = record({ ...asked, state: 'waiting', owners: ['Omar'] });
const declined = record({ ...asked, state: 'declined', by: 'Omar', at, reason },
 [{ id: 0, author: 'agent', author_name: 'Lead', body: '', created_at: at, kind: 'decided', decided: { kind: 'request', by: 'Omar', name: 'FollowUp', at, made: false, reason } }]);

test('a Member who keeps their Conversation open sees the Owner\'s answer arrive, and the page stops asking once nothing waits', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const answers = [waiting, declined];
 const asks = vi.fn(async () => Response.json(answers.shift() ?? declined));
 vi.stubGlobal('fetch', asks);
 const screen = await render(<LanguageProvider language="en"><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={waiting.conversation} initial={waiting} writer={false} team={false}/></LanguageProvider>);
 const request = screen.getByRole('group', { name: 'Agent request: FollowUp' });
 await expect.element(request.getByText('Request · not made yet')).toBeVisible();

 await vi.advanceTimersByTimeAsync(500);
 expect(asks).toHaveBeenCalledTimes(1);
 await expect.element(request.getByText('Request · not made yet')).toBeVisible();

 await vi.advanceTimersByTimeAsync(5000);
 expect(asks).toHaveBeenCalledTimes(2);
 await expect.element(request.getByText('Omar said no')).toBeVisible();
 expect(request.element().textContent).toContain(`Reason: «${reason}»`);

 await vi.advanceTimersByTimeAsync(30000);
 expect(asks).toHaveBeenCalledTimes(2);
});

const talk = (messages: ConversationRecord['messages'], more: Partial<ConversationRecord> = {}): ConversationRecord => ({
 conversation: { id: 'cv-2', agent_name: 'Mona', face: 'c-2' }, messages, usage: { input: 0, output: 0, unknown: 0 }, pending: false, failed: false, working: null, canStop: false, ...more,
});
const view = (initial: ConversationRecord, language: 'en' | 'ar' = 'en') => <LanguageProvider language={language}><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={initial.conversation} initial={initial} writer team={false}/></LanguageProvider>;
const sent = { id: 1, author: 'person' as const, author_name: 'Omar', body: 'Draft the long launch plan', created_at: at };

test('while the Agent works the page says so, and the line goes once the reply is in the record', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(talk([sent, { id: 2, author: 'agent', author_name: 'Mona', body: 'Reply to: Draft the long launch plan', created_at: at }]))));
 const screen = await render(view(talk([sent], { pending: true })));
 await expect.element(screen.getByRole('status')).toHaveTextContent('Mona is working on a reply…');
 await vi.advanceTimersByTimeAsync(500);
 await expect.element(screen.getByText('Reply to: Draft the long launch plan')).toBeVisible();
 await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
});

test('a message whose run the engine no longer knows is marked lost', async () => {
 const screen = await render(view(talk([{ ...sent, lost: true }], { failed: true })));
 const turn = screen.getByRole('list', { name: 'Messages' }).getByRole('listitem').filter({ hasText: 'Draft the long launch plan' });
 await expect.element(turn.getByText('Lost: the agent engine no longer has this reply.')).toBeVisible();
});

for (const [language, dir, body, own] of [['en', 'ltr', 'خطة إطلاق الكورس for the Meta campaign', 'rtl'], ['ar', 'rtl', 'Plan the launch week', 'ltr']] as const) test(`in ${dir} the person's turn sits on the end side and the Agent's on the start side, and a message in the other script keeps its own direction`, async () => {
 await page.viewport(1440, 900);
 document.documentElement.dir = dir;
 onTestFinished(() => { document.documentElement.dir = ''; });
 const screen = await render(<div className="gw" dir={dir}>{view(talk([{ ...sent, body }, { id: 2, author: 'agent', author_name: 'Mona', body: 'On it.', created_at: at }]), language)}</div>);
 const turns = screen.getByRole('list'); const column = turns.element().getBoundingClientRect();
 const [mine, reply] = [turns.getByText(body).element(), turns.getByText('On it.').element()];
 const [person, agent] = [mine.getBoundingClientRect(), reply.getBoundingClientRect()];
 const [start, end] = dir === 'ltr' ? ['left', 'right'] as const : ['right', 'left'] as const;
 expect([Math.round(person[end]), Math.round(agent[start])]).toEqual([Math.round(column[end]), Math.round(column[start])]);
 expect(person.width).toBeLessThan(column.width / 2);
 expect(agent.width).toBeLessThan(column.width / 2);
 expect(getComputedStyle(mine).direction).toBe(own);
 expect(getComputedStyle(screen.getByRole('heading').getByText(body).element()).direction).toBe(own);
});
