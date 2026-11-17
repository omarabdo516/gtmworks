import { expect, onTestFinished, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { ReplyCard } from '@/app/reply-card';
import type { ConnectApps } from '@/app/connect-card';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ReplyCard as Card } from '@/lib/conversations';

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/app/toast', () => ({ toast }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/conversations/cv-1', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));

// #203, design-reference: connectHTML in its four forms and waitLineHTML, worded as the reference words them.
type Connect = Extract<Card, { kind: 'connect' }>;
const reason = 'مش متوصل، فمقدرتش أعرف مين من الليدز اشترى فعلاً. لو وصّلته هقدر أحسب العائد بدقة.';
const card = (more: Partial<Connect> = {}): Connect => ({ id: 8, kind: 'connect', title: 'Amplitude', app: 'amplitude', reason, state: 'open', ...more } as Connect);
const words = {
 en: { label: 'Connect Amplitude', later: 'Later', connect: 'Connect', connecting: 'Connecting…', connected: 'Amplitude connected', postponedLabel: 'Amplitude postponed',
  postponed: 'Postponed · you can connect it from the details any time', by: 'Apps are connected by Omar and Sara', byOwner: 'Apps are connected by the Owner', failed: 'The sign-in didn’t finish. Try again.' },
 ar: { label: 'وصّل Amplitude', later: 'بعدين', connect: 'وصّل', connecting: 'بيتوصل…', connected: 'Amplitude اتوصل', postponedLabel: 'Amplitude اتأجل',
  postponed: 'اتأجل · تقدر توصّله من التفاصيل في أي وقت', by: 'ربط التطبيقات بيعمله Omar وSara', byOwner: 'ربط التطبيقات بيعمله المالك', failed: 'الدخول مكملش. جرّب تاني.' },
};
const owner = (more: Partial<ConnectApps> = {}): ConnectApps => ({ owner: true, owners: [], start: async () => ({ state: 'connected' }), later: async () => ({ state: 'postponed' }), ...more });
const drawn = (shown: Card, language: 'en' | 'ar', connect?: ConnectApps) =>
 render(<LanguageProvider language={language}><div dir={language === 'ar' ? 'rtl' : 'ltr'}><ReplyCard card={shown} fresh={false} connect={connect}/><textarea className="composer__input" aria-label="Message"/></div></LanguageProvider>);
const buttons = (group: { element: () => Element }) => [...group.element().querySelectorAll('button')].map(button => [button.textContent, button.className, button.disabled]);

test.each(['en', 'ar'] as const)('in the %s interface, the Owner sees the app\'s tile, "Connect {App}", the Agent\'s reason in its own direction, then Later and Connect', async language => {
 const screen = await drawn(card(), language, owner());
 const group = screen.getByRole('group', { name: words[language].label });
 await expect.element(group).toBeVisible();
 expect(group.element().matches(`:dir(${language === 'ar' ? 'rtl' : 'ltr'})`), 'the card follows the interface').toBe(true);
 expect(group.element().querySelector('.card__head .tool-tile.tool-tile--lg')).not.toBeNull();
 expect(group.element().querySelector('.card__title')?.textContent).toBe(words[language].label);
 expect(group.getByText(reason).element().matches(':dir(rtl)'), 'the reason keeps its own direction').toBe(true);
 expect(buttons(group)).toEqual([[words[language].later, 'btn btn--secondary', false], [words[language].connect, 'btn btn--primary', false]]);
 expect(group.element().querySelector('.card__outcome')).toBeNull();
});

test.each(['en', 'ar'] as const)('in the %s interface, Connect starts the sign-in once; both buttons are off and the second reads Connecting… while it is followed; then the card reads "{App} connected" with the toast', async language => {
 toast.mockClear();
 let finish: (outcome: { state: 'connected' }) => void = () => {};
 const start = vi.fn<ConnectApps['start']>(() => new Promise(resolve => { finish = resolve; }));
 const screen = await drawn(card(), language, owner({ start }));
 const group = screen.getByRole('group', { name: words[language].label });
 const connect = group.getByRole('button', { name: words[language].connect });
 const pressed = connect.element() as HTMLButtonElement;
 // The second press lands on the button the first one disabled.
 await connect.click(); pressed.click();
 await expect.poll(() => buttons(group)).toEqual([[words[language].later, 'btn btn--secondary', true], [words[language].connecting, 'btn btn--primary', true]]);
 expect(start.mock.calls.map(([app]) => app)).toEqual(['amplitude']);
 finish({ state: 'connected' });
 const done = screen.getByRole('group', { name: words[language].connected });
 await expect.element(done).toBeVisible();
 expect(done.element().classList.contains('is-resolved')).toBe(true);
 expect(done.element().querySelector('.card__outcome')?.textContent).toBe(words[language].connected);
 expect(done.element().querySelector('.card__outcome .gw-icon path')?.getAttribute('d')).toBe('M5 12.5l4.5 4.5L19 7.5');
 expect(done.element().querySelectorAll('button').length).toBe(0);
 expect(toast.mock.calls).toEqual([[words[language].connected]]);
});

test('a sign-in that does not finish brings the buttons back and says so, and the next press starts it again', async () => {
 const start = vi.fn<ConnectApps['start']>(async () => ({ error: 'connectFailed' }));
 const screen = await drawn(card(), 'en', owner({ start }));
 const group = screen.getByRole('group', { name: words.en.label });
 await group.getByRole('button', { name: words.en.connect }).click();
 await expect.element(group.getByRole('alert')).toHaveTextContent(words.en.failed);
 expect(buttons(group)).toEqual([[words.en.later, 'btn btn--secondary', false], [words.en.connect, 'btn btn--primary', false]]);
 await group.getByRole('button', { name: words.en.connect }).click();
 expect(start).toHaveBeenCalledTimes(2);
});

test.each(['en', 'ar'] as const)('in the %s interface, Later closes the card with its line and moves the focus to the message field', async language => {
 const later = vi.fn<ConnectApps['later']>(async () => ({ state: 'postponed' }));
 const screen = await drawn(card(), language, owner({ later }));
 await screen.getByRole('group', { name: words[language].label }).getByRole('button', { name: words[language].later }).click();
 const postponed = screen.getByRole('group', { name: words[language].postponedLabel });
 await expect.element(postponed).toBeVisible();
 expect(postponed.element().querySelector('.card__outcome')?.textContent).toBe(words[language].postponed);
 expect(postponed.element().querySelector('.card__outcome .gw-icon'), 'the postponed line has no icon, as the reference draws it').toBeNull();
 expect(postponed.element().querySelectorAll('button').length).toBe(0);
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
 expect(later.mock.calls).toEqual([[8]]);
});

test.each(['en', 'ar'] as const)('in the %s interface, a card drawn connected or postponed shows its line and no button', async language => {
 const connected = await drawn(card({ state: 'connected' }), language, owner());
 await expect.element(connected.getByRole('group', { name: words[language].connected })).toBeVisible();
 await connected.unmount();
 const postponed = await drawn(card({ state: 'postponed' }), language, owner({ owner: false, owners: ['Omar'] }));
 const group = postponed.getByRole('group', { name: words[language].postponedLabel });
 expect(group.element().querySelector('.card__outcome')?.textContent).toBe(words[language].postponed);
 expect(group.element().querySelectorAll('button').length).toBe(0);
});

test.each(['en', 'ar'] as const)('in the %s interface, a Manager or a Contributor sees the clock line naming the Owners, and no button', async language => {
 for (const [owners, line] of [[['Omar', 'Sara'], words[language].by], [[], words[language].byOwner]] as [string[], string][]) {
  const screen = await drawn(card(), language, owner({ owner: false, owners }));
  const group = screen.getByRole('group', { name: words[language].label });
  expect(group.element().querySelector('.card__outcome')?.textContent).toBe(line);
  expect(group.element().querySelector('.card__outcome .gw-icon')).not.toBeNull();
  expect(group.element().querySelectorAll('button').length).toBe(0);
  await screen.unmount();
 }
});

test('a connect card that arrives while the chat is open rises in, and one already there does not', async () => {
 const sheets = await Promise.all(['app/tokens.css', 'app/shell.css'].map(async file => (await import(/* @vite-ignore */ `/${file}?inline`)).default as string));
 const styles = sheets.map(css => Object.assign(document.createElement('style'), { textContent: css }));
 document.head.append(...styles);
 onTestFinished(() => styles.forEach(style => style.remove()));
 const screen = await render(<LanguageProvider language="en"><div dir="ltr" className="gw"><ReplyCard card={card()} fresh connect={owner()}/><ReplyCard card={card({ id: 9, title: 'Canva', app: 'canva' })} fresh={false} connect={owner()}/></div></LanguageProvider>);
 expect(getComputedStyle(screen.getByRole('group', { name: words.en.label }).element()).animationName).toBe('gw-rise');
 expect(getComputedStyle(screen.getByRole('group', { name: 'Connect Canva' }).element()).animationName).toBe('none');
});
