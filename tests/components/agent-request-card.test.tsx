import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { RequestCard } from '@/app/agent-card';
import { OwnerRequestCard } from '@/app/c/[slug]/[[...section]]/agent-request-card';
import { LanguageProvider } from '@/lib/i18n-client';
import type { AgentRequestView } from '@/lib/conversations';

const answered = vi.hoisted(() => vi.fn<(form: FormData) => Promise<void>>(async () => {}));
vi.mock('@/app/c/[slug]/[[...section]]/skill-actions', () => ({ answerAgentRequest: answered }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
afterEach(() => { answered.mockClear(); });
// An answer still on its way: the action resolves only when the test lets it.
const held = () => { let send = () => {}; answered.mockImplementationOnce(() => new Promise<void>(resolve => { send = resolve; })); return () => send(); };

const asked = { id: 7, name: 'FollowUp', job: 'Follows up the WhatsApp leads.', apps: ['WhatsApp Business', 'Google Sheets'], askedBy: 'Youssef', askedWith: 'The leads go cold before anyone answers' };
const card = (request: AgentRequestView, language: 'en' | 'ar' = 'en') => render(<LanguageProvider language={language}><RequestCard slug="rs-learning" request={request}/></LanguageProvider>);

test('the Member who asked sees the request wait for the Owners, then the answer in place', async () => {
 const waiting = await card({ ...asked, state: 'waiting', owners: ['Omar', 'Sara'] });
 const request = waiting.getByRole('group', { name: 'Agent request: FollowUp' });
 await expect.element(request.getByText('Request · not made yet')).toBeVisible();
 expect(request.element().textContent).toContain('Not made yet. When Omar or Sara says yes it shows in your agents, and I’ll tell you here.');
 for (const text of ['Follows up the WhatsApp leads.', 'WhatsApp Business, Google Sheets', 'Publish anything', 'Youssef«The leads go cold before anyone answers»', 'Youssef and the Owner'])
  expect(request.element().textContent).toContain(text);
 expect(request.element().classList.contains('ac-card--req')).toBe(true);
 expect(request.element().querySelectorAll('button, a')).toHaveLength(0);
 waiting.unmount();

 const made = await card({ ...asked, state: 'made', by: 'Omar', at: '2026-06-10T10:05:00Z', agent: { id: 'agent-1', connection_id: 'connection-1', name: 'FollowUp' } });
 const madeCard = made.getByRole('group', { name: 'Agent request: FollowUp' });
 await expect.element(madeCard.getByText('Made after Omar said yes')).toBeVisible();
 expect(madeCard.element().textContent).toContain('now shows for Youssef.');
 await expect.element(madeCard.getByRole('link', { name: 'Open FollowUp' })).toHaveAttribute('href', '/c/rs-learning/chat/agent-1');
 expect(madeCard.element().classList.contains('ac-card--req')).toBe(false);
 made.unmount();

 const declined = await card({ ...asked, state: 'declined', by: 'عمر', at: '2026-06-10T10:05:00Z', reason: 'Ads follows WhatsApp leads now.' }, 'ar');
 const declinedCard = declined.getByRole('group', { name: 'طلب وكيل: FollowUp' });
 await expect.element(declinedCard.getByText('عمر قال لأ')).toBeVisible();
 expect(declinedCard.element().textContent).toContain('السبب: «Ads follows WhatsApp leads now.»');
});

test('with no Owner to name, a waiting request says it waits for the Owner', async () => {
 const waiting = await card({ ...asked, state: 'waiting', owners: [] });
 onTestFinished(() => waiting.unmount());
 const request = waiting.getByRole('group', { name: 'Agent request: FollowUp' });
 await expect.element(request.getByText('Request · not made yet')).toBeVisible();
 expect(request.element().textContent).toContain('Not made yet. When the Owner says yes it shows in your agents, and I’ll tell you here.');
});

// Both of the Owner's answers in one render: after a form action has run, this browser window draws no new root.
// So the request whose details did not load, which runs no action, comes first.
const item = (id: number) => ({ kind: 'agent_request', id, title: `FollowUp ${id}`, body: 'Follows up the WhatsApp leads.', asked_by: 'Youssef', card_id: null, conversation_id: null, created_at: '2026-06-10T09:41:00Z', request: { apps: ['WhatsApp Business'], asked_with: 'The leads go cold' } });
test('a request whose apps and asking message did not load shows neither and cannot be answered until they do', async () => {
 const screen = await render(<LanguageProvider language="en"><OwnerRequestCard slug="rs-learning" company="co-1" lead="Lead" item={{ ...item(9), request: null }}/></LanguageProvider>);
 const request = screen.getByRole('group', { name: 'Agent request: FollowUp 9' });
 await expect.element(request.getByRole('note')).toHaveTextContent('Part of this request didn’t load, so it can’t be answered yet. Reload the page to try again.');
 for (const text of ['Agent request from Youssef', 'Follows up the WhatsApp leads.', 'Youssef and the Owner']) expect(request.element().textContent).toContain(text);
 for (const text of ['Apps', 'No apps', '«']) expect(request.element().textContent).not.toContain(text);
 await expect.element(request.getByRole('button', { name: 'Make it' })).toBeDisabled();
 await expect.element(request.getByRole('button', { name: 'No' })).toBeDisabled();
 expect(answered).not.toHaveBeenCalled();
});

test('the Owner makes one request at once, and says no to another only with a reason, which goes to the Member', async () => {
 const screen = await render(<LanguageProvider language="en">{[7, 8].map(id => <OwnerRequestCard key={id} slug="rs-learning" company="co-1" lead="Lead" item={item(id)}/>)}</LanguageProvider>);
 const made = screen.getByRole('group', { name: 'Agent request: FollowUp 8' });
 await expect.element(made.getByText('Agent request from Youssef')).toBeVisible();
 expect(made.element().textContent).toContain('Youssef«The leads go cold»');
 const makeSent = held();
 await made.getByRole('button', { name: 'Make it' }).click();
 await expect.poll(() => answered.mock.calls.length).toBe(1);
 await expect.element(made.getByRole('button', { name: 'Make it' })).toBeDisabled();
 await expect.element(made.getByRole('button', { name: 'Make it' })).toHaveAttribute('aria-busy', 'true');
 await expect.element(made.getByRole('button', { name: 'No' })).toBeDisabled();
 await expect.element(screen.getByRole('group', { name: 'Agent request: FollowUp 7' }).getByRole('button', { name: 'Make it' })).toBeEnabled();
 makeSent();
 await expect.element(made.getByRole('button', { name: 'Make it' })).toBeEnabled();
 expect(['request', 'intent', 'reason'].map(name => answered.mock.calls[0][0].get(name))).toEqual(['8', 'make', null]);

 const request = screen.getByRole('group', { name: 'Agent request: FollowUp 7' });
 await request.getByRole('button', { name: 'No' }).click();
 const why = request.getByRole('textbox', { name: 'Why not?' });
 await expect.element(why).toHaveFocus();
 await expect.element(request.getByText('The reason goes to Youssef in their chat with Lead.')).toBeVisible();
 await why.fill('   ');
 await request.getByRole('button', { name: 'Send the no' }).click();
 await expect.element(request.getByText('Write the reason, so Youssef knows why.')).toBeVisible();
 await expect.element(why).toHaveAttribute('aria-invalid', 'true');
 expect(answered).toHaveBeenCalledTimes(1);
 await request.getByRole('button', { name: 'Cancel' }).click();
 await expect.element(request.getByRole('button', { name: 'No' })).toHaveFocus();
 await request.getByRole('button', { name: 'No' }).click();
 await request.getByRole('textbox', { name: 'Why not?' }).fill('Ads follows WhatsApp leads now.');
 const noSent = held();
 await request.getByRole('button', { name: 'Send the no' }).click();
 await expect.poll(() => answered.mock.calls.length).toBe(2);
 await expect.element(request.getByRole('button', { name: 'Send the no' })).toBeDisabled();
 await expect.element(request.getByRole('button', { name: 'Cancel' })).toBeDisabled();
 await expect.element(request.getByRole('textbox', { name: 'Why not?' })).toHaveAttribute('readonly');
 noSent();
 await expect.element(request.getByRole('button', { name: 'Send the no' })).toBeEnabled();
 expect(Object.fromEntries(['company', 'slug', 'request', 'intent', 'reason'].map(name => [name, answered.mock.calls[1][0].get(name)])))
  .toEqual({ company: 'co-1', slug: 'rs-learning', request: '7', intent: 'no', reason: 'Ads follows WhatsApp leads now.' });
});
