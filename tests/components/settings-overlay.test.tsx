import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { OverlayChrome } from '@/app/settings-overlay-chrome';
import AccountChoicesView from '@/app/account-choices-view';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n, type Language } from '@/lib/i18n.mjs';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))}/> }));

const saveLanguage = vi.fn<(state: string, form: FormData) => Promise<string>>();
afterEach(() => saveLanguage.mockReset());

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
