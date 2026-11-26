import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { OverlayChrome } from '@/app/settings-overlay-chrome';
import { BackLink, CloseButton, FocusReturn, OverlayFrame } from '@/app/settings-overlay-frame';
import AccountChoicesView from '@/app/account-choices-view';
import { AboutSection } from '@/app/settings-about';
import { whatsNew } from '@/lib/updates.mjs';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n, type Language } from '@/lib/i18n.mjs';
import { untilDrawn, fakeClock } from './fake-clock';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))}/> }));

const saveLanguage = vi.fn<(state: string, form: FormData) => Promise<string>>();
const saveTheme = vi.fn<(state: string, form: FormData) => Promise<string>>(async () => '');
afterEach(() => { vi.useRealTimers(); saveLanguage.mockReset(); saveTheme.mockClear(); push.mockReset(); sessionStorage.clear(); });

// The Owner's Settings open on Your account, as the server draws them.
const account = (language: Language, theme = 'light') => render(<LanguageProvider language={language}>
 <OverlayChrome t={i18n(language).t} slug="rs-learning" companyName="RS Learning" role="owner" readOnly={false} section="account" learningWaiting={0}>
  <AccountChoicesView theme={theme} saveTheme={saveTheme} saveLanguage={saveLanguage}/>
 </OverlayChrome>
</LanguageProvider>);

// What a finger can reach: the control's box, grown by an invisible ring untilDrawn around it.
const tapArea = (node: Element) => {
 const own = node.getBoundingClientRect(), ring = getComputedStyle(node, '::before');
 const top = parseFloat(ring.top) || 0, bottom = parseFloat(ring.bottom) || 0, left = parseFloat(ring.left) || 0, right = parseFloat(ring.right) || 0;
 return ring.content === 'none' ? [own.width, own.height] : [Math.max(own.width, own.width - left - right), Math.max(own.height, own.height - top - bottom)];
};

test('on a phone the sections become a row and every control has a 44px tap area', async () => {
 await page.viewport(390, 900);
 const screen = await account('en');
 const sections = screen.getByRole('navigation', { name: 'Settings sections' });
 await expect.element(sections).toBeVisible();
 expect(getComputedStyle(sections.element()).flexDirection).toBe('row');
 // The overlay is a fixed layer over the window: what could scroll sideways is the open section's own area.
 const open = document.getElementById('sov-main')!;
 expect(open.scrollWidth).toBe(open.clientWidth);
 const controls = [...sections.getByRole('link').elements(), screen.getByRole('button', { name: 'Close settings and go back' }).element(), ...screen.getByRole('radio').elements()];
 // Thirteen rows (#612, the Hermes row of #869), the close button and the five account choices (#616).
 expect(controls).toHaveLength(19);
 expect(controls.map(control => [control.textContent, ...tapArea(control)]).filter(([, width, height]) => Number(width) < 44 || Number(height) < 44)).toEqual([]);
});

test('while the chosen language is being saved the other choice waits, so the choice made is the one saved', async () => {
 let finish!: (failure: string) => void;
 saveLanguage.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
 const screen = await account('ar');
 const english = screen.getByRole('radio', { name: /^English/ }), arabic = screen.getByRole('radio', { name: /^العربية/ });
 await expect.element(arabic).toHaveAttribute('aria-checked', 'true');
 await english.click();
 await expect.element(arabic).toHaveAttribute('aria-disabled', 'true');
 (english.element() as HTMLElement).click();
 expect(saveLanguage.mock.calls.map(([, form]) => form.get('language'))).toEqual(['en']);
 finish('');
 await expect.element(english).not.toHaveAttribute('aria-disabled');
 await expect.element(arabic).not.toHaveAttribute('aria-disabled');
 expect(saveLanguage).toHaveBeenCalledOnce();
 await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
});

// #612: the sidebar's groups, each under its name, and the breadcrumb naming the open page's group and the page itself.
test('the sections sit in their groups, and the breadcrumb names the group and the open page, in English and Arabic', async () => {
 await page.viewport(1440, 900);
 const screen = await account('en');
 const sections = screen.getByRole('navigation', { name: 'Settings sections' });
 expect(sections.getByRole('group').elements().map(group => group.getAttribute('aria-labelledby') && document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent)).toEqual(['Company', 'Agents', 'Engine']);
 expect(sections.getByRole('group', { name: 'Engine' }).getByRole('link').elements().map(link => link.textContent)).toEqual(['Providers', 'Usage', 'Hermes']);
 expect(sections.getByRole('link').elements().slice(-3).map(link => link.textContent)).toEqual(['Backups', 'Your account', 'About']);
 const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('listitem');
 expect(crumbs.elements().map(crumb => crumb.textContent)).toEqual(['Settings', 'Your account']);
 await expect.element(crumbs.last()).toHaveAttribute('aria-current', 'page');
});

test('in Arabic the breadcrumb reads Settings, the group, then the page', async () => {
 await page.viewport(1440, 900);
 const arabic = render(<LanguageProvider language="ar">
  <OverlayChrome t={i18n('ar').t} slug="rs-learning" companyName="RS Learning" role="owner" readOnly={false} section="members" learningWaiting={0}><p>Members</p></OverlayChrome>
 </LanguageProvider>);
 const trail = (await arabic).getByRole('navigation', { name: 'مسار التنقل' }).getByRole('listitem');
 expect(trail.elements().map(crumb => crumb.textContent)).toEqual(['الإعدادات', 'الشركة', 'الأعضاء']);
});

test('on a wide screen Settings float over the page; on a phone they cover it', async () => {
 await page.viewport(1440, 900);
 const screen = await account('en');
 const dialog = screen.getByRole('dialog').element().getBoundingClientRect();
 expect(dialog.left).toBeGreaterThan(0); expect(dialog.top).toBeGreaterThan(0); expect(dialog.right).toBeLessThan(1440);
 await page.viewport(390, 900);
 await expect.poll(() => { const box = screen.getByRole('dialog').element().getBoundingClientRect(); return [box.left, box.top, box.width, box.height]; }).toEqual([0, 0, 390, 900]);
});

// An Agent's page as the server draws its focus targets: the Settings tab and "All agents".
const agentFrame = (key = 0) => <LanguageProvider key={key} language="en"><OverlayFrame slug="rs-learning" initialFocus="sov-tab-settings">
 <CloseButton/>
 <BackLink className="link-btn sov-back" id="sov-back" slug="rs-learning" agent="ag-2">All agents</BackLink>
 <div role="tablist"><button type="button" role="tab" id="sov-tab-settings" aria-selected="true">Settings</button></div>
</OverlayFrame></LanguageProvider>;
const agentPage = () => render(agentFrame());

test('an Agent\'s page opens with the focus on its Settings tab', async () => {
 const screen = await agentPage();
 await expect.element(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();
});

test('a row of the Agents list opens that Agent\'s page with the focus on its Settings tab, in the overlay already open', async () => {
 const list = <a href="#ag-2" id="sov-ag-ag-2">SEO</a>;
 const agent = <div role="tablist"><button type="button" role="tab" id="sov-tab-settings" aria-selected="true">Settings</button></div>;
 const screen = await render(<LanguageProvider language="en"><OverlayFrame slug="rs-learning">{list}</OverlayFrame></LanguageProvider>);
 const row = screen.getByRole('link', { name: 'SEO' });
 row.element().addEventListener('click', event => event.preventDefault());
 await row.click();
 await expect.element(row).toHaveFocus();
 await screen.rerender(<LanguageProvider language="en"><OverlayFrame slug="rs-learning" initialFocus="sov-tab-settings">{agent}</OverlayFrame></LanguageProvider>);
 await expect.element(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();
});

test('closing goes back to where the gear was pressed and leaves the gear its focus there, by the button and by Escape', async () => {
 const screen = await agentPage();
 for (const [index, close] of [() => screen.getByRole('button', { name: 'Close settings and go back' }).click(), () => userEvent.keyboard('{Escape}')].entries()) {
  // Each close is of an overlay opened afresh, as the gear opens it.
  push.mockReset();
  sessionStorage.setItem('gw-settings-from', JSON.stringify({ from: '/c/rs-learning/conversations/cv-1', focus: 'dp-settings' }));
  await screen.rerender(agentFrame(index + 1));
  await close();
  await expect.poll(() => push.mock.calls).toEqual([['/c/rs-learning/conversations/cv-1', { scroll: false }]]);
  expect(sessionStorage.getItem('gw-return-focus')).toBe('dp-settings');
  expect(sessionStorage.getItem('gw-settings-from')).toBeNull();
  sessionStorage.removeItem('gw-return-focus');
 }
});

// #130: the overlay leaves with the dialog's exit (design-reference: sovClose) and returns only once it has run.
test('closing keeps the overlay in the page with its exit running, then takes it out and goes back, once', async () => {
 const screen = await agentPage();
 // The leave is timed on a fake clock (#501), and pressed and keyed in the page so no driver round trip runs inside it.
 fakeClock();
 (screen.getByRole('button', { name: 'Close settings and go back' }).element() as HTMLButtonElement).click();
 await vi.advanceTimersByTimeAsync(0);
 const overlay = document.querySelector<HTMLElement>('.sov')!;
 expect(overlay).toHaveClass('is-closing');
 // A section link pressed during the leave cannot move the page the leave is about to leave.
 expect(overlay.inert).toBe(true);
 expect(getComputedStyle(overlay).animationName).toBe('gw-modal-out');
 // A second way out during the leave adds nothing.
 document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
 await vi.advanceTimersByTimeAsync(189);
 expect(overlay).toHaveClass('is-closing');
 expect(push).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);
 expect(push.mock.calls).toEqual([['/c/rs-learning/chat', { scroll: false }]]);
 // useLeave marks the overlay gone and navigates in one callback; React draws it gone on its next render.
 await untilDrawn(() => document.querySelector<HTMLElement>('.sov-root')?.hidden === true, 'the overlay gone');
 await vi.advanceTimersByTimeAsync(1000);
 expect(push).toHaveBeenCalledOnce();
});

test('the place it was opened from is used once: the next close with none stored goes to the chat and focuses nothing', async () => {
 sessionStorage.setItem('gw-settings-from', JSON.stringify({ from: '/c/rs-learning/conversations/cv-1', focus: 'dp-settings' }));
 const screen = await agentPage();
 await screen.getByRole('button', { name: 'Close settings and go back' }).click();
 await expect.poll(() => push.mock.calls.length).toBe(1);
 sessionStorage.removeItem('gw-return-focus');
 await screen.rerender(agentFrame(1));
 await screen.getByRole('button', { name: 'Close settings and go back' }).click();
 await expect.poll(() => push.mock.calls.length).toBe(2);
 expect(push).toHaveBeenLastCalledWith('/c/rs-learning/chat', { scroll: false });
 expect(sessionStorage.getItem('gw-return-focus')).toBeNull();
});

for (const [from, why] of [['/c/aleem/conversations/cv-9', 'another Company'], ['/c/rs-learning/settings?section=agents', 'the settings themselves']] as const) test(`closing to the chat instead of ${why} leaves no gear focus to take there`, async () => {
 sessionStorage.setItem('gw-settings-from', JSON.stringify({ from, focus: 'dp-settings' }));
 const screen = await agentPage();
 await screen.getByRole('button', { name: 'Close settings and go back' }).click();
 await expect.poll(() => push.mock.calls).toEqual([['/c/rs-learning/chat', { scroll: false }]]);
 expect(sessionStorage.getItem('gw-return-focus')).toBeNull();
});

test('an address stored before the focus was kept still closes to it, with no focus to return', async () => {
 sessionStorage.setItem('gw-settings-from', '/c/rs-learning/chat/ag-2');
 const screen = await agentPage();
 await screen.getByRole('button', { name: 'Close settings and go back' }).click();
 await expect.poll(() => push.mock.calls).toEqual([['/c/rs-learning/chat/ag-2', { scroll: false }]]);
 expect(sessionStorage.getItem('gw-return-focus')).toBeNull();
});

test('"All agents" goes to the Agents list, where that Agent\'s row takes the focus once', async () => {
 const screen = await agentPage();
 const link = screen.getByRole('link', { name: 'All agents', exact: true });
 await expect.element(link).toHaveAttribute('href', '/c/rs-learning/settings?section=agents');
 link.element().addEventListener('click', event => event.preventDefault());
 await link.click();
 expect(sessionStorage.getItem('gw-return-focus')).toBe('sov-ag-ag-2');
 const list = await render(<div><a href="#1" id="sov-ag-ag-1">Lead</a><a href="#2" id="sov-ag-ag-2">SEO</a><FocusReturn/></div>);
 await expect.element(list.getByRole('link', { name: 'SEO' })).toHaveFocus();
 expect(sessionStorage.getItem('gw-return-focus')).toBeNull();
 (document.activeElement as HTMLElement).blur();
 await list.rerender(<div><a href="#1" id="sov-ag-ag-1">Lead</a><a href="#2" id="sov-ag-ag-2">SEO</a><FocusReturn key="again"/></div>);
 await expect.element(list.getByRole('link', { name: 'SEO' })).not.toHaveFocus();
});

// #616: Appearance is Light, Dark or System, the saved choice checked as it is; System is saved as the account's
// "device", which follows the device's own light or dark setting.
test('Appearance offers Light, Dark and System, checks the saved one and saves the one chosen', async () => {
 const screen = await account('en', 'device');
 const group = screen.getByRole('radiogroup', { name: 'Appearance' });
 expect(group.getByRole('radio').elements().map(radio => radio.textContent)).toEqual(['Light', 'Dark', 'System']);
 await expect.element(group.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
 await expect.element(group.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'false');
 await group.getByRole('radio', { name: 'System' }).click();
 expect(saveTheme).not.toHaveBeenCalled();
 await group.getByRole('radio', { name: 'Dark' }).click();
 await expect.poll(() => saveTheme.mock.calls.map(([, form]) => form.get('theme'))).toEqual(['dark']);
 await screen.rerender(<LanguageProvider language="ar"><AccountChoicesView theme="light" saveTheme={saveTheme} saveLanguage={saveLanguage}/></LanguageProvider>);
 const arabic = screen.getByRole('radiogroup', { name: 'الشكل' });
 expect(arabic.getByRole('radio').elements().map(radio => radio.textContent)).toEqual(['فاتح', 'غامق', 'حسب الجهاز']);
 await expect.element(arabic.getByRole('radio', { name: 'فاتح' })).toHaveAttribute('aria-checked', 'true');
 await arabic.getByRole('radio', { name: 'حسب الجهاز' }).click();
 await expect.poll(() => saveTheme.mock.calls.map(([, form]) => form.get('theme'))).toEqual(['dark', 'device']);
});

test('the arrow keys move between the three Appearance choices in the reading direction', async () => {
 const screen = await account('en', 'light');
 const light = screen.getByRole('radio', { name: 'Light' });
 (light.element() as HTMLElement).focus();
 await userEvent.keyboard('{ArrowRight}');
 await expect.element(screen.getByRole('radio', { name: 'Dark' })).toHaveFocus();
 await userEvent.keyboard('{ArrowRight}');
 await expect.element(screen.getByRole('radio', { name: 'System' })).toHaveFocus();
 await userEvent.keyboard('{ArrowRight}');
 await expect.element(light).toHaveFocus();
});

// Two rendering updates: long enough for the browser to drop the focus from a button that can no longer take it.
const twoFrames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

// #720: a choice made from the keyboard keeps the focus while it is saved; the choices say they wait (aria-disabled) and a
// second choice is not sent, but the arrow keys still move between them.
test('a choice made with the keyboard keeps the focus while it is saved, and the other choices wait', async () => {
 let finish!: (failure: string) => void;
 saveTheme.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 const screen = await account('en', 'light');
 const dark = screen.getByRole('radio', { name: 'Dark' }), system = screen.getByRole('radio', { name: 'System' });
 (screen.getByRole('radio', { name: 'Light' }).element() as HTMLElement).focus();
 await userEvent.keyboard('{ArrowRight}');
 await expect.element(dark).toHaveFocus();
 await userEvent.keyboard('{Enter}');
 await expect.poll(() => saveTheme.mock.calls.map(([, form]) => form.get('theme'))).toEqual(['dark']);
 await twoFrames();
 await expect.element(dark).toHaveFocus();
 await expect.element(dark).toHaveAttribute('aria-disabled', 'true');
 await expect.element(screen.getByRole('radio', { name: /^English/ })).toHaveAttribute('aria-disabled', 'true');
 await userEvent.keyboard('{ArrowRight}');
 await expect.element(system).toHaveFocus();
 await userEvent.keyboard(' ');
 await twoFrames();
 expect(saveTheme).toHaveBeenCalledOnce();
 await expect.element(system).toHaveFocus();
 finish('');
 await expect.element(dark).not.toHaveAttribute('aria-disabled');
 await expect.element(system).toHaveFocus();
 expect(saveTheme).toHaveBeenCalledOnce();
});

// #616: About names the installed version, lists What's new from the shipped release notes in the interface language,
// newest first, and opens the licenses.
const about = (language: Language, version?: string) => render(<LanguageProvider language={language}>
 <OverlayChrome t={i18n(language).t} slug="rs-learning" companyName="RS Learning" role="viewer" readOnly section="about" learningWaiting={0}>
  <AboutSection t={i18n(language).t} language={language} locale={i18n(language).locale} version={version}/>
 </OverlayChrome>
</LanguageProvider>);

test('About shows the installed version, What\'s new from the release notes and the licenses, in English', async () => {
 const screen = await about('en', '0.4.2');
 await expect.element(screen.getByRole('heading', { name: 'About', exact: true, level: 3 })).toBeVisible();
 await expect.element(screen.getByRole('link', { name: 'About' })).toHaveAttribute('aria-current', 'page');
 await expect.element(screen.getByRole('region', { name: 'Version' })).toHaveTextContent('Versiongtmworksv0.4.2');
 const notes = screen.getByRole('region', { name: 'What’s new' });
 // Every shipped entry is in the page, the earlier ones closed until asked for.
 const items = [...notes.element().querySelectorAll('li')];
 expect(items).toHaveLength(whatsNew.length);
 expect(notes.getByRole('listitem').elements()).toHaveLength(5);
 expect(items[0].textContent).toContain(whatsNew[0].en.title);
 expect(items[0].textContent).toContain(whatsNew[0].en.body);
 expect(items.at(-1)!.textContent).toContain(whatsNew.at(-1)!.en.title);
 // The newest few are shown; the earlier ones open from one control and close again.
 const older = notes.getByText(`${whatsNew.length - 5} earlier changes`);
 await expect.element(notes.getByText(whatsNew[5].en.title)).not.toBeVisible();
 await older.click();
 await expect.element(notes.getByText(whatsNew[5].en.title)).toBeVisible();
 await older.click();
 await expect.element(notes.getByText(whatsNew[5].en.title)).not.toBeVisible();
 const licenses = screen.getByRole('region', { name: 'Licenses' });
 await expect.element(licenses.getByRole('link', { name: /^gtmworks MIT License/ })).toHaveAttribute('href', '/licenses/gtmworks');
 await expect.element(licenses.getByRole('link', { name: /^Third-party notices/ })).toHaveAttribute('href', '/licenses/third-party');
 for (const link of licenses.getByRole('link').elements()) expect(link.getAttribute('target')).toBe('_blank');
});

test('About in Arabic reads the Arabic release notes and names a main build and a source build', async () => {
 const screen = await about('ar', 'main');
 await expect.element(screen.getByRole('heading', { name: 'عن gtmworks', level: 3 })).toBeVisible();
 await expect.element(screen.getByRole('region', { name: 'الإصدار' })).toHaveTextContent('الإصدارgtmworksmain');
 const items = screen.getByRole('region', { name: 'الجديد' }).getByRole('listitem').elements();
 expect(items[0].textContent).toContain(whatsNew[0].ar.title);
 expect(items[0].textContent).not.toContain(whatsNew[0].en.title);
 await expect.element(screen.getByRole('region', { name: 'التراخيص' }).getByRole('link', { name: /^ملاحظات الأطراف التانية/ })).toBeVisible();
 await screen.rerender(<LanguageProvider language="en"><AboutSection t={i18n('en').t} language="en" locale="en-US"/></LanguageProvider>);
 await expect.element(screen.getByRole('region', { name: 'Version' })).toHaveTextContent('VersiongtmworksBuilt from source');
});
