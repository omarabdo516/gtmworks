import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { OverlayChrome } from '@/app/settings-overlay-chrome';
import { BackLink, CloseButton, FocusReturn, OverlayFrame } from '@/app/settings-overlay-frame';
import AccountChoicesView from '@/app/account-choices-view';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n, type Language } from '@/lib/i18n.mjs';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))}/> }));

const saveLanguage = vi.fn<(state: string, form: FormData) => Promise<string>>();
afterEach(() => { saveLanguage.mockReset(); push.mockReset(); sessionStorage.clear(); });

// The Owner's Settings open on Your account, as the server draws them.
const account = (language: Language) => render(<LanguageProvider language={language}>
 <OverlayChrome t={i18n(language).t} slug="rs-learning" companyName="RS Learning" role="owner" readOnly={false} section="account" learningWaiting={0}>
  <AccountChoicesView theme="light" saveTheme={async () => ''} saveLanguage={saveLanguage}/>
 </OverlayChrome>
</LanguageProvider>);

// What a finger can reach: the control's box, grown by an invisible ring drawn around it.
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
 expect(controls).toHaveLength(15);
 expect(controls.map(control => [control.textContent, ...tapArea(control)]).filter(([, width, height]) => Number(width) < 44 || Number(height) < 44)).toEqual([]);
});

test('while the chosen language is being saved the other choice waits, so the choice made is the one saved', async () => {
 let finish!: (failure: string) => void;
 saveLanguage.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
 const screen = await account('ar');
 const english = screen.getByRole('radio', { name: /^English/ }), arabic = screen.getByRole('radio', { name: /^العربية/ });
 await expect.element(arabic).toHaveAttribute('aria-checked', 'true');
 await english.click();
 await expect.element(arabic).toBeDisabled();
 expect(saveLanguage.mock.calls.map(([, form]) => form.get('language'))).toEqual(['en']);
 finish('');
 await expect.element(english).toBeEnabled();
 await expect.element(arabic).toBeEnabled();
 expect(saveLanguage).toHaveBeenCalledOnce();
 await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
});

// An Agent's page as the server draws its focus targets: the Settings tab and "All agents".
const agentPage = () => render(<LanguageProvider language="en"><OverlayFrame slug="rs-learning" initialFocus="sov-tab-settings">
 <CloseButton slug="rs-learning"/>
 <BackLink className="link-btn sov-back" id="sov-back" slug="rs-learning" agent="ag-2">All agents</BackLink>
 <div role="tablist"><button type="button" role="tab" id="sov-tab-settings" aria-selected="true">Settings</button></div>
</OverlayFrame></LanguageProvider>);

test('an Agent\'s page opens with the focus on its Settings tab', async () => {
 const screen = await agentPage();
 await expect.element(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();
});

test('closing goes back to where the gear was pressed and leaves the gear its focus there, by the button and by Escape', async () => {
 sessionStorage.setItem('gw-settings-from', JSON.stringify({ from: '/c/rs-learning/conversations/cv-1', focus: 'dp-settings' }));
 const screen = await agentPage();
 await screen.getByRole('button', { name: 'Close settings and go back' }).click();
 expect(push).toHaveBeenLastCalledWith('/c/rs-learning/conversations/cv-1');
 expect(sessionStorage.getItem('gw-return-focus')).toBe('dp-settings');
 expect(sessionStorage.getItem('gw-settings-from')).toBeNull();
 sessionStorage.removeItem('gw-return-focus');
 sessionStorage.setItem('gw-settings-from', JSON.stringify({ from: '/c/rs-learning/conversations/cv-1', focus: 'dp-settings' }));
 await userEvent.keyboard('{Escape}');
 expect(push).toHaveBeenCalledTimes(2);
 expect(push).toHaveBeenLastCalledWith('/c/rs-learning/conversations/cv-1');
 expect(sessionStorage.getItem('gw-return-focus')).toBe('dp-settings');
});

test('the place it was opened from is used once: the next close with none stored goes to the chat and focuses nothing', async () => {
 sessionStorage.setItem('gw-settings-from', JSON.stringify({ from: '/c/rs-learning/conversations/cv-1', focus: 'dp-settings' }));
 const screen = await agentPage();
 const close = screen.getByRole('button', { name: 'Close settings and go back' });
 await close.click();
 sessionStorage.removeItem('gw-return-focus');
 await close.click();
 expect(push).toHaveBeenLastCalledWith('/c/rs-learning/chat');
 expect(sessionStorage.getItem('gw-return-focus')).toBeNull();
});

for (const [from, why] of [['/c/aleem/conversations/cv-9', 'another Company'], ['/c/rs-learning/settings?section=agents', 'the settings themselves']] as const) test(`closing to the chat instead of ${why} leaves no gear focus to take there`, async () => {
 sessionStorage.setItem('gw-settings-from', JSON.stringify({ from, focus: 'dp-settings' }));
 const screen = await agentPage();
 await screen.getByRole('button', { name: 'Close settings and go back' }).click();
 expect(push).toHaveBeenLastCalledWith('/c/rs-learning/chat');
 expect(sessionStorage.getItem('gw-return-focus')).toBeNull();
});

test('an address stored before the focus was kept still closes to it, with no focus to return', async () => {
 sessionStorage.setItem('gw-settings-from', '/c/rs-learning/chat/ag-2');
 const screen = await agentPage();
 await screen.getByRole('button', { name: 'Close settings and go back' }).click();
 expect(push).toHaveBeenLastCalledWith('/c/rs-learning/chat/ag-2');
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
