import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import ConversationView from '@/app/c/[slug]/conversations/[id]/conversation';
import { ReplyCard } from '@/app/reply-card';
import { ShellIcon } from '@/components/shell-icon';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ConversationRecord } from '@/lib/conversation-record';
import type { ReplyCard as Card } from '@/lib/conversations';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

// #136: every word on a draft card is the Agent's, so the card is laid out in its title's direction and each text keeps
// its own, whichever the interface's.
const plan: Card = { id: 1, kind: 'draft', title: 'خطة الحملة', line: 'مسودة · Meta Ads', rows: [{ label: 'الهدف', value: 'ليدز على واتساب' }, { label: 'Budget', value: 'EGP 500 a day' }] };
const outline: Card = { id: 2, kind: 'draft', title: 'Article outline', line: 'Draft · the blog', rows: [{ label: 'Keyword', value: 'كورس محاسبة اونلاين' }] };
const drawn = (card: Card, language: 'en' | 'ar') => render(<LanguageProvider language={language}><div dir={language === 'ar' ? 'rtl' : 'ltr'}><ReplyCard card={card} fresh={false}/></div></LanguageProvider>);

test.each([
 ['Arabic', 'English', plan, 'en', [['خطة الحملة', 'rtl'], ['مسودة · Meta Ads', 'rtl'], ['الهدف', 'rtl'], ['ليدز على واتساب', 'rtl'], ['Budget', 'ltr'], ['EGP 500 a day', 'ltr']]],
 ['English', 'Arabic', outline, 'ar', [['Article outline', 'ltr'], ['Draft · the blog', 'ltr'], ['Keyword', 'ltr'], ['كورس محاسبة اونلاين', 'rtl']]],
] as const)('a draft written in %s, in the %s interface, is laid out in its own direction and shows its title, line and rows, each in its own direction', async (_, __, card, language, texts) => {
 const screen = await drawn(card, language);
 const group = screen.getByRole('group', { name: card.title });
 await expect.element(group).toBeVisible();
 expect(group.element().matches(`:dir(${language === 'ar' ? 'ltr' : 'rtl'})`), 'the card follows its title, not the interface').toBe(true);
 expect([...group.element().querySelectorAll('dt, dd')].map(text => text.textContent)).toEqual(card.rows.flatMap(row => [row.label, row.value]));
 for (const [text, direction] of texts) expect(group.getByText(text, { exact: true }).element().matches(`:dir(${direction})`), text).toBe(true);
});

// design-reference/index.html: Arabic content inside the English interface takes each line's direction from its own text
// and keeps the interface's left edge; a label stays in its column. In the Arabic interface nothing changes.
test.each([['en', 'left'], ['ar', 'start']] as const)('in the %s interface, the title, line and values align %s', async (language, align) => {
 const sheets = await Promise.all(['app/tokens.css', 'app/shell.css'].map(async file => (await import(/* @vite-ignore */ `/${file}?inline`)).default as string));
 const styles = sheets.map(css => Object.assign(document.createElement('style'), { textContent: css }));
 document.head.append(...styles);
 onTestFinished(() => styles.forEach(style => style.remove()));
 const screen = await render(<LanguageProvider language={language}><div dir={language === 'ar' ? 'rtl' : 'ltr'}><div className="gw"><ReplyCard card={plan} fresh={false}/></div></div></LanguageProvider>);
 const group = screen.getByRole('group', { name: plan.title });
 await expect.element(group).toBeVisible();
 const style = (text: string) => { const found = getComputedStyle(group.getByText(text, { exact: true }).element()); return [found.textAlign, found.unicodeBidi]; };
 for (const text of [plan.title, plan.line, plan.rows[0].value]) {
  expect(style(text)[0], text).toBe(align);
  if (language === 'en') expect(style(text)[1], text).toBe('plaintext');
 }
 expect(style(plan.rows[0].label)[0], 'a label keeps its column').toBe('start');
 if (language === 'en') {
  const title = group.getByText(plan.title, { exact: true }).element().getBoundingClientRect();
  expect(Math.round(title.left - group.element().getBoundingClientRect().left), 'the title starts at the card\'s left edge').toBe(16);
 }
});

// #137: a review shows one numbered row per reviewed text, the text in the reference's «» quotation marks, its verdict as a
// badge with its icon and word, and the Agent's note under it; the decision is the card's last row.
const review: Card = { id: 3, kind: 'review', title: 'مراجعة نصوص إعلانات ديسمبر', line: '2 نصوص · Meta Ads · قبل ما تطلع', items: [
 { text: 'من خريج تجارة لمحاسب شغال في 3 شهور', fine: true, note: 'الوعد واضح، ومعانا قصص طلبة تثبته.' },
 { text: 'أضمن طريق لأول وظيفة محاسبة', fine: false, note: '«أضمن» وعد مقدرش نثبته. البديل: «أقصر طريق لأول شغلانة محاسبة».' },
], decision: '1 جاهز، و1 رجع لـ Ads بالبديل' };

test.each([
 ['en', 'Review: مراجعة نصوص إعلانات ديسمبر', ['«من خريج تجارة لمحاسب شغال في 3 شهور»', '«أضمن طريق لأول وظيفة محاسبة»'], ['Fine', 'Needs an edit'], 'Decision'],
 ['ar', 'مراجعة: مراجعة نصوص إعلانات ديسمبر', ['«من خريج تجارة لمحاسب شغال في 3 شهور»', '«أضمن طريق لأول وظيفة محاسبة»'], ['تمام', 'يتعدّل'], 'القرار'],
] as const)('in the %s interface, a review is named %j and shows each text quoted in order with its badge and note, and the decision last', async (language, name, quotes, words, decision) => {
 const screen = await render(<LanguageProvider language={language}><div dir={language === 'ar' ? 'rtl' : 'ltr'}><ReplyCard card={review} fresh={false}/>
  <div data-testid="icons"><ShellIcon name="check"/><ShellIcon name="pencil"/></div></div></LanguageProvider>);
 const group = screen.getByRole('group', { name });
 await expect.element(group).toBeVisible();
 await expect.element(group.getByText(review.title, { exact: true })).toBeVisible();
 await expect.element(group.getByText(review.line, { exact: true })).toBeVisible();
 const [check, pencil] = [...screen.getByTestId('icons').element().querySelectorAll('svg')].map(icon => icon.innerHTML);
 const rows = [...group.element().querySelectorAll('ol > li')].map(row => ({
  n: row.querySelector('.rv-n')?.textContent, quote: row.querySelector('.rv-q')?.textContent,
  badge: row.querySelector('.rv-badge')?.textContent, icon: row.querySelector('.rv-badge svg')?.innerHTML, note: row.querySelector('p')?.textContent,
 }));
 expect(rows).toEqual([
  { n: '1', quote: quotes[0], badge: words[0], icon: check, note: review.items[0].note },
  { n: '2', quote: quotes[1], badge: words[1], icon: pencil, note: review.items[1].note },
 ]);
 expect(check).not.toBe(pencil);
 const last = group.element().lastElementChild;
 expect(last?.matches('.rv-decision'), 'the decision is the last row').toBe(true);
 expect([...(last?.children ?? [])].map(part => part.textContent)).toEqual([decision, review.decision]);
});

// design-reference: the review card sets its direction once, so a reviewed text that starts with a Latin word ("Excel …")
// stays in the Arabic card's lines, as do its note and the decision.
test.each(['en', 'ar'] as const)('in the %s interface, every text of an Arabic review follows the card\'s direction', async language => {
 const card: Card = { ...review, items: [{ text: 'Excel وOdoo والضرايب في كورس واحد بـ 2,400 ج', fine: true, note: 'Odoo: السعر مطابق لصفحة الكورس.' }], decision: 'OK كله جاهز' };
 const screen = await render(<LanguageProvider language={language}><div dir={language === 'ar' ? 'rtl' : 'ltr'}><ReplyCard card={card} fresh={false}/></div></LanguageProvider>);
 const group = screen.getByRole('group', { name: language === 'ar' ? `مراجعة: ${card.title}` : `Review: ${card.title}` });
 await expect.element(group).toBeVisible();
 for (const part of group.element().querySelectorAll('.rv-q, .rv-note, .rv-decision__t')) expect(part.matches(':dir(rtl)'), part.textContent ?? '').toBe(true);
});

const at = '2026-06-10T09:41:00Z';
const turns = (cards: Card[], pending: boolean): ConversationRecord => ({
 conversation: { id: 'cv-1', agent_name: 'Ads', face: 'c-1' },
 messages: cards.flatMap((card, index) => [
  { id: index * 2 + 1, author: 'person' as const, author_name: 'Omar', body: 'Prepare the draft', created_at: at },
  { id: index * 2 + 2, author: 'agent' as const, author_name: 'Ads', body: 'Here it is.', created_at: at, cards: [{ kind: 'reply' as const, card }] },
 ]).concat(pending ? [{ id: 9, author: 'person' as const, author_name: 'Omar', body: 'And the plan', created_at: at }] : []),
 usage: { input: 0, output: 0, unknown: 0 }, pending, failed: false, working: null, canStop: false,
});

test('a card that arrives while the Conversation is open rises in once; the cards it opened with do not', async () => {
 const sheets = await Promise.all(['app/tokens.css', 'app/shell.css'].map(async file => (await import(/* @vite-ignore */ `/${file}?inline`)).default as string));
 const styles = sheets.map(css => Object.assign(document.createElement('style'), { textContent: css }));
 document.head.append(...styles);
 onTestFinished(() => styles.forEach(style => style.remove()));
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const asks = vi.fn(async () => Response.json(turns([outline, plan], false)));
 vi.stubGlobal('fetch', asks);
 const screen = await render(<LanguageProvider language="en"><div className="gw"><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={{ id: 'cv-1', agent_name: 'Ads', face: 'c-1' }} initial={turns([outline], true)} writer={false} team={false}/></div></LanguageProvider>);
 const rising = (card: Card) => getComputedStyle(screen.getByRole('group', { name: card.title }).element()).animationName;
 await expect.element(screen.getByRole('group', { name: outline.title })).toBeVisible();
 expect(rising(outline)).toBe('none');

 await vi.advanceTimersByTimeAsync(500);
 expect(asks).toHaveBeenCalledTimes(1);
 await expect.element(screen.getByRole('group', { name: plan.title })).toBeVisible();
 expect([rising(outline), rising(plan)]).toEqual(['none', 'gw-rise']);
});
