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
 en: { letters: ['A', 'B', 'C', 'D'], hint: 'Pick one, or write your answer in the message', answered: 'Answered', closed: 'This question can no longer be answered', inWords: 'Write your answer in the message', orType: 'or type the answer below' },
 ar: { letters: ['أ', 'ب', 'ج', 'د'], hint: 'اختار واحدة، أو اكتب رأيك في الرسالة', answered: 'اتجاوب', closed: 'السؤال ده مبقاش ينفع يتجاوب', inWords: 'اكتب ردك في الرسالة', orType: 'أو اكتب الإجابة تحت' },
};
const drawn = (card: Card, language: 'en' | 'ar', answer?: (card: number, choice: number | number[], key: string) => Promise<string | null>, chips = false) =>
 render(<LanguageProvider language={language}><div dir={language === 'ar' ? 'rtl' : 'ltr'}><ReplyCard card={card} fresh={false} answer={answer} chips={chips}/>
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

// design-reference: cardHTML sets dir="rtl" on its Arabic card, so in the English interface too the question, the hint
// and each choice keep the card's right edge, and each letter stands to the right of its choice.
test.each(['en', 'ar'] as const)('in the %s interface, an Arabic question is laid out right to left, its question and its choices against the right edge', async language => {
 const sheets = await Promise.all(['app/tokens.css', 'app/shell.css'].map(async file => (await import(/* @vite-ignore */ `/${file}?inline`)).default as string));
 const styles = sheets.map(css => Object.assign(document.createElement('style'), { textContent: css }));
 document.head.append(...styles);
 onTestFinished(() => styles.forEach(style => style.remove()));
 const screen = await render(<LanguageProvider language={language}><div dir={language === 'ar' ? 'rtl' : 'ltr'}><div className="gw" style={{ width: 640 }}>
  <ReplyCard card={asked(angles.slice(0, 3))} fresh={false} answer={async () => null}/></div></div></LanguageProvider>);
 const group = screen.getByRole('group', { name: 'اختار زاوية الإعلان' }).element();
 expect(getComputedStyle(group).direction).toBe('rtl');
 const right = group.getBoundingClientRect().right;
 const question = group.querySelector('.qcard__q')!; const hint = group.querySelector('.qcard__hint')!;
 for (const text of [question, hint]) {
  const range = document.createRange(); range.selectNodeContents(text);
  expect(right - range.getBoundingClientRect().right, `${text.className} keeps the right edge`).toBeLessThan(24);
 }
 for (const row of group.querySelectorAll('.opt')) {
  const key = row.querySelector('.opt__key')!.getBoundingClientRect(); const text = row.querySelector('.opt__t')!;
  const range = document.createRange(); range.selectNodeContents(text); const words = range.getBoundingClientRect();
  expect(key.left, 'the letter stands to the right of its choice').toBeGreaterThan(words.right);
  expect(key.left - words.right, 'the choice sits right beside its letter').toBeLessThan(24);
 }
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

test('an open-ended question is answered in words: no lettered buttons and the hint says to write', async () => {
 const card = asked([]);
 const screen = await drawn(card, 'en', async () => null);
 const group = screen.getByRole('group', { name: card.question });
 await expect.element(group.getByText(words.en.inWords, { exact: true })).toBeVisible();
 expect(group.getByRole('button').elements()).toEqual([]);
});

// #648: a question where several may be picked draws every choice on the lettered card (design-reference: cardHTML's
// choice branch), each a toggle, and a Send that sends the picks as one answer; it can still be answered in words. The
// main Agent's asks it on the same card, since a chip is one pick.
const picks = { en: { hint: 'Pick one or more, then send, or write your answer in the message', send: 'Send picks' }, ar: { hint: 'اختار واحدة أو أكتر وابعت، أو اكتب ردك في الرسالة', send: 'ابعت اختياراتك' } };
test.each([['en', false], ['ar', false], ['en', true], ['ar', true]] as const)('in the %s interface (main Agent: %s), a several-pick question draws every choice as a lettered toggle and a Send that waits for a pick', async (language, chips) => {
 const card = asked(angles, { multiple: true });
 const screen = await drawn(card, language, async () => null, chips);
 const group = screen.getByRole('group', { name: card.question });
 await expect.element(group.getByText(picks[language].hint, { exact: true })).toBeVisible();
 const toggles = [...group.element().querySelectorAll('.qcard__opts button.opt')] as HTMLButtonElement[];
 expect(toggles.map(toggle => toggle.querySelector('.opt__t')?.textContent)).toEqual(angles);
 expect(toggles.map(toggle => toggle.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'false']);
 expect(keys(group.element())).toEqual(words[language].letters);
 await expect.element(group.getByRole('button', { name: picks[language].send, exact: true })).toBeDisabled();
 expect(group.element().querySelectorAll('.chip'), 'no chips: a chip is one pick').toHaveLength(0);
});

test.each(['en', 'ar'] as const)('in the %s interface, two of four picked and sent close the card with both picks, each with its check, sending them once', async language => {
 const card = asked(angles, { multiple: true });
 const answer = vi.fn(async () => null);
 const screen = await drawn(card, language, answer);
 const group = screen.getByRole('group', { name: card.question });
 await group.getByRole('button', { name: angles[3] }).click();
 await group.getByRole('button', { name: angles[1] }).click();
 await group.getByRole('button', { name: angles[2] }).click();
 await group.getByRole('button', { name: angles[1] }).click();
 await expect.element(group.getByRole('button', { name: angles[2] })).toHaveAttribute('aria-pressed', 'true');
 await expect.element(group.getByRole('button', { name: angles[1] })).toHaveAttribute('aria-pressed', 'false');
 await group.getByRole('button', { name: picks[language].send, exact: true }).click();
 const resolved = screen.getByRole('group', { name: `${card.question}: ${words[language].answered}` });
 await expect.element(resolved).toBeVisible();
 expect(answer).toHaveBeenCalledExactlyOnceWith(42, [2, 3], expect.stringMatching(/^[0-9a-f-]{36}$/));
 expect(resolved.getByRole('button').elements(), 'nothing left to click').toEqual([]);
 const rows = [...resolved.element().querySelectorAll('.opt.is-chosen')];
 expect(rows.map(row => row.querySelector('.opt__t')?.textContent)).toEqual([angles[2], angles[3]]);
 expect(rows.map(row => row.querySelector('.opt__key')?.textContent)).toEqual(words[language].letters.slice(2, 4));
 expect(rows.every(row => row.querySelector('.opt__check'))).toBe(true);
});

// #651: in a channel, where typed words are not taken, the several-pick card asks for picks alone; one someone else must
// answer shows its choices under the wait line, the main Agent's naming the Member it was asked of.
const teamPicks = { en: { hint: 'Pick one or more, then send', team: 'Waiting for someone on the team to pick', sara: 'Waiting for Sara' }, ar: { hint: 'اختار واحدة أو أكتر وابعت', team: 'مستني حد من الفريق يختار', sara: 'مستني Sara' } };
const inChannel = (card: Card, language: 'en' | 'ar', props: Partial<ComponentProps<typeof ReplyCard>>) =>
 render(<LanguageProvider language={language}><div dir={language === 'ar' ? 'rtl' : 'ltr'}><ReplyCard card={card} fresh={false} team {...props}/></div></LanguageProvider>);
test.each([['en', false], ['ar', false], ['en', true], ['ar', true]] as const)('in the %s interface (main Agent: %s), a channel\'s several-pick question asks for picks alone, and sends them', async (language, chips) => {
 const card = asked(angles, { multiple: true });
 const answer = vi.fn(async () => null);
 const screen = await inChannel(card, language, { answer, chips });
 const group = screen.getByRole('group', { name: card.question });
 await expect.element(group.getByText(teamPicks[language].hint, { exact: true })).toBeVisible();
 await group.getByRole('button', { name: angles[2] }).click();
 await group.getByRole('button', { name: angles[0] }).click();
 await group.getByRole('button', { name: picks[language].send, exact: true }).click();
 expect(answer).toHaveBeenCalledExactlyOnceWith(42, [0, 2], expect.stringMatching(/^[0-9a-f-]{36}$/));
});
test.each([['en', null], ['ar', null], ['en', 'Sara'], ['ar', 'Sara']] as const)('in the %s interface, a channel\'s several-pick question for someone else (%s) shows its choices under the wait line', async (language, waitingFor) => {
 const card = asked(angles, { multiple: true });
 const screen = await inChannel(card, language, { chips: waitingFor !== null, waitingFor });
 const group = screen.getByRole('group', { name: card.question });
 await expect.element(group.getByText(waitingFor ? teamPicks[language].sara : teamPicks[language].team, { exact: true })).toBeVisible();
 expect([...group.element().querySelectorAll('.opt--static .opt__t')].map(row => row.textContent)).toEqual(angles);
 expect(group.element().querySelectorAll('button'), 'nothing to press').toHaveLength(0);
});

test('a refused send leaves the picks to send again, and says why', async () => {
 const card = asked(angles, { multiple: true });
 const answer = vi.fn(async () => 'questionTaken');
 const screen = await drawn(card, 'en', answer);
 const group = screen.getByRole('group', { name: card.question });
 await group.getByRole('button', { name: angles[0] }).click();
 await group.getByRole('button', { name: picks.en.send, exact: true }).click();
 await expect.element(group.getByRole('alert')).toBeVisible();
 await expect.element(group.getByRole('button', { name: angles[0] })).toHaveAttribute('aria-pressed', 'true');
 await expect.element(group.getByRole('button', { name: picks.en.send, exact: true })).toBeEnabled();
});

test.each(['en', 'ar'] as const)('in the %s interface, a several-pick question answered before the page was drawn shows its picks, each with its check', async language => {
 const picked = await drawn(asked(angles, { multiple: true, state: 'answered', answer: [angles[0], angles[3]] } as Partial<Question>), language);
 const rows = [...picked.getByRole('group', { name: `اختار زاوية الإعلان: ${words[language].answered}` }).element().querySelectorAll('.opt.is-chosen')];
 expect(rows.map(row => [row.querySelector('.opt__key')?.textContent, row.querySelector('.opt__t')?.textContent, !!row.querySelector('.opt__check')]))
  .toEqual([[words[language].letters[0], angles[0], true], [words[language].letters[3], angles[3], true]]);
});

test.each(['en', 'ar'] as const)('in the %s interface, a several-pick question answered in words before the page was drawn shows the typed words with no letter', async language => {
 const typed = await drawn(asked(angles, { multiple: true, state: 'answered', answer: 'Only the video, this week' } as Partial<Question>), language);
 const row = typed.getByRole('group', { name: `اختار زاوية الإعلان: ${words[language].answered}` }).element().querySelector('.opt.is-chosen');
 expect(row?.classList.contains('opt--typed')).toBe(true);
 expect(row?.querySelector('.opt__key')).toBeNull();
 expect(row?.querySelector('.opt__t')?.textContent).toBe('Only the video, this week');
});

// #143: the main Agent's question is the same Engine question drawn in the reference's chip form (ask1HTML): the
// question, one chip per choice and "or type the answer below"; no letters. Any other Agent's keeps the lettered card.
test.each([['en', 2], ['en', 4], ['ar', 2], ['ar', 4]] as const)('in the %s interface, the main Agent\'s open question with %i choices draws the chip card: the question, one chip per choice and the line to type', async (language, count) => {
 const card = asked(angles.slice(0, count));
 const screen = await drawn(card, language, async () => null, true);
 const group = screen.getByRole('group', { name: card.question });
 await expect.element(group).toBeVisible();
 expect(group.element().querySelector('.ask1__q')?.textContent).toBe(card.question);
 expect(group.element().querySelector('.ask1__or')?.textContent).toBe(words[language].orType);
 const chips = group.getByRole('button').elements();
 expect(chips.map(chip => chip.textContent)).toEqual(card.choices);
 expect(chips.every(chip => chip.classList.contains('chip'))).toBe(true);
 expect(group.element().querySelectorAll('.opt__key'), 'no letters on the main Agent\'s card').toHaveLength(0);
 expect(group.element().querySelector('.opt__check'), 'no check while it is open').toBeNull();
 for (const chip of chips) {
  await userEvent.keyboard('{Tab}');
  expect(document.activeElement, chip.textContent ?? '').toBe(chip);
 }
});

test.each(['en', 'ar'] as const)('in the %s interface, a chip closes the main Agent\'s card with that answer and a check, sending its card and key once', async language => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const card = asked(angles.slice(0, 3));
 const answer = vi.fn(async () => null);
 const screen = await drawn(card, language, answer, true);
 const group = screen.getByRole('group', { name: card.question });
 await group.getByRole('button', { name: angles[1] }).click();
 const resolved = screen.getByRole('group', { name: `${card.question}: ${words[language].answered}` });
 await expect.element(resolved).toBeVisible();
 expect(answer).toHaveBeenCalledExactlyOnceWith(42, 1, expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
 expect(resolved.getByRole('button').elements(), 'nothing left to click').toEqual([]);
 expect(resolved.element().querySelector('.ask1__q')?.textContent, 'the question stays').toBe(card.question);
 expect(resolved.element().querySelector('.card__outcome')?.textContent).toContain(angles[1]);
 const check = screen.getByTestId('icons').element().querySelector('svg')?.innerHTML;
 expect(resolved.element().querySelector('.card__outcome .gw-icon')?.innerHTML).toBe(check);
 expect(resolved.element().classList.contains('is-just'), 'it settles where it was answered').toBe(true);
 await vi.advanceTimersByTimeAsync(900);
 await expect.element(resolved).not.toHaveClass('is-just');
});

test.each(['en', 'ar'] as const)('in the %s interface, the main Agent\'s card answered before the page was drawn shows the answer with its check and offers nothing', async language => {
 const card = asked(angles.slice(0, 3), { state: 'answered', answer: angles[2] } as Partial<Question>);
 const screen = await drawn(card, language, undefined, true);
 const group = screen.getByRole('group', { name: `${card.question}: ${words[language].answered}` });
 await expect.element(group).toBeVisible();
 expect(group.getByRole('button').elements()).toEqual([]);
 expect(group.element().querySelector('.card__outcome')?.textContent).toContain(angles[2]);
 expect(group.element().classList.contains('is-just'), 'a card answered before the page was drawn does not settle').toBe(false);
});

test.each(['en', 'ar'] as const)('in the %s interface, a question the main Agent asked that the Engine no longer waits for says so in one line', async language => {
 const card = asked(angles.slice(0, 3), { state: 'closed' });
 const screen = await drawn(card, language, async () => null, true);
 const group = screen.getByRole('group', { name: card.question });
 await expect.element(group.getByText(words[language].closed, { exact: true })).toBeVisible();
 expect(group.getByRole('button').elements()).toEqual([]);
 expect(group.element().querySelector('.ask1__opts')).toBeNull();
});

test('the main Agent\'s question with no choice to pick is answered in words: no chips, and the hint says to write', async () => {
 for (const card of [asked([], { question: 'What should it do?' } as Partial<Question>)]) {
  const screen = await drawn(card, 'en', async () => null, true);
  const group = screen.getByRole('group', { name: card.question });
  await expect.element(group.getByText(words.en.inWords, { exact: true })).toBeVisible();
  expect(group.getByRole('button').elements()).toEqual([]);
  expect(group.element().querySelector('.ask1__opts')).toBeNull();
 }
});


// The chat: the Agent waits on its question, so it is not shown working; a pick posts the answer intent and the record is
// read again, which shows the card answered and the pick as the person's message after it.
const at = '2026-06-10T09:41:00Z';
const conversation = { id: '7d3f0b1e-1c2a-4b5d-8e6f-9a0b1c2d3e4f', agent_id: null, agent_name: 'Ads', face: 'c-1' };
const record = (card: Question, answer?: string, lead = false): ConversationRecord => ({
 conversation,
 messages: [
  { id: 1, author: 'person', author_name: 'Omar', body: 'محتاجين حملة Meta لكورس «المحاسب الشامل»', created_at: at },
  { id: 42, author: 'agent', author_name: 'Ads', body: '', created_at: at, kind: 'asked', cards: [{ kind: 'reply', card }] },
  ...answer ? [{ id: 42, author: 'person' as const, author_name: 'Omar', body: answer, created_at: at, kind: 'answer' as const }] : [],
 ],
 usage: { input: 0, output: 0 }, pending: true, ...answer ? {} : { asking: true as const }, failed: false, working: 'Omar', canStop: true,
 ...(lead ? { lead: true as const } : {}),
});

// The same question in the chat: the main Agent's Conversation draws the chip card, any other Agent's the lettered one.
test.each([[true, '.ask1__opts .chip', '.ask1__or'], [false, '.opt__key', '.qcard__hint']] as const)('in the chat, the main Agent\'s question draws the reference\'s chip card and any other Agent\'s the lettered card (main Agent: %s)', async (lead, selector, line) => {
 const open = asked(angles.slice(0, 3));
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(record(open, undefined, lead))));
 const screen = await render(<LanguageProvider language="en"><div className="gw"><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={conversation} title="" writer><Arrived record={arrived(record(open, undefined, lead))}/></ConversationView></div></LanguageProvider>);
 const group = screen.getByRole('group', { name: open.question });
 await expect.element(group).toBeVisible();
 expect(group.element().querySelectorAll(selector)).toHaveLength(3);
 expect(group.element().querySelector(line)).not.toBeNull();
 expect(group.element().querySelector(lead ? '.opt__key' : '.ask1__opts')).toBeNull();
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
 expect(document.querySelector('.composer__send.is-stop'), 'the empty box keeps its send arrow, with no stop square').toBeNull();

 // A DOM click: under fake timers Vitest moves the clock 50 ms for every 50 ms a locator action takes, so a slow click on a
 // busy runner fires the chat's first read of the record (500 ms) before the pick, and the card is answered under it.
 (screen.getByRole('button', { name: angles[0] }).element() as HTMLButtonElement).click();
 // Answered on this page, the card settles, its letter pops and its check draws (design-reference: .card.is-just).
 await expect.element(screen.getByRole('group', { name: `${open.question}: Answered` })).toBeInTheDocument();
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

test('in the chat, a pick another tab answered first is not shown as this one\'s: the card says so and the record is read again', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const open = asked(angles.slice(0, 3));
 const calls = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json({ error: 'questionTaken' }, { status: 409 })
  : Response.json(record({ ...open, state: 'answered', answer: angles[1] } as Question, angles[1])));
 vi.stubGlobal('fetch', calls);
 const screen = await render(<LanguageProvider language="en"><div className="gw"><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={conversation} title="" writer><Arrived record={arrived(record(open))}/></ConversationView></div></LanguageProvider>);
 // A DOM click, as above: the chat's first read of the record must not land before the pick.
 await expect.element(screen.getByRole('group', { name: open.question })).toBeVisible();
 (screen.getByRole('button', { name: angles[0] }).element() as HTMLButtonElement).click();
 await expect.element(screen.getByRole('alert')).toHaveTextContent('This question was already answered');
 await vi.advanceTimersByTimeAsync(500);
 expect(calls.mock.calls.filter(([, init]) => init?.method !== 'POST'), 'the record is read again').toHaveLength(1);
 await expect.poll(() => document.querySelector<HTMLElement>('.turns > li[data-kind="answer"]')?.textContent).toContain(angles[1]);
});

test.each([['en', 'Not delivered: the agent had stopped waiting for this answer. Send it again as a new message.'], ['ar', 'موصلتش: الوكيل كان بطّل يستنى الإجابة دي. ابعتها تاني في رسالة جديدة.']] as const)('in the %s interface, an answer the Engine no longer waited for is the person\'s turn with a note that it was not delivered', async (language, note) => {
 const closed = asked(angles.slice(0, 3), { state: 'closed' });
 const base = record(closed, angles[0]);
 const failed = { ...base, messages: base.messages.map(message => message.kind === 'answer' ? { ...message, failed: true } : message) };
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(failed)));
 await render(<LanguageProvider language={language}><div className="gw"><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={conversation} title="" writer><Arrived record={arrived(failed)}/></ConversationView></div></LanguageProvider>);
 const answer = document.querySelector<HTMLElement>('.turns > li[data-kind="answer"]')!;
 expect(answer.textContent).toContain(angles[0]);
 expect(answer.querySelector('[role="status"]')?.textContent, 'announced only when it changes, not again on every load').toBe(note);
 expect(answer.querySelector('[role="alert"]')).toBeNull();
});
