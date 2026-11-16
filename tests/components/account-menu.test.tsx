import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import type { ComponentProps, MouseEvent } from 'react';
import AccountMenuView, { ThemeToggleView } from '@/app/account-menu-view';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';

const saveLanguage = vi.hoisted(() => vi.fn<(state: string, form: FormData) => Promise<string>>());
const saveTheme = vi.fn<(state: string, form: FormData) => Promise<string>>();
vi.mock('next/navigation', () => ({ usePathname: () => '/c/rs-learning/chat' }));
// A link stays on the test page: following it is the app's router's work, not the menu's.
vi.mock('@/lib/link', () => ({
 default: ({ onClick, ...props }: ComponentProps<'a'>) => <a {...props} onClick={(event: MouseEvent<HTMLAnchorElement>) => { onClick?.(event); event.preventDefault(); }}/>,
 pageBeingOpened: () => null,
}));
// The menu's open state outlives a render, so a test that stops with it open closes it for the next one.
afterEach(async () => { if (document.querySelector('[role="menu"]')) await userEvent.keyboard('{Escape}'); saveLanguage.mockReset(); saveTheme.mockReset(); vi.unstubAllGlobals(); });

const menu = (language: Language) => render(<LanguageProvider language={language}>
 <AccountMenuView saveLanguage={saveLanguage} saveTheme={async () => ''} slug="rs-learning" personName="Omar" role="Owner" theme="light" companyName="RS Learning" settingsHref="/c/rs-learning/settings"/>
</LanguageProvider>);

for (const [language, accountMenu, chosen, other, saved] of [['en', 'Account menu', 'English', 'العربية', 'ar'], ['ar', 'قائمة الحساب', 'العربية', 'English', 'en']] as const) test(`in ${chosen} the menu marks it chosen, and choosing ${other} saves it to the account and closes the menu`, async () => {
 saveLanguage.mockResolvedValue('');
 const screen = await menu(language);
 await screen.getByRole('button', { name: accountMenu }).click();
 const named = (name: string) => screen.getByRole('menuitemradio', { name: new RegExp(`^${name}`) });
 await expect.element(named(chosen)).toHaveAttribute('aria-checked', 'true');
 await expect.element(named(other)).toHaveAttribute('aria-checked', 'false');
 await named(other).click();
 await expect.poll(() => saveLanguage.mock.calls.map(([, form]) => form.get('language'))).toEqual([saved]);
 await expect.element(screen.getByRole('menu')).not.toBeInTheDocument();
});

test('Connect apps is drawn but not built yet, and "More sections" reaches the sections the reference has no place for, closing the menu', async () => {
 const screen = await menu('en');
 await screen.getByRole('button', { name: 'Account menu' }).click();
 await expect.element(screen.getByRole('menuitem', { name: /^Connect apps/ })).toHaveAttribute('aria-disabled', 'true');
 const more = screen.getByRole('group', { name: 'More sections' }).getByRole('menuitem');
 expect(more.elements().map(link => [link.textContent, link.getAttribute('href')])).toEqual([
  ['Home', 'home'], ['Projects', 'projects'], ['Skills', 'skills'], ['Approvals', 'approvals'], ['Usage', 'usage'],
  ['Members', 'settings/members'], ['Work settings', 'settings/work'], ['Agent keys', 'settings/agents'], ['Agents', 'agents'],
 ].map(([name, path]) => [name, `/c/rs-learning/${path}`]));
 await more.filter({ hasText: 'Members' }).click();
 await expect.element(screen.getByRole('menu')).not.toBeInTheDocument();
});

// The look the system asks for, as the browser reports it.
const system = (dark: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({ matches: dark && query === '(prefers-color-scheme: dark)', media: query, addEventListener() {}, removeEventListener() {} }));
const toggle = (theme: string) => <LanguageProvider language="en"><ThemeToggleView theme={theme} saveTheme={saveTheme}/></LanguageProvider>;

test('the sun/moon button shows the look shown now, Device following the system, and each press saves the other look', async () => {
 saveTheme.mockResolvedValue('');
 const saved = () => saveTheme.mock.calls.map(([, form]) => form.get('theme'));
 system(true);
 const screen = await render(toggle('device'));
 await expect.element(screen.getByRole('button', { name: 'Light mode' })).toHaveAttribute('aria-pressed', 'true');
 await screen.getByRole('button', { name: 'Light mode' }).click();
 await expect.poll(saved).toEqual(['light']);
 // The saved look comes back from the server as the account's theme.
 await screen.rerender(toggle('light'));
 await expect.element(screen.getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'false');
 await screen.getByRole('button', { name: 'Dark mode' }).click();
 await expect.poll(saved).toEqual(['light', 'dark']);
 await screen.rerender(toggle('dark'));
 await expect.element(screen.getByRole('button', { name: 'Light mode' })).toHaveAttribute('aria-pressed', 'true');
 system(false);
 await screen.rerender(toggle('device'));
 await expect.element(screen.getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'false');
});
