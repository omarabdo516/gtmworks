import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { OverlayChrome } from '@/app/settings-overlay-chrome';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n, type Language } from '@/lib/i18n.mjs';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

// Finding a setting by name (#613), in the overlay's own chrome as the server draws it.
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))}/> }));

// A section link pressed here stays on the test's page; the address it would open is kept.
const opened: string[] = [];
const keep = (event: MouseEvent) => { const link = (event.target as Element).closest('a'); if(link) { event.preventDefault(); opened.push(link.getAttribute('href')!); } };
beforeEach(() => document.addEventListener('click', keep));
afterEach(() => { document.removeEventListener('click', keep); opened.length = 0; push.mockReset(); });

const settings = (language: Language, role = 'owner') => render(<LanguageProvider language={language}>
 <OverlayChrome t={i18n(language).t} slug="rs-learning" companyName="RS Learning" role={role} readOnly={role !== 'owner'} section="account" learningWaiting={0}>
  <label>{language === 'ar' ? 'ملاحظة' : 'Note'}<input/></label>
 </OverlayChrome>
</LanguageProvider>);
const names = (screen: Awaited<ReturnType<typeof settings>>) => screen.getByRole('navigation').getByRole('link').elements().map(link => link.textContent);

test('/ outside a field finds a setting by name, Enter opens it, and clearing the search brings every section back', async () => {
 const screen = await settings('en');
 const find = screen.getByRole('searchbox', { name: 'Find a setting' });
 await expect.element(screen.getByRole('dialog')).toBeVisible();
 await userEvent.keyboard('/');
 await expect.element(find).toHaveFocus();
 await expect.element(find).toHaveValue('');
 await userEvent.keyboard('tasks');
 await expect.poll(() => names(screen)).toEqual(['Recurring tasks']);
 await userEvent.keyboard('{Enter}');
 expect(opened).toEqual(['/c/rs-learning/settings?section=routines']);
 await screen.getByRole('button', { name: 'Clear search' }).click();
 await expect.element(find).toHaveValue('');
 await expect.element(find).toHaveFocus();
 expect(names(screen)).toHaveLength(10);
});

test('a name nothing is called says so, offers to clear, and Escape clears the search without closing Settings', async () => {
 const screen = await settings('en');
 const find = screen.getByRole('searchbox', { name: 'Find a setting' });
 await find.fill('zzz');
 await expect.element(screen.getByText('No setting matches “zzz”.')).toBeVisible();
 expect(names(screen)).toEqual([]);
 await userEvent.keyboard('{Escape}');
 await expect.element(find).toHaveValue('');
 expect(names(screen)).toHaveLength(10);
 expect(push).not.toHaveBeenCalled();
 await expect.element(screen.getByRole('dialog')).toBeVisible();
});

test('in Arabic a Viewer finds their own sections by their Arabic names and never one the Role may not open', async () => {
 const screen = await settings('ar', 'viewer');
 const find = screen.getByRole('searchbox', { name: 'دوّر على إعداد' });
 await userEvent.keyboard('/');
 await expect.element(find).toHaveFocus();
 await userEvent.keyboard('حساب');
 await expect.poll(() => names(screen)).toEqual(['حسابك']);
 await find.fill('الاستهلاك');
 await expect.element(screen.getByText('مفيش إعداد فيه «الاستهلاك».')).toBeVisible();
 expect(names(screen)).toEqual([]);
 await find.fill('النسخ');
 expect(names(screen)).toEqual([]);
});

test('/ typed in a field of the page stays in that field', async () => {
 const screen = await settings('en');
 const note = screen.getByRole('textbox', { name: 'Note' });
 await note.click();
 await userEvent.keyboard('a/b');
 await expect.element(note).toHaveFocus();
 await expect.element(note).toHaveValue('a/b');
 await expect.element(screen.getByRole('searchbox', { name: 'Find a setting' })).toHaveValue('');
 expect(names(screen)).toHaveLength(10);
});

test('on a phone the search sits above the row of sections, its field a 44px tap area', async () => {
 await page.viewport(390, 900);
 const screen = await settings('ar');
 const find = screen.getByRole('searchbox', { name: 'دوّر على إعداد' }).element().closest('label')!.getBoundingClientRect();
 const first = screen.getByRole('navigation').getByRole('link').first().element().getBoundingClientRect();
 expect(find.height).toBeGreaterThanOrEqual(44);
 expect(find.bottom).toBeLessThanOrEqual(first.top);
 expect(document.getElementById('sov-main')!.scrollWidth).toBe(document.getElementById('sov-main')!.clientWidth);
});
