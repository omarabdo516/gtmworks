import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import type { ComponentProps, MouseEvent } from 'react';
import AccountMenuView, { ThemeToggleView } from '@/app/account-menu-view';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';

const saveLanguage = vi.hoisted(() => vi.fn<(state: string, form: FormData) => Promise<string>>());
const saveTheme = vi.fn<(state: string, form: FormData) => Promise<string>>();
vi.mock('next/navigation', () => ({ usePathname: () => '/c/rs-learning/chat', useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
// A link stays on the test page: following it is the app's router's work, not the menu's.
vi.mock('@/lib/link', () => ({
 default: ({ onClick, ...props }: ComponentProps<'a'>) => <a {...props} onClick={(event: MouseEvent<HTMLAnchorElement>) => { onClick?.(event); event.preventDefault(); }}/>,
 pageBeingOpened: () => null,
}));
// The menu's open state outlives a render, so a test that stops with it open closes it for the next one.
afterEach(async () => { if (document.querySelector('[role="menu"]')) await userEvent.keyboard('{Escape}'); document.querySelector<HTMLDialogElement>('dialog.team-dlg[open]')?.remove(); saveLanguage.mockReset(); saveTheme.mockReset(); vi.unstubAllGlobals(); });

const menu = (language: Language, overrides: Partial<ComponentProps<typeof AccountMenuView>> = {}) => render(<LanguageProvider language={language}>
 <AccountMenuView saveLanguage={saveLanguage} saveTheme={async () => ''} slug="rs-learning" personName="Omar" role="Owner" theme="light" companyName="RS Learning" settingsHref="/c/rs-learning/settings" {...overrides}/>
</LanguageProvider>);

// The Team dialog's data and saves, as the Shell hands them to the menu (#187). The account menu takes them as props,
// so this test renders it with no server action imported.
const teamData = {
 members: [
  { person_id: 'p-omar', role: 'owner', people: { name: 'Omar' } },
  { person_id: 'p-nour', role: 'contributor', people: { name: 'Nour' } },
 ],
 ended: [],
 links: [],
 agents: [
  { id: 'a-lead', connection_id: 'c-lead', name: 'Lead', is_default: true },
  { id: 'a-ads', connection_id: 'c-ads', name: 'Ads', is_default: false },
 ],
 allowed: [],
};
const soloData = { ...teamData, members: [teamData.members[0]] };
const teamActions = (data = teamData) => ({
 load: vi.fn(async () => data),
 save: vi.fn(async () => ''),
 makeLink: vi.fn(async () => ({ link: 'http://127.0.0.1:3000/join#code=' + 'a'.repeat(64) })),
 cancelLink: vi.fn(async () => ''),
});
const teamMenu = (language: Language, overrides: Partial<ComponentProps<typeof AccountMenuView>> = {}) => menu(language, {
 company: 'company-1', personId: 'p-omar', canManage: true, team: teamActions(), ...overrides,
});

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

// Connect apps opens the apps sheet (components/apps-sheet.test.tsx); drawn here with no sheet around it, it still closes the menu.
test('Connect apps can be chosen and closes the menu, and "More sections" reaches the sections the reference has no place for, closing the menu', async () => {
 const screen = await menu('en');
 await screen.getByRole('button', { name: 'Account menu' }).click();
 await expect.element(screen.getByRole('menuitem', { name: /^Connect apps/ })).not.toHaveAttribute('aria-disabled');
 await screen.getByRole('menuitem', { name: /^Connect apps/ }).click();
 await expect.element(screen.getByRole('menu')).not.toBeInTheDocument();
 await screen.getByRole('button', { name: 'Account menu' }).click();
 const more = screen.getByRole('group', { name: 'More sections' }).getByRole('menuitem');
 expect(more.elements().map(link => [link.textContent, link.getAttribute('href')])).toEqual([
  ['Home', 'home'], ['Projects', 'projects'], ['Skills', 'skills'], ['Approvals', 'approvals'], ['Usage', 'usage'],
  ['Members', 'settings/members'], ['Agents', 'agents'],
 ].map(([name, path]) => [name, `/c/rs-learning/${path}`]));
 await more.filter({ hasText: 'Members' }).click();
 await expect.element(screen.getByRole('menu')).not.toBeInTheDocument();
});

test('in the menu Arrow Down and Up move through the items and wrap, Home and End go to the ends, Tab closes it, and Escape closes it back to its button', async () => {
 const screen = await menu('en');
 const button = screen.getByRole('button', { name: 'Account menu' });
 await button.click();
 // The first item is Settings and the last the last of "More sections"; the focus starts on the chosen language.
 const item = (role: 'menuitem' | 'menuitemradio', name: string) => screen.getByRole(role, { name: new RegExp(`^${name}`) });
 await expect.element(item('menuitemradio', 'English')).toHaveFocus();
 for (const [key, role, name] of [['{ArrowDown}', 'menuitemradio', 'العربية'], ['{ArrowUp}', 'menuitemradio', 'English'], ['{Home}', 'menuitem', 'Settings'], ['{ArrowUp}', 'menuitem', 'Agents'], ['{ArrowDown}', 'menuitem', 'Settings'], ['{End}', 'menuitem', 'Agents']] as const) {
  await userEvent.keyboard(key);
  await expect.element(item(role, name)).toHaveFocus();
 }
 await userEvent.keyboard('{Tab}');
 await expect.element(screen.getByRole('menu')).not.toBeInTheDocument();
 await button.click();
 await expect.element(item('menuitemradio', 'English')).toHaveFocus();
 await userEvent.keyboard('{Escape}');
 await expect.element(screen.getByRole('menu')).not.toBeInTheDocument();
 await expect.element(button).toHaveFocus();
});

// #187: "Team" in the account menu, for the Owner and a Manager only, opening the Team dialog over the page.
const teamItem = (screen: Awaited<ReturnType<typeof menu>>) => screen.getByRole('menuitem', { name: /^Team/ });
const openTeam = async (screen: Awaited<ReturnType<typeof menu>>) => {
 await screen.getByRole('button', { name: 'Account menu' }).click();
 await teamItem(screen).click();
 await expect.element(screen.getByRole('dialog', { name: 'Team' })).toBeVisible();
};
const accountButton = (screen: Awaited<ReturnType<typeof menu>>) => screen.getByRole('button', { name: 'Account menu' });

for (const [role, canManage] of [['Owner', true], ['Manager', true], ['Contributor', false], ['Viewer', false]] as const) test(`a ${role} ${canManage ? 'has' : 'has no'} "Team" item in the account menu`, async () => {
 const screen = await menu('en', { role, canManage, company: 'company-1', personId: 'p-omar', team: canManage ? teamActions() : undefined });
 await screen.getByRole('button', { name: 'Account menu' }).click();
 if (!canManage) { await expect.element(teamItem(screen)).not.toBeInTheDocument(); return; }
 await expect.element(teamItem(screen)).toHaveTextContent('TeamWho works with which agents');
});

test('Team opens over the page with the menu closed and the focus on the first switch, and Done returns the focus to the account button', async () => {
 const actions = teamActions();
 const screen = await teamMenu('en', { team: actions });
 await openTeam(screen);
 expect(actions.load).toHaveBeenCalledWith('company-1');
 await expect.element(screen.getByRole('menu')).not.toBeInTheDocument();
 // The dialog's own explanation, and the table's Members with the Owner's row seeing every Agent.
 await expect.element(screen.getByText(/The company has one set of agents and one memory/)).toBeVisible();
 await expect.element(screen.getByRole('switch', { name: 'Nour · Ads' })).toBeVisible();
 await expect.element(screen.getByText('Administrators see every agent')).toBeVisible();
 await expect.poll(() => document.querySelector('.team-dlg .switch') === document.activeElement).toBe(true);
 await screen.getByRole('button', { name: 'Done' }).click();
 await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
 await expect.element(accountButton(screen)).toHaveFocus();
});

for (const [how, close] of [['the x', 'x'], ['Escape', 'escape'], ['a press outside it', 'outside']] as const) test(`${how} closes the Team dialog and gives the focus back to the account button`, async () => {
 const screen = await teamMenu('en');
 await openTeam(screen);
 if (close === 'x') await screen.getByRole('button', { name: 'Close' }).click();
 else if (close === 'escape') await userEvent.keyboard('{Escape}');
 // A press that starts and ends on the dialog's own surface, around its panel, as a pointer makes it.
 else { const dialog = document.querySelector<HTMLDialogElement>('dialog.team-dlg')!; for (const type of ['mousedown', 'mouseup', 'click']) dialog.dispatchEvent(new MouseEvent(type, { bubbles: true })); }
 await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
 await expect.element(accountButton(screen)).toHaveFocus();
});

test('in Arabic the item and the dialog are the reference’s words, and a Manager gets no Invite link button', async () => {
 const screen = await teamMenu('ar', { role: 'Manager' });
 await screen.getByRole('button', { name: 'قائمة الحساب' }).click();
 const arabicTeam = screen.getByRole('menuitem', { name: /^الفريق/ });
 await expect.element(arabicTeam).toHaveTextContent('الفريقمين بيشتغل مع أنهي وكلاء');
 await arabicTeam.click();
 await expect.element(screen.getByRole('dialog', { name: 'الفريق' })).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'خلصت' })).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'اعمل لينك دعوة' })).not.toBeInTheDocument();
 expect(document.getElementById('lnk-label')).toBeNull();
});

test('a Company worked alone opens the narrower dialog with the Owner’s row, the Invite link button and the note', async () => {
 const actions = teamActions(soloData);
 const screen = await teamMenu('en', { alone: true, owner: true, team: actions });
 await screen.getByRole('button', { name: 'Account menu' }).click();
 await expect.element(teamItem(screen)).toHaveTextContent('TeamJust you for now · invite a member');
 await teamItem(screen).click();
 const dialog = screen.getByRole('dialog', { name: 'Team' });
 await expect.element(dialog).toBeVisible();
 const box = document.querySelector<HTMLDialogElement>('dialog.team-dlg')!;
 expect(box.classList.contains('team-dlg--solo')).toBe(true);
 await expect.element(dialog.getByText(/It’s just you in this workspace for now/)).toBeVisible();
 await expect.element(dialog.getByText('Omar')).toBeVisible();
 await expect.element(dialog.getByText('(you)')).toBeVisible();
 await expect.element(dialog.getByText('Owner · You see every agent and approve everything')).toBeVisible();
 await expect.element(dialog.getByRole('button', { name: 'Make an invite link' })).toBeVisible();
 await expect.element(dialog.getByText('As soon as someone you invite joins, channels and per-member agents turn on by themselves.')).toBeVisible();
 await expect.poll(() => document.activeElement === document.getElementById('lnk-toggle')).toBe(true);
 await dialog.getByRole('button', { name: 'Make an invite link' }).click();
 await expect.poll(() => document.activeElement === document.getElementById('lnk-label')).toBe(true);
 await screen.getByRole('button', { name: 'Done' }).click();
 await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
 await expect.element(accountButton(screen)).toHaveFocus();
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

// #129: the menu rises once as it opens (design-reference: .menu, rise) and is gone at once when it closes; drawn again
// for the page it was kept open for, it has risen already.
// The shell's stylesheets for these tests alone, so the tests above keep drawing the menu unstyled.
const inShell = async (language: Language) => {
 const css = await Promise.all(['app/tokens.css', 'app/shell.css'].map(async file => (await import(/* @vite-ignore */ `/${file}?inline`)).default as string));
 const sheets = css.map(css => document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css })));
 onTestFinished(() => sheets.forEach(sheet => sheet.remove()));
 return render(<LanguageProvider language={language}><div className="gw"><div className="sb-foot">
  <AccountMenuView saveLanguage={saveLanguage} saveTheme={async () => ''} slug="rs-learning" personName="Omar" role="Owner" theme="light" companyName="RS Learning" settingsHref="/c/rs-learning/settings"/>
 </div></div></LanguageProvider>);
};
const animationOf = (element: Element | null) => {
 const { animationName, animationDuration, animationTimingFunction } = getComputedStyle(element!);
 return { animationName, animationDuration, animationTimingFunction };
};

test('opening the menu plays the shared rise over 120ms on ease-out, and Escape removes it with no leave', async () => {
 const screen = await inShell('en');
 const starts: string[] = [];
 const started = (event: AnimationEvent) => starts.push(event.animationName);
 document.addEventListener('animationstart', started, { capture: true });
 onTestFinished(() => document.removeEventListener('animationstart', started, { capture: true }));
 await screen.getByRole('button', { name: 'Account menu' }).click();
 await expect.element(screen.getByRole('menu')).toBeVisible();
 expect(animationOf(document.getElementById('me-menu'))).toEqual({ animationName: 'gw-rise', animationDuration: '0.12s', animationTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)' });
 await expect.poll(() => starts).toContain('gw-rise');
 await userEvent.keyboard('{Escape}');
 expect(document.getElementById('me-menu')).toBeNull();
});

test('a menu drawn again for the page it was kept open for does not rise a second time', async () => {
 const first = await inShell('en');
 await first.getByRole('button', { name: 'Account menu' }).click();
 await expect.element(first.getByRole('menu')).toBeVisible();
 await first.unmount();
 const again = await inShell('en');
 await expect.element(again.getByRole('menu')).toBeVisible();
 expect(animationOf(document.getElementById('me-menu')).animationName).toBe('none');
 await again.getByRole('button', { name: 'Account menu' }).click();
 await expect.element(again.getByRole('menu')).not.toBeInTheDocument();
 await again.getByRole('button', { name: 'Account menu' }).click();
 await expect.element(again.getByRole('menu')).toBeVisible();
 expect(animationOf(document.getElementById('me-menu')).animationName).toBe('gw-rise');
 await userEvent.keyboard('{Escape}');
 await expect.element(again.getByRole('menu')).not.toBeInTheDocument();
});
