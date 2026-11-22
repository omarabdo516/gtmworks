import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { use, type ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import ConversationView, { ConversationLoaded } from '@/app/c/[slug]/conversations/[id]/conversation';
import { ReplyCard } from '@/app/reply-card';
import type { MarkHandDone } from '@/app/hand-card';
import { ShellIcon } from '@/components/shell-icon';
import { LanguageProvider } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import type { ConversationRecord } from '@/lib/conversation-record';
import type { ReplyCard as Card } from '@/lib/conversations';
// The loaded chat once its record is read, as the page streams it.
const Arrived = ({ record, team }: { record: Promise<ConversationRecord>, team: boolean }) => <ConversationLoaded initial={use(record)} team={team}/>;

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/conversations/cv-1', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
// The live steps' read (#646) is tests/components/live-steps.test.tsx's own: here it waits for ever, so it never takes an
// answer meant for the record.
const stubFetch = (fetch: (url: string, init?: RequestInit) => unknown) => vi.stubGlobal('fetch', (url: string, init?: RequestInit) => String(url).startsWith('/api/run-steps?') ? new Promise<Response>(() => {}) : fetch(url, init));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
// The record as the server hands it over once it is read: React's use() takes a promise it can see is settled at once.
const arrived = (record: ConversationRecord) => Object.assign(Promise.resolve(record), { status: 'fulfilled', value: record });

// #136: every word on a draft card is the Agent's, so the card is laid out once in its title's direction and every text on
// it follows the card, whichever the interface's.
const plan: Card = { id: 1, kind: 'draft', title: 'خطة الحملة', line: 'مسودة · Meta Ads', rows: [{ label: 'الهدف', value: 'ليدز على واتساب' }, { label: 'Budget', value: 'EGP 500 a day' }] };
const outline: Card = { id: 2, kind: 'draft', title: 'Article outline', line: 'Draft · the blog', rows: [{ label: 'Keyword', value: 'كورس محاسبة اونلاين' }] };
const drawn = (card: Card, language: 'en' | 'ar') => render(<LanguageProvider language={language}><div dir={language === 'ar' ? 'rtl' : 'ltr'}><ReplyCard card={card} fresh={false}/></div></LanguageProvider>);

test.each([
 ['Arabic', 'English', plan, 'en', 'rtl'],
 ['English', 'Arabic', outline, 'ar', 'ltr'],
] as const)('a draft written in %s, in the %s interface, is laid out in its title\'s direction and shows its title, line and rows, each following the card', async (_, __, card, language, direction) => {
 const screen = await drawn(card, language);
 const group = screen.getByRole('group', { name: card.title });
 await expect.element(group).toBeVisible();
 expect(group.element().matches(`:dir(${direction})`), 'the card follows its title, not the interface').toBe(true);
 expect([...group.element().querySelectorAll('dt, dd')].map(text => text.textContent)).toEqual(card.rows.flatMap(row => [row.label, row.value]));
 const texts = [group.element().querySelector('.card__title'), group.element().querySelector('.card__sub'), ...group.element().querySelectorAll('dt, dd')];
 for (const text of texts) expect(text?.matches(`:dir(${direction})`), text?.textContent ?? '').toBe(true);
});

// #307: the card sets its direction once, from its title, so its line and rows follow the card and an Arabic card whose
// line starts with a Latin name ("SEO سابه مسودة…") stays right to left in either interface.
test.each(['en', 'ar'] as const)('in the %s interface, the line and rows of an Arabic draft follow the card, also when they start with a Latin name', async language => {
 const card: Card = { id: 4, kind: 'draft', title: 'مسودة مقال «كورس محاسب شامل»', line: 'SEO سابه مسودة على WordPress، وانت اللي تدوس نشر.', rows: [{ label: 'SEO', value: 'Search Console هيتابع الترتيب' }, { label: 'المراجعة', value: 'Critic: مقبول بعد تعديل واحد' }] };
 const screen = await drawn(card, language);
 const group = screen.getByRole('group', { name: card.title });
 await expect.element(group).toBeVisible();
 expect(group.element().matches(':dir(rtl)'), 'the card follows its title, not the interface').toBe(true);
 const texts = [group.element().querySelector('.card__title'), group.element().querySelector('.card__sub'), ...group.element().querySelectorAll('dt, dd')];
 for (const text of texts) expect(text?.matches(':dir(rtl)'), text?.textContent ?? '').toBe(true);
});

// design-reference/index.html: Arabic content inside the English interface keeps the interface's left edge; a label stays
// in its column. Every text follows the card's direction (#307), so none takes its own. In the Arabic interface nothing changes.
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
  expect(style(text)[1], `${text} follows the card (#307)`).not.toBe('plaintext');
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
// stays in the Arabic card's lines, as do its line, note and decision.
test.each(['en', 'ar'] as const)('in the %s interface, every text of an Arabic review follows the card\'s direction', async language => {
 const card: Card = { ...review, line: 'Meta Ads · نصوص ديسمبر', items: [{ text: 'Excel وOdoo والضرايب في كورس واحد بـ 2,400 ج', fine: true, note: 'Odoo: السعر مطابق لصفحة الكورس.' }], decision: 'OK كله جاهز' };
 const screen = await render(<LanguageProvider language={language}><div dir={language === 'ar' ? 'rtl' : 'ltr'}><ReplyCard card={card} fresh={false}/></div></LanguageProvider>);
 const group = screen.getByRole('group', { name: language === 'ar' ? `مراجعة: ${card.title}` : `Review: ${card.title}` });
 await expect.element(group).toBeVisible();
 for (const part of group.element().querySelectorAll('.card__title, .card__sub, .rv-q, .rv-note, .rv-decision__t')) expect(part.matches(':dir(rtl)'), part.textContent ?? '').toBe(true);
});

const at = '2026-06-10T09:41:00Z';
const turns = (cards: Card[], pending: boolean): ConversationRecord => ({
 conversation: { id: 'cv-1', agent_id: null, agent_name: 'Ads', face: 'c-1' },
 messages: cards.flatMap((card, index) => [
  { id: index * 2 + 1, author: 'person' as const, author_name: 'Omar', body: 'Prepare the draft', created_at: at },
  { id: index * 2 + 2, author: 'agent' as const, author_name: 'Ads', body: 'Here it is.', created_at: at, cards: [{ kind: 'reply' as const, card }] },
 ]).concat(pending ? [{ id: 9, author: 'person' as const, author_name: 'Omar', body: 'And the plan', created_at: at }] : []),
 usage: { input: 0, output: 0 }, pending, failed: false, working: null, canStop: false,
});

test('a card that arrives while the Conversation is open rises in once; the cards it opened with do not', async () => {
 const sheets = await Promise.all(['app/tokens.css', 'app/shell.css'].map(async file => (await import(/* @vite-ignore */ `/${file}?inline`)).default as string));
 const styles = sheets.map(css => Object.assign(document.createElement('style'), { textContent: css }));
 document.head.append(...styles);
 onTestFinished(() => styles.forEach(style => style.remove()));
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const asks = vi.fn(async () => Response.json(turns([outline, plan], false)));
 stubFetch(asks);
 const screen = await render(<LanguageProvider language="en"><div className="gw"><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={{ id: 'cv-1', agent_id: null, agent_name: 'Ads', face: 'c-1' }} title="" writer={false}><Arrived record={arrived(turns([outline], true))} team={false}/></ConversationView></div></LanguageProvider>);
 const rising = (card: Card) => getComputedStyle(screen.getByRole('group', { name: card.title }).element()).animationName;
 await expect.element(screen.getByRole('group', { name: outline.title })).toBeVisible();
 expect(rising(outline)).toBe('none');

 await vi.advanceTimersByTimeAsync(500);
 expect(asks).toHaveBeenCalledTimes(1);
 await expect.element(screen.getByRole('group', { name: plan.title })).toBeVisible();
 expect([rising(outline), rising(plan)]).toEqual(['none', 'gw-rise']);
});

// #139: a step no Agent may do, handed to the person (design-reference: threads['th-team'] t10, cardHTML's hand branch).
type Hand = Extract<Card, { kind: 'hand' }>;
const article = 'https://rslearning.example/wp-admin/post.php?post=812&action=edit';
const handed = (more: Partial<Hand> = {}): Hand => ({ id: 7, kind: 'hand', title: 'انشر مقال «كورس محاسب شامل اونلاين»', line: 'SEO سابه مسودة على WordPress، وانت اللي تدوس نشر.', app: 'WordPress',
 rows: [{ label: 'الطول', value: '1,600 كلمة · 5 عناوين فرعية' }, { label: 'المراجعة', value: 'Critic: مقبول بعد تعديل واحد' }], url: article, note: 'SEO هيتابع ترتيبه في Search Console.', state: 'open', ...more } as Hand);
const handWords = {
 en: { badge: 'Handed to you', open: 'Open the draft', done: 'Done it', label: (title: string) => `Handed to you: ${title}`, at: (time: string) => `Done · ${time}.` },
 ar: { badge: 'اتسلّمتلك', open: 'افتح المسودة', done: 'عملتها', label: (title: string) => `اتسلّمتلك: ${title}`, at: (time: string) => `عملتها · ${time}.` },
};
const handDrawn = (card: Card, language: 'en' | 'ar', done?: MarkHandDone) =>
 render(<LanguageProvider language={language}><div dir={language === 'ar' ? 'rtl' : 'ltr'}><ReplyCard card={card} fresh={false} done={done}/>
  <div data-testid="icons"><ShellIcon name="hand"/><ShellIcon name="open"/><ShellIcon name="check"/></div></div></LanguageProvider>);
const doneToday = (() => { const day = new Date(); day.setHours(9, 41, 0, 0); return day.toISOString(); })();
const timeOf = (value: string, language: 'en' | 'ar') => new Date(value).toLocaleTimeString(localeFor(language), { hour: '2-digit', minute: '2-digit' });

test.each(['en', 'ar'] as const)('in the %s interface, an open hand card shows the badge, the app\'s tile, the title, the line, the rows, a link to the draft in a new tab and Done it', async language => {
 const card = handed();
 const screen = await handDrawn(card, language, async () => ({ at: '2026-06-10T09:41:00Z', first: true }));
 const group = screen.getByRole('group', { name: handWords[language].label(card.title) });
 await expect.element(group).toBeVisible();
 const [hand, open] = [...screen.getByTestId('icons').element().querySelectorAll('svg')].map(icon => icon.innerHTML);
 const badge = group.element().querySelector('.hcard__top .badge.ck-badge');
 expect([badge?.textContent, badge?.querySelector('svg')?.innerHTML]).toEqual([handWords[language].badge, hand]);
 expect(group.element().querySelector('.card__head .tool-tile.tool-tile--lg svg.tool-logo'), 'WordPress draws its logo').not.toBeNull();
 await expect.element(group.getByText(card.title, { exact: true })).toBeVisible();
 await expect.element(group.getByText(card.line, { exact: true })).toBeVisible();
 expect([...group.element().querySelectorAll('dt, dd')].map(text => text.textContent)).toEqual(card.rows.flatMap(row => [row.label, row.value]));
 const link = group.getByRole('link', { name: handWords[language].open });
 await expect.element(link).toHaveAttribute('href', article);
 await expect.element(link).toHaveAttribute('target', '_blank');
 expect(link.element().getAttribute('rel')?.split(' ').sort()).toEqual(['noopener', 'noreferrer']);
 expect(link.element().querySelector('svg')?.innerHTML).toBe(open);
 expect(group.getByRole('button').elements().map(button => button.textContent)).toEqual([handWords[language].done]);
 expect(group.element().matches(':dir(rtl)'), 'the card follows its title, not the interface or the badge').toBe(true);
 expect(group.element().classList.contains('is-resolved')).toBe(false);
 expect(group.element().textContent, 'the closing note waits for Done it').not.toContain(card.note);
});

test('in the Arabic interface, the line, the rows and the note of a hand card follow the card, also when they start with a Latin name', async () => {
 const language = 'ar';
 const card = handed({ state: 'done', at: '2026-06-10T09:41:00Z' } as Partial<Hand>);
 const screen = await handDrawn(card, language);
 const group = screen.getByRole('group', { name: handWords[language].label(card.title) }).element();
 const texts = [group.querySelector('.card__sub'), ...group.querySelectorAll('dt, dd'), group.querySelector('.hand__note')];
 expect(texts.map(text => text?.matches(':dir(rtl)'))).toEqual(texts.map(() => true));
});

test.each([['en', 'انشر المقال', 'ltr'], ['ar', 'Publish the article', 'rtl']] as const)('in the %s interface, "Done · time." keeps the interface\'s direction inside a card titled %s', async (language, title, direction) => {
 const card = handed({ title, state: 'done', at: doneToday } as Partial<Hand>);
 const screen = await handDrawn(card, language);
 const sentence = screen.getByRole('group', { name: handWords[language].label(title) }).element().querySelector('.hand__at');
 expect([sentence?.textContent, sentence?.matches(`:dir(${direction})`)]).toEqual([handWords[language].at(timeOf(doneToday, language)), true]);
});

test.each(['en', 'ar'] as const)('in the %s interface, a step done today shows its time, and one done another day its day', async language => {
 const today = new Date(); today.setHours(9, 41, 0, 0);
 const now = await handDrawn(handed({ state: 'done', at: today.toISOString() } as Partial<Hand>), language);
 expect(now.getByRole('group').element().querySelector('.hand__at')?.textContent).toBe(handWords[language].at(timeOf(today.toISOString(), language)));
 const before = await handDrawn(handed({ id: 9, state: 'done', at: '2025-06-10T09:41:00Z' } as Partial<Hand>), language);
 const day = new Intl.DateTimeFormat(localeFor(language), { day: 'numeric', month: language === 'ar' ? 'long' : 'short', year: 'numeric' }).format(new Date('2025-06-10T09:41:00Z'));
 expect(before.getByRole('group', { name: handWords[language].label(handed().title) }).elements().at(-1)?.querySelector('.hand__at')?.textContent).toBe(handWords[language].at(day));
});

test('in the chat, a person who may not write sees Done it but cannot press it', async () => {
 const conversation = { id: '7d3f0b1e-1c2a-4b5d-8e6f-9a0b1c2d3e4f', agent_id: null, agent_name: 'SEO', face: 'c-1' };
 const screen = await render(<LanguageProvider language="en"><div className="gw"><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={conversation} title="" writer={false}><Arrived record={arrived({ ...turns([handed()], false), conversation })} team={false}/></ConversationView></div></LanguageProvider>);
 await expect.element(screen.getByRole('button', { name: 'Done it' })).toBeDisabled();
});

test('a hand card with no address shows Done it alone, and an English one is laid out left to right', async () => {
 const card = handed({ title: 'Pay the December invoice', line: 'The invoice is ready in Stripe.', app: 'Stripe', url: null, rows: [] });
 const screen = await handDrawn(card, 'ar', async () => ({ at: '2026-06-10T09:41:00Z', first: true }));
 const group = screen.getByRole('group', { name: handWords.ar.label(card.title) });
 await expect.element(group).toBeVisible();
 expect(group.getByRole('link').elements()).toEqual([]);
 expect(group.getByRole('button').elements().map(button => button.textContent)).toEqual([handWords.ar.done]);
 expect(group.element().querySelector('dl'), 'no rows, no list').toBeNull();
 expect(group.element().matches(':dir(ltr)')).toBe(true);
});

test.each([['an app gtmworks does not know', 'Not An App', '·', false], ['a known app by its name in any case', 'google search console', '', true], ['a catalogue app, with its company\'s logo (#577)', 'Klaviyo', '', true]] as const)(
 'the tile of %s is drawn as the reference draws it', async (_, app, mark, logo) => {
  const screen = await handDrawn(handed({ app }), 'en', async () => ({ at: '2026-06-10T09:41:00Z', first: true }));
  const tile = screen.getByRole('group').element().querySelector('.card__head .tool-tile.tool-tile--lg');
  expect([tile?.textContent, !!tile?.querySelector('.tool-logo')]).toEqual([mark, logo]);
 });

test.each(['en', 'ar'] as const)('in the %s interface, a done hand card shows Done with its time and the note, and nothing to press', async language => {
 const card = handed({ state: 'done', at: doneToday } as Partial<Hand>);
 const screen = await handDrawn(card, language);
 const group = screen.getByRole('group', { name: handWords[language].label(card.title) });
 await expect.element(group).toBeVisible();
 expect(group.element().classList.contains('is-resolved')).toBe(true);
 expect(group.element().classList.contains('is-just'), 'a card done before the page was drawn does not settle').toBe(false);
 const outcome = group.element().querySelector('.card__outcome');
 expect(outcome?.querySelector('svg')?.innerHTML).toBe(screen.getByTestId('icons').element().querySelectorAll('svg')[2].innerHTML);
 expect(outcome?.textContent).toBe(`${handWords[language].at(timeOf(doneToday, language))} ${card.note}`);
 expect(outcome?.querySelector('time')?.getAttribute('datetime')).toBe(doneToday);
 expect([...group.element().querySelectorAll('a, button')]).toEqual([]);
 const bare = await handDrawn(handed({ id: 8, title: 'Publish', state: 'done', at: doneToday, note: null } as Partial<Hand>), language);
 expect(bare.getByRole('group', { name: handWords[language].label('Publish') }).element().querySelector('.card__outcome')?.textContent).toBe(handWords[language].at(timeOf(doneToday, language)));
});

test.each(['en', 'ar'] as const)('in the %s interface, Done it calls done once with the card and waits for its answer before it reads done; it settles only when this press was the first, and a second click sends nothing', async language => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 let settle: (value: Awaited<ReturnType<MarkHandDone>>) => void = () => {};
 const done = vi.fn(() => new Promise<Awaited<ReturnType<MarkHandDone>>>(resolve => { settle = resolve; }));
 const card = handed();
 const screen = await handDrawn(card, language, done);
 const group = screen.getByRole('group', { name: handWords[language].label(card.title) });
 const button = group.getByRole('button', { name: handWords[language].done }).element() as HTMLButtonElement;
 button.click(); button.click();
 await expect.element(group.getByRole('button', { name: handWords[language].done })).toBeDisabled();
 expect(done).toHaveBeenCalledExactlyOnceWith(7);
 expect(group.element().classList.contains('is-resolved'), 'nothing reads done before the database says so').toBe(false);
 settle({ at: '2026-06-10T09:42:00Z', first: true });
 await expect.element(group).toHaveClass('is-resolved');
 expect(group.element().querySelector('time')?.getAttribute('datetime')).toBe('2026-06-10T09:42:00Z');
 expect(group.element().querySelectorAll('a, button')).toHaveLength(0);
 expect(group.element().querySelector('.card__outcome')?.textContent).toContain(card.note);
 expect(group.element().classList.contains('is-just'), 'it settles where it was pressed').toBe(true);
 await vi.advanceTimersByTimeAsync(900);
 await expect.element(group).not.toHaveClass('is-just');
 expect(done).toHaveBeenCalledTimes(1);
});

test('a Done it that another tab pressed first reads done with that first time and does not settle here', async () => {
 const screen = await handDrawn(handed(), 'en', async () => ({ at: '2026-06-10T09:40:00Z', first: false }));
 const group = screen.getByRole('group', { name: handWords.en.label(handed().title) });
 await screen.getByRole('button', { name: 'Done it' }).click();
 await expect.element(group).toHaveClass('is-resolved');
 expect([group.element().querySelector('time')?.getAttribute('datetime'), group.element().classList.contains('is-just')]).toEqual(['2026-06-10T09:40:00Z', false]);
});

test('a Done it the server refuses gives the button back with the refusal, and a press then sends again', async () => {
 const done = vi.fn().mockResolvedValueOnce({ error: 'conversationFailed' }).mockResolvedValueOnce({ at: '2026-06-10T09:41:00Z', first: true });
 const card = handed();
 const screen = await handDrawn(card, 'en', done);
 await screen.getByRole('button', { name: 'Done it' }).click();
 await expect.element(screen.getByRole('alert')).toHaveTextContent('Could not mark it done. Try again.');
 expect(document.querySelector('.is-resolved, .is-just'), 'a refused press never reads done').toBeNull();
 const group = screen.getByRole('group', { name: handWords.en.label(card.title) });
 expect(group.element().classList.contains('is-resolved')).toBe(false);
 await screen.getByRole('button', { name: 'Done it' }).click();
 await expect.element(group).toHaveClass('is-resolved');
 expect(done).toHaveBeenCalledTimes(2);
 expect(screen.getByRole('alert').elements()).toEqual([]);
});

// #140: the press starts the Agent's turn, so the record is read again as after an answer: the Agent is shown working
// at once, and its reply comes under the card with no message of the person's for the press.
const chatStyles = async () => {
 const sheets = await Promise.all(['app/tokens.css', 'app/shell.css'].map(async file => (await import(/* @vite-ignore */ `/${file}?inline`)).default as string));
 const styles = sheets.map(css => Object.assign(document.createElement('style'), { textContent: css }));
 document.head.append(...styles);
 onTestFinished(() => styles.forEach(style => style.remove()));
};
test('in the chat, Done it posts the done intent with the card and shows the time it answers; the Agent is shown working and its reply comes under the card, with no message of the person\'s', async () => {
 await chatStyles();
 const open = handed();
 const conversation = { id: '7d3f0b1e-1c2a-4b5d-8e6f-9a0b1c2d3e4f', agent_id: null, agent_name: 'SEO', face: 'c-1' };
 const record = (card: Hand): ConversationRecord => ({ ...turns([card], false), conversation });
 const done = { ...open, state: 'done', at: '2026-06-10T09:42:00Z' } as Hand;
 const replied: ConversationRecord = { ...record(done), messages: [...record(done).messages, { id: 5, author: 'agent', author_name: 'SEO', body: 'I saw it on the site.', created_at: '2026-06-10T09:43:00Z' }] };
 let answer: (value: Response) => void = () => {};
 const calls = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json({ state: 'done', at: '2026-06-10T09:42:00Z', first: true })
  : new Promise<Response>(resolve => { answer = resolve; }));
 stubFetch(calls);
 const screen = await render(<LanguageProvider language="en"><div className="gw"><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={conversation} title="" writer><Arrived record={arrived(record(open))} team={false}/></ConversationView></div></LanguageProvider>);
 const group = screen.getByRole('group', { name: handWords.en.label(open.title) });
 await screen.getByRole('button', { name: 'Done it' }).click();
 await expect.poll(() => group.element().querySelector('time')?.getAttribute('datetime')).toBe('2026-06-10T09:42:00Z');
 // Done by this press, the card settles and its check draws (design-reference: .card.is-just).
 const motion = (part: Element) => { const style = getComputedStyle(part); return [style.animationName, style.animationDuration, style.animationDelay]; };
 expect([group.element(), group.element().querySelector('.card__outcome svg path')!].map(motion)).toEqual([['gw-settle', '0.32s', '0s'], ['gw-draw-check', '0.38s', '0.14s']]);
 const posted = calls.mock.calls.filter(([, init]) => init?.method === 'POST');
 expect(posted.map(([url, init]) => [url, JSON.parse(init!.body as string)])).toEqual([['/api/conversations', { company: 'co-1', conversation: conversation.id, intent: 'done', card: 7 }]]);
 await expect.element(screen.getByText('SEO is working on a reply…')).toBeVisible();
 await expect.poll(() => calls.mock.calls.filter(([, init]) => init?.method !== 'POST').length).toBe(1);
 answer(Response.json(replied));
 const reply = screen.getByText('I saw it on the site.');
 await expect.element(reply).toBeVisible();
 expect(group.element().compareDocumentPosition(reply.element()) & Node.DOCUMENT_POSITION_FOLLOWING, 'the reply comes after the card').toBeTruthy();
 expect([...document.querySelectorAll('[data-author="person"]')].map(turn => turn.textContent), 'the press adds no message of the person\'s').toEqual([expect.stringContaining('Prepare the draft')]);
 await expect.poll(() => document.querySelector('.convo-status')).toBeNull();
});

// #139's guard: a press another tab made first started nothing here, so the record is not read again, and a read can
// never replace a newer one (a message sent meanwhile).
test('in the chat, a Done it another tab pressed first reads done with that time, and the record is not read again', async () => {
 await chatStyles();
 const open = handed();
 const conversation = { id: '7d3f0b1e-1c2a-4b5d-8e6f-9a0b1c2d3e4f', agent_id: null, agent_name: 'SEO', face: 'c-1' };
 const calls = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json({ state: 'done', at: '2026-06-10T09:42:00Z', first: false })
  : Response.json({ ...turns([open], false), conversation }));
 stubFetch(calls);
 const screen = await render(<LanguageProvider language="en"><div className="gw"><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={conversation} title="" writer><Arrived record={arrived({ ...turns([open], false), conversation })} team={false}/></ConversationView></div></LanguageProvider>);
 const group = screen.getByRole('group', { name: handWords.en.label(open.title) });
 await screen.getByRole('button', { name: 'Done it' }).click();
 await expect.poll(() => group.element().querySelector('time')?.getAttribute('datetime')).toBe('2026-06-10T09:42:00Z');
 expect(calls.mock.calls.filter(([, init]) => init?.method !== 'POST'), 'no read can replace a newer record').toEqual([]);
 expect(document.querySelector('.convo-status'), 'nothing started here, so the record is not asked for and no one is shown working').toBeNull();
});

// #140: "Waiting on you" opens the Conversation at `#hand-<card>`: that card is in view and focused, not the newest message.
test('opened at a handed step\'s address, the chat shows that card in view and focused, not the newest message; the address is the chat\'s again, and the Agent\'s reply to Done it is followed', async () => {
 await chatStyles();
 const before = location.href;
 history.replaceState(null, '', '#hand-7');
 onTestFinished(() => history.replaceState(null, '', before));
 const many = turns([handed(), ...[11, 12, 13, 14, 15, 16].map(id => ({ ...plan, id }))], false);
 const replied: ConversationRecord = { ...many, messages: [...many.messages, { id: 90, author: 'agent', author_name: 'SEO', body: 'I saw it on the site.', created_at: '2026-06-10T09:43:00Z' }] };
 stubFetch(vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json({ state: 'done', at: '2026-06-10T09:42:00Z', first: true }) : Response.json(replied)));
 const screen = await render(<LanguageProvider language="en"><div className="gw" style={{ height: '600px' }}><ConversationView slug="rs-learning" agent={null} details={null} company="co-1" conversation={many.conversation} title="" writer><Arrived record={arrived(many)} team={false}/></ConversationView></div></LanguageProvider>);
 const card = screen.getByRole('group', { name: handWords.en.label(handed().title) });
 await expect.element(card).toBeVisible();
 const box = document.querySelector<HTMLElement>('.transcript')!;
 expect(box.scrollHeight, 'the chat is taller than its window').toBeGreaterThan(box.clientHeight + 200);
 expect(card.element().id).toBe('hand-7');
 expect(document.activeElement).toBe(card.element());
 const [shown, view] = [card.element().getBoundingClientRect(), box.getBoundingClientRect()];
 expect(shown.top >= view.top && shown.bottom <= view.bottom, 'the card is in view').toBe(true);
 expect(box.scrollTop + box.clientHeight, 'the chat is not at its newest message').toBeLessThan(box.scrollHeight - 50);
 expect(location.hash, 'a reload opens on the newest message').toBe('');
 await screen.getByRole('button', { name: 'Done it' }).click();
 await expect.element(screen.getByText('I saw it on the site.')).toBeVisible();
 await expect.poll(() => box.scrollHeight - box.scrollTop - box.clientHeight, { message: 'the reply is followed' }).toBeLessThan(2);
});

test.each([['en', '“Done it” didn’t reach the agent: the agent engine wouldn’t start it. Tell it in a message.'], ['ar', '«عملتها» موصلتش للوكيل: محرك الوكلاء مرضيش يبدأها. قولّه في رسالة.']] as const)('in the %s interface, a done card whose turn to the Agent could not start tells a person who may write so under its time, and a Viewer nothing', async (language, words) => {
 const screen = await handDrawn(handed({ state: 'done', at: doneToday, failed: true } as Partial<Hand>), language, async () => ({ error: 'conversationFailed' }));
 await expect.element(screen.getByRole('alert')).toBeVisible();
 expect(screen.getByRole('alert').element().textContent).toBe(words);
 const fine = await handDrawn(handed({ id: 8, state: 'done', at: doneToday } as Partial<Hand>), language, async () => ({ error: 'conversationFailed' }));
 expect(fine.container.querySelector('[role="alert"]')).toBeNull();
 const viewer = await handDrawn(handed({ id: 9, state: 'done', at: doneToday, failed: true } as Partial<Hand>), language);
 expect(viewer.container.querySelector('[role="alert"]'), 'a Viewer cannot write, so it is not told to').toBeNull();
});
