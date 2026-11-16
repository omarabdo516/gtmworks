import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import ConversationView from '@/app/c/[slug]/conversations/[id]/conversation';
import { ReplyCard } from '@/app/reply-card';
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
