import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { ReplyCard } from '@/app/reply-card';
import type { DecidePermission, PermissionOutcome } from '@/app/permission-card';
import { LanguageProvider } from '@/lib/i18n-client';
import { localeFor } from '@/lib/i18n.mjs';
import type { PermissionChoice, ReplyCard as Card } from '@/lib/conversations';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/conversations/cv-1', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
afterEach(() => { vi.useRealTimers(); });

// #163, design-reference: cardHTML's approval branch, OUTCOME and waitLineHTML, worded as the reference words them.
type Request = Extract<Card, { kind: 'permission' }>;
const request = (more: Partial<Request> = {}): Request => ({ id: 7, kind: 'permission', title: 'delete the old exports', description: 'delete the old exports', command: 'rm -r /srv/exports', choices: ['once', 'always', 'deny'], state: 'open', ...more } as Request);
const words = {
 en: { label: 'Approval request: delete the old exports', command: 'Command', deny: 'Don’t allow', always: 'Always allow', once: 'Allow once', wait: 'Waiting for someone on the team to approve', closed: 'Closed with no answer',
  outcome: { once: 'Allowed once', always: 'Always allowed', deny: 'Not allowed' }, refused: 'Your role cannot start or write in a conversation.' },
 ar: { label: 'طلب موافقة: delete the old exports', command: 'الأمر', deny: 'متسمحش', always: 'اسمح دايماً', once: 'اسمح مرة', wait: 'مستني موافقة حد من الفريق', closed: 'اتقفل من غير رد',
  outcome: { once: 'سمحت مرة واحدة', always: 'سمحت دايماً', deny: 'مسمحتش' }, refused: '' },
};
const everyone: PermissionChoice[] = ['once', 'always', 'deny'];
const drawn = (card: Card, language: 'en' | 'ar', decide?: DecidePermission, may: PermissionChoice[] = everyone) =>
 render(<LanguageProvider language={language}><div dir={language === 'ar' ? 'rtl' : 'ltr'}><ReplyCard card={card} fresh={false} decide={decide} may={may}/></div></LanguageProvider>);
const buttons = (group: { element: () => Element }) => [...group.element().querySelectorAll('button')].map(button => [button.textContent, button.className]);
const timeOf = (value: string, language: 'en' | 'ar') => new Date(value).toLocaleTimeString(localeFor(language), { hour: '2-digit', minute: '2-digit' });
// The outcome line: its words, then the time in its own element.
const outcomeOf = (group: { element: () => Element }) => group.element().querySelector('.card__outcome')?.textContent;

test.each(['en', 'ar'] as const)('in the %s interface, an open request shows the tile, the Engine\'s words as title and command row, and Don\'t allow, Always allow, Allow once in that order, the card in the interface\'s direction', async language => {
 const screen = await drawn(request(), language, async () => ({ state: 'closed', first: false }));
 const group = screen.getByRole('group', { name: words[language].label });
 await expect.element(group).toBeVisible();
 expect(group.element().matches(`:dir(${language === 'ar' ? 'rtl' : 'ltr'})`), 'the card follows the interface').toBe(true);
 expect(group.element().querySelector('.card__head .tool-tile.tool-tile--lg')?.textContent).toBe('·');
 await expect.element(group.getByText('delete the old exports', { exact: true })).toBeVisible();
 expect([...group.element().querySelectorAll('dt, dd')].map(text => text.textContent)).toEqual([words[language].command, 'rm -r /srv/exports']);
 expect(group.getByText('rm -r /srv/exports', { exact: true }).element().matches(':dir(ltr)'), 'the command keeps its own direction').toBe(true);
 expect(group.element().querySelector('dd')!.matches(`:dir(${language === 'ar' ? 'rtl' : 'ltr'})`), 'its row starts where the card does, as the reference\'s rows do').toBe(true);
 expect(buttons(group)).toEqual([[words[language].deny, 'btn btn--secondary'], [words[language].always, 'btn btn--secondary'], [words[language].once, 'btn btn--primary']]);
 expect(group.element().querySelector('.card__outcome'), 'no outcome while it waits').toBeNull();
});

test.each(['en', 'ar'] as const)('in the %s interface, a request the Engine will not keep for later has two buttons, and so does a Contributor\'s', async language => {
 const offered = await drawn(request({ choices: ['once', 'deny'] }), language, async () => ({ state: 'closed', first: false }));
 expect(buttons(offered.getByRole('group', { name: words[language].label })).map(([text]) => text)).toEqual([words[language].deny, words[language].once]);
 await offered.unmount();
 const contributor = await drawn(request(), language, async () => ({ state: 'closed', first: false }), ['once', 'deny']);
 expect(buttons(contributor.getByRole('group', { name: words[language].label })).map(([text]) => text)).toEqual([words[language].deny, words[language].once]);
});

test.each(['en', 'ar'] as const)('in the %s interface, a Viewer sees the wait line with its clock and no button', async language => {
 const closing: DecidePermission = async () => ({ state: 'closed', first: false });
 for (const [decide, may] of [[undefined, everyone], [closing, []]] as [DecidePermission | undefined, PermissionChoice[]][]) {
  const screen = await drawn(request(), language, decide, may);
  const group = screen.getByRole('group', { name: words[language].label });
  await expect.element(group.getByText(words[language].wait, { exact: true })).toBeVisible();
  expect(group.element().querySelectorAll('button').length).toBe(0);
  expect(group.element().querySelector('.card__outcome .gw-icon')).not.toBeNull();
  await screen.unmount();
 }
});

test.each([['en', 'once'], ['en', 'always'], ['en', 'deny'], ['ar', 'once'], ['ar', 'always'], ['ar', 'deny']] as const)('in the %s interface, %s is sent once, also on a double press, and the card then shows the outcome and its time and settles once', async (language, choice) => {
 const at = new Date().toISOString();
 let answer: (outcome: PermissionOutcome) => void = () => {};
 const decide = vi.fn<DecidePermission>(() => new Promise(resolve => { answer = resolve; }));
 const screen = await drawn(request(), language, decide);
 const group = screen.getByRole('group', { name: words[language].label });
 const button = group.getByRole('button', { name: words[language][choice] });
 await button.click(); await button.click();
 expect(decide.mock.calls).toEqual([[7, choice]]);
 answer({ state: 'decided', choice, at, first: true });
 await expect.poll(() => outcomeOf(group)).toBe(`${words[language].outcome[choice]} · ${timeOf(at, language)}`);
 expect(group.element().querySelectorAll('button').length, 'the buttons are gone').toBe(0);
 expect(group.element().classList.contains('is-just'), 'it settles on the page where it was decided').toBe(true);
 expect(group.element().classList.contains('is-resolved')).toBe(true);
 expect(group.element().querySelector('.card__outcome time')?.getAttribute('dateTime')).toBe(at);
 await expect.poll(() => group.element().classList.contains('is-just'), { timeout: 2000 }).toBe(false);
 expect(decide).toHaveBeenCalledTimes(1);
});

test.each(['en', 'ar'] as const)('in the %s interface, a press another tab was first to answers that first choice and does not settle', async language => {
 const at = new Date().toISOString();
 const screen = await drawn(request(), language, async () => ({ state: 'decided', choice: 'always', at, first: false }));
 const group = screen.getByRole('group', { name: words[language].label });
 await group.getByRole('button', { name: words[language].once }).click();
 await expect.poll(() => outcomeOf(group)).toBe(`${words[language].outcome.always} · ${timeOf(at, language)}`);
 expect(group.element().classList.contains('is-just')).toBe(false);
});

test.each([['en', 'once'], ['en', 'deny'], ['ar', 'always'], ['ar', 'deny']] as const)('in the %s interface, a request decided %s is drawn on load with its outcome, its icon and its time, and no button', async (language, choice) => {
 const at = new Date().toISOString();
 const screen = await drawn(request({ state: 'decided', choice, at } as Partial<Request>), language, async () => ({ state: 'closed', first: false }));
 const group = screen.getByRole('group', { name: words[language].label });
 await expect.poll(() => outcomeOf(group)).toBe(`${words[language].outcome[choice]} · ${timeOf(at, language)}`);
 expect(group.element().querySelectorAll('button').length).toBe(0);
 expect(group.element().classList.contains('is-just'), 'a card drawn on load does not settle').toBe(false);
 const icon = group.element().querySelector('.card__outcome .gw-icon path')?.getAttribute('d');
 expect(icon).toBe(choice === 'deny' ? 'M6 6l12 12M18 6L6 18' : 'M5 12.5l4.5 4.5L19 7.5');
});

test.each(['en', 'ar'] as const)('in the %s interface, a request the Engine stopped waiting for shows the closed line, and so does a press it answered closed', async language => {
 const closed = await drawn(request({ state: 'closed' }), language, async () => ({ state: 'closed', first: false }));
 const group = closed.getByRole('group', { name: words[language].label });
 await expect.element(group.getByText(words[language].closed, { exact: true })).toBeVisible();
 expect(group.element().querySelectorAll('button').length).toBe(0);
 await closed.unmount();
 const pressed = await drawn(request(), language, async () => ({ state: 'closed', first: true }));
 const open = pressed.getByRole('group', { name: words[language].label });
 await open.getByRole('button', { name: words[language].deny }).click();
 await expect.element(open.getByText(words[language].closed, { exact: true })).toBeVisible();
 expect(open.element().classList.contains('is-just'), 'nothing was decided, so nothing settles').toBe(false);
});

test('a refusal keeps the buttons, says why, and the next press is sent', async () => {
 const decide = vi.fn<DecidePermission>(async () => ({ error: 'conversationNotAllowed' }));
 const screen = await drawn(request(), 'en', decide);
 const group = screen.getByRole('group', { name: words.en.label });
 await group.getByRole('button', { name: words.en.once }).click();
 await expect.element(group.getByRole('alert')).toHaveTextContent(words.en.refused);
 await group.getByRole('button', { name: words.en.deny }).click();
 expect(decide.mock.calls).toEqual([[7, 'once'], [7, 'deny']]);
});

test('a request that arrives while the chat is open rises in, and one already there does not', async () => {
 const sheets = await Promise.all(['app/tokens.css', 'app/shell.css'].map(async file => (await import(/* @vite-ignore */ `/${file}?inline`)).default as string));
 const styles = sheets.map(css => Object.assign(document.createElement('style'), { textContent: css }));
 document.head.append(...styles);
 onTestFinished(() => styles.forEach(style => style.remove()));
 const screen = await render(<LanguageProvider language="en"><div dir="ltr" className="gw"><ReplyCard card={request()} fresh decide={async () => ({ state: 'closed', first: false })} may={everyone}/>
  <ReplyCard card={request({ id: 8, title: 'send the report' })} fresh={false} decide={async () => ({ state: 'closed', first: false })} may={everyone}/></div></LanguageProvider>);
 expect(getComputedStyle(screen.getByRole('group', { name: words.en.label }).element()).animationName).toBe('gw-rise');
 expect(getComputedStyle(screen.getByRole('group', { name: 'Approval request: send the report' }).element()).animationName).toBe('none');
});
