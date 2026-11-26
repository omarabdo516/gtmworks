import { expect, onTestFinished, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { AccessCard, type PressAccess } from '@/app/access-card';
import { ToastHost } from '@/app/toast';
import { useConversationText } from '@/app/conversation-thread';
import { LanguageProvider } from '@/lib/i18n-client';
import type { AgentAccessView } from '@/lib/conversations';

vi.mock('@/lib/link', () => ({ default: (props: React.ComponentProps<'a'>) => <a {...props}/> }));

// #167 (design-reference: askMgrHTML, answerAskMgr): the main Agent asks whether to request an Agent hidden from its
// person, naming the Manager who opens Agents for them. The card never holds the Agent.
const sara = { first: 'Sara', name: 'Sara Adel', role: 'manager' };
function Card({ card, press }: { card: AgentAccessView, press?: PressAccess }) {
 const { c, cb } = useConversationText();
 return <div className="chat"><AccessCard card={card} fresh={false} press={press} c={c} cb={cb}/><textarea className="composer__input" aria-label="Message"/></div>;
}
const draw = (card: AgentAccessView, press?: PressAccess, language: 'en' | 'ar' = 'en') => render(<LanguageProvider language={language}><Card card={card} press={press}/><ToastHost/></LanguageProvider>);

test('the card asks with the reference\'s words, and "Ask" sends once, reads what was sent with its time, toasts and gives the message field the focus', async () => {
 let send: (answer: { state: 'asked', at: string }) => void = () => {};
 const press = vi.fn<PressAccess>(() => new Promise(resolve => { send = resolve; }));
 const screen = await draw({ id: 4, named: sara, state: 'offered' }, press);
 onTestFinished(() => screen.unmount());
 const card = screen.getByRole('group', { name: 'Ask Sara for it' });
 await expect.element(card.getByText('Ask Sara for it?')).toBeVisible();
 expect(card.element().textContent).toContain('Sara Adel (Manager) chooses which agents each person works with.');
 expect([...card.element().querySelectorAll('button')].map(button => button.textContent)).toEqual(['No, never mind', 'Ask Sara']);
 await card.getByRole('button', { name: 'Ask Sara' }).click();
 await card.getByRole('button', { name: 'Ask Sara' }).click({ force: true });
 expect(press).toHaveBeenCalledTimes(1);
 expect(press).toHaveBeenCalledWith(4, true);
 send({ state: 'asked', at: new Date().toISOString() });
 await expect.element(card.getByText(/^Sent to Sara · .+\. You’ll get an answer here when they approve\.$/)).toBeVisible();
 expect(card.element().querySelectorAll('button')).toHaveLength(0);
 expect(card.element().classList.contains('is-just')).toBe(true);
 await expect.element(screen.getByRole('status').getByText('Request sent to Sara')).toBeVisible();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
});

test('"No, never mind" sends nothing and says so, with its toast, in Arabic too', async () => {
 const press = vi.fn<PressAccess>(async () => ({ state: 'dismissed', at: new Date().toISOString() }));
 const screen = await draw({ id: 5, named: { first: 'عمر', name: 'عمر', role: 'owner' }, state: 'offered' }, press, 'ar');
 onTestFinished(() => screen.unmount());
 const card = screen.getByRole('group', { name: 'اطلبه من عمر' });
 expect(card.element().textContent).toContain('اختيار الوكلاء اللي كل واحد بيشتغل معاهم عند عمر (أدمن).');
 await card.getByRole('button', { name: 'لا خلاص' }).click();
 expect(press).toHaveBeenCalledWith(5, false);
 await expect.element(card.getByText('تمام، مفيش طلب اتبعت.')).toBeVisible();
 await expect.element(screen.getByRole('status').getByText('مفيش طلب اتبعت')).toBeVisible();
});

test('a pressed card reads its outcome from the record; a failed press keeps the buttons and says so; someone who may not write sees the wait line', async () => {
 const asked = await draw({ id: 6, named: sara, state: 'asked', at: '2026-06-10T10:05:00Z', waits: true });
 const card = asked.getByRole('group', { name: 'Ask Sara for it' });
 await expect.element(card.getByText(/^Sent to Sara · /)).toBeVisible();
 expect(card.element().classList.contains('is-resolved')).toBe(true);
 expect(card.element().classList.contains('is-just')).toBe(false);
 await asked.unmount();

 const failing = await draw({ id: 7, named: sara, state: 'offered' }, async () => ({ error: 'conversationFailed' }));
 const open = failing.getByRole('group', { name: 'Ask Sara for it' });
 await open.getByRole('button', { name: 'Ask Sara' }).click();
 await expect.element(open.getByRole('alert')).toHaveTextContent('Could not send the message. Try again.');
 expect(open.element().querySelectorAll('button')).toHaveLength(2);
 await failing.unmount();

 const viewer = await draw({ id: 8, named: sara, state: 'offered' });
 onTestFinished(() => viewer.unmount());
 const waiting = viewer.getByRole('group', { name: 'Ask Sara for it' });
 await expect.element(waiting.getByText('Waiting for Sara')).toBeVisible();
 expect(waiting.element().querySelectorAll('button')).toHaveLength(0);
});

// Review of #500: a card whose Agent its person sees by now, from the record or from a press, sends nothing and says so.
test('a card for an Agent the person sees by now says it is open for them, with no buttons and no toast', async () => {
 const open = await draw({ id: 9, named: sara, state: 'available' });
 const drawn = open.getByRole('group', { name: 'Ask Sara for it' });
 await expect.element(drawn.getByText('That agent is open for you now: you’ll find it in your agents.')).toBeVisible();
 expect(drawn.element().querySelectorAll('button')).toHaveLength(0);
 await open.unmount();
 const pressed = await draw({ id: 10, named: sara, state: 'offered' }, async () => ({ state: 'available' }));
 onTestFinished(() => pressed.unmount());
 const card = pressed.getByRole('group', { name: 'Ask Sara for it' });
 await card.getByRole('button', { name: 'Ask Sara' }).click();
 await expect.element(card.getByText('That agent is open for you now: you’ll find it in your agents.')).toBeVisible();
 expect(pressed.container.ownerDocument.querySelector('.toast-host')?.textContent ?? '').not.toContain('Request sent');
});
