import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import ConversationView from '@/app/c/[slug]/conversations/[id]/conversation';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ConversationRecord } from '@/lib/conversation-record';
import type { AgentRequestView } from '@/lib/conversations';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }));
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
