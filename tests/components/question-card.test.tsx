import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { use, type ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import ConversationView, { ConversationLoaded } from '@/app/c/[slug]/conversations/[id]/conversation';
import { ReplyCard } from '@/app/reply-card';
import { ShellIcon } from '@/components/shell-icon';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ConversationRecord } from '@/lib/conversation-record';
import type { ReplyCard as Card } from '@/lib/conversations';
const Arrived = ({ record }: { record: Promise<ConversationRecord> }) => <ConversationLoaded initial={use(record)} team={false}/>;

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/conversations/cv-1', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const arrived = (record: ConversationRecord) => Object.assign(Promise.resolve(record), { status: 'fulfilled', value: record });

// design-reference: threads['th-meta'] m3, its question and the three ANGLES texts; a fourth for four choices.
type Question = Extract<Card, { kind: 'question' }>;
const angles = ['من خريج لمحاسب شغال', 'Excel وOdoo في كورس واحد', 'شهادة معتمدة وتدريب عملي', 'فيديو قصير من طالب اتوظف'];
const asked = (choices: string[], more: Partial<Question> = {}): Question => ({ id: 42, kind: 'question', title: 'اختار زاوية الإعلان', question: 'اختار زاوية الإعلان', choices, multiple: false, state: 'open', ...more } as Question);
const words = {
 en: { letters: ['A', 'B', 'C', 'D'], hint: 'Pick one, or write your answer in the message', answered: 'Answered', closed: 'This question can no longer be answered', inWords: 'Write your answer in the message' },
 ar: { letters: ['أ', 'ب', 'ج', 'د'], hint: 'اختار واحدة، أو اكتب رأيك في الرسالة', answered: 'اتجاوب', closed: 'السؤال ده مبقاش ينفع يتجاوب', inWords: 'اكتب ردك في الرسالة' },
};
const drawn = (card: Card, language: 'en' | 'ar', answer?: (card: number, choice: number, key: string) => Promise<string | null>) =>
 render(<LanguageProvider language={language}><div dir={language === 'ar' ? 'rtl' : 'ltr'}><ReplyCard card={card} fresh={false} answer={answer}/>
  <div data-testid="icons"><ShellIcon name="check"/></div></div></LanguageProvider>);
const keys = (group: Element) => [...group.querySelectorAll('.opt__key')].map(key => key.textContent);

test.each([['en', 2], ['en', 4], ['ar', 2], ['ar', 4]] as const)('in the %s interface, an open question with %i choices shows the question, the hint and one lettered button per choice, reached in order by keyboard', async (language, count) => {
 const card = asked(angles.slice(0, count));
 const screen = await drawn(card, language, async () => null);
 const group = screen.getByRole('group', { name: card.question });
 await expect.element(group).toBeVisible();
 await expect.element(group.getByText(card.question, { exact: true })).toBeVisible();
 await expect.element(group.getByText(words[language].hint, { exact: true })).toBeVisible();
 const buttons = group.getByRole('button').elements();
 expect(buttons.map(button => button.querySelector('.opt__t')?.textContent)).toEqual(card.choices);
 expect(keys(group.element())).toEqual(words[language].letters.slice(0, count));
 for (const button of buttons) {
  await userEvent.keyboard('{Tab}');
  expect(document.activeElement, button.textContent ?? '').toBe(button);
 }
 expect(group.element().querySelector('.opt__check'), 'no check while it is open').toBeNull();
});

test.each(['en', 'ar'] as const)('in the %s interface, a pick sends its card, the choice\'s index and the card\'s key once, reads answered at once and settles only once', async language => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const card = asked(angles.slice(0, 3));
 const answer = vi.fn(async () => null);
 const screen = await drawn(card, language, answer);
 const group = screen.getByRole('group', { name: card.question });
 await group.getByRole('button', { name: angles[1] }).click();
 const resolved = screen.getByRole('group', { name: `${card.question}: ${words[language].answered}` });
 await expect.element(resolved).toBeVisible();
 expect(answer).toHaveBeenCalledExactlyOnceWith(42, 1, expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
 expect(resolved.getByRole('button').elements(), 'nothing left to click').toEqual([]);
 expect([...resolved.element().querySelectorAll('.opt__t')].map(text => text.textContent)).toEqual([angles[1]]);
 expect(keys(resolved.element())).toEqual([words[language].letters[1]]);
 expect(resolved.element().classList.contains('is-just'), 'it settles where it was answered').toBe(true);
 await vi.advanceTimersByTimeAsync(900);
 await expect.element(resolved).not.toHaveClass('is-just');
});

test('a pick the server refuses gives the choices back with the refusal, and the same key is sent again', async () => {
 const card = asked(angles.slice(0, 2));
 const answer = vi.fn().mockResolvedValueOnce('conversationNotAllowed').mockResolvedValueOnce(null);
 const screen = await drawn(card, 'en', answer);
 await screen.getByRole('button', { name: angles[0] }).click();
 await expect.element(screen.getByRole('alert')).toBeVisible();
 await screen.getByRole('button', { name: angles[0] }).click();
 await expect.element(screen.getByRole('group', { name: `${card.question}: Answered` })).toBeVisible();
 expect(answer.mock.calls[1][2]).toBe(answer.mock.calls[0][2]);
});

test.each([
 ['a pick', angles[1], ['B'], angles[1]],
 ['typed words equal to a choice', ` ${angles[2]}\n`, ['C'], angles[2]],
 ['typed words that are no choice', 'الاتنين مع بعض\nبس الأولى الأول', [], 'الاتنين مع بعض\nبس الأولى الأول'],
] as const)('answered with %s, the card reads Answered and keeps only the answer, with its letter when it is a choice, and the check', async (_, answer, letters, shown) => {
 const card = asked(angles.slice(0, 3), { state: 'answered', answer } as Partial<Question>);
 const screen = await drawn(card, 'en');
 const group = screen.getByRole('group', { name: `${card.question}: Answered` });
 await expect.element(group).toBeVisible();
 await expect.element(group.getByText('Answered', { exact: true })).toBeVisible();
 expect(group.getByRole('button').elements()).toEqual([]);
 expect([...group.element().querySelectorAll('.opt__t')].map(text => text.textContent)).toEqual([shown]);
 expect(keys(group.element())).toEqual(letters);
 const check = screen.getByTestId('icons').element().querySelector('svg')?.innerHTML;
 expect(group.element().querySelector('.opt__check')?.innerHTML).toBe(check);
 expect(group.element().classList.contains('is-just'), 'a card answered before the page was drawn does not settle').toBe(false);
});

test.each(['en', 'ar'] as const)('in the %s interface, a question the Engine no longer waits for says so in one line and offers nothing', async language => {
 const card = asked(angles.slice(0, 3), { state: 'closed' });
 const screen = await drawn(card, language, async () => null);
 const group = screen.getByRole('group', { name: card.question });
 await expect.element(group.getByText(words[language].closed, { exact: true })).toBeVisible();
 expect(group.getByRole('button').elements()).toEqual([]);
 expect(group.element().querySelectorAll('.opt')).toHaveLength(0);
});

test.each([['open-ended', asked([])], ['several may be picked', asked(angles.slice(0, 3), { multiple: true })]] as const)('a question that is %s is answered in words: no lettered buttons and the hint says to write', async (_, card) => {
 const screen = await drawn(card, 'en', async () => null);
 const group = screen.getByRole('group', { name: card.question });
 await expect.element(group.getByText(words.en.inWords, { exact: true })).toBeVisible();
 expect(group.getByRole('button').elements()).toEqual([]);
});

// The chat: the Agent waits on its question, so it is not shown working; a pick posts the answer intent and the record is
// read again, which shows the card answered and the pick as the person's message after it.
const at = '2026-06-10T09:41:00Z';
const conversation = { id: '7d3f0b1e-1c2a-4b5d-8e6f-9a0b1c2d3e4f', agent_id: null, agent_name: 'Ads', face: 'c-1' };
const record = (card: Question, answer?: string): ConversationRecord => ({
 conversation,
 messages: [
  { id: 1, author: 'person', author_name: 'Omar', body: 'محتاجين حملة Meta لكورس «المحاسب الشامل»', created_at: at },
  { id: 42, author: 'agent', author_name: 'Ads', body: '', created_at: at, kind: 'asked', cards: [{ kind: 'reply', card }] },
  ...answer ? [{ id: 42, author: 'person' as const, author_name: 'Omar', body: answer, created_at: at, kind: 'answer' as const }] : [],
 ],
 usage: { input: 0, output: 0, unknown: 0 }, pending: true, ...answer ? {} : { asking: true as const }, failed: false, working: null, canStop: false,
});

test('in the chat, a pick posts the answer, the record is read again, and the pick shows as the person\'s message after the answered card', async () => {
 const sheets = await Promise.all(['app/tokens.css', 'app/shell.css'].map(async file => (await import(/* @vite-ignore */ `/${file}?inline`)).default as string));
 const styles = sheets.map(css => Object.assign(document.createElement('style'), { textContent: css }));
 document.head.append(...styles);
 onTestFinished(() => styles.forEach(style => style.remove()));
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const open = asked(angles.slice(0, 3));
 const calls = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json({ state: 'claimed' })
  : Response.json(record({ ...open, state: 'answered', answer: angles[0] } as Question, angles[0])));
 vi.stubGlobal('fetch', calls);
 const screen = await render(<LanguageProvider language="en"><div className="gw"><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={conversation} title="" writer><Arrived record={arrived(record(open))}/></ConversationView></div></LanguageProvider>);
 await expect.element(screen.getByRole('group', { name: open.question })).toBeVisible();
 expect(screen.getByRole('status').elements().filter(line => line.matches('.convo-status')), 'the Agent waits on the person, not working').toEqual([]);

 await screen.getByRole('button', { name: angles[0] }).click();
 // Answered on this page, the card settles, its letter pops and its check draws (design-reference: .card.is-just).
 const settled = screen.getByRole('group', { name: `${open.question}: Answered` }).element();
 const motion = (part: Element) => { const style = getComputedStyle(part); return [style.animationName, style.animationDuration, style.animationDelay]; };
 expect([settled, settled.querySelector('.opt__key')!, settled.querySelector('.opt__check path')!].map(motion))
  .toEqual([['gw-settle', '0.32s', '0s'], ['gw-ck-pop', '0.32s', '0s'], ['gw-draw-check', '0.38s', '0.14s']]);
 const posted = calls.mock.calls.filter(([, init]) => init?.method === 'POST');
 expect(posted).toHaveLength(1);
 expect(JSON.parse(posted[0][1]!.body as string)).toEqual({ company: 'co-1', conversation: conversation.id, intent: 'answer', card: 42, choice: 0, answerKey: expect.any(String) });
 await vi.advanceTimersByTimeAsync(500);
 expect(calls.mock.calls.filter(([, init]) => init?.method !== 'POST')).toHaveLength(1);
 await expect.poll(() => document.querySelector<HTMLElement>('.turns > li[data-kind="answer"]')?.textContent).toContain(angles[0]);
 expect(document.querySelector<HTMLElement>('.turns > li[data-kind="answer"]')?.dataset.author).toBe('person');
 const order = [...document.querySelectorAll('.turns > li')].map(item => (item as HTMLElement).dataset.kind ?? 'message');
 expect(order).toEqual(['message', 'asked', 'answer']);
 await expect.element(screen.getByRole('group', { name: `${open.question}: Answered` })).toBeVisible();
});
