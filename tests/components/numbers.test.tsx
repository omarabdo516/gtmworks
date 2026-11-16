import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { NoApp, NumbersFigures, NumbersHead } from '@/app/c/[slug]/numbers/parts';
import { LogFilters } from '@/app/c/[slug]/log/log-client';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n, localeFor, type Language } from '@/lib/i18n.mjs';
import { numbersTiles, type Period } from '@/lib/numbers.mjs';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/log.css';
import '@/app/numbers.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
afterEach(() => { document.documentElement.dir = ''; });

// The Numbers page of a Company with no app connected, as the page draws it.
const numbers = (period: Period, language: Language = 'en') => {
 const { t } = i18n(language);
 return <LanguageProvider language={language}><div className="gw"><main className="numbers-page"><div className="dash">
  <NumbersHead t={t} slug="rs-learning" period={period}/>
  <div className="dash__inner">
   <NumbersFigures t={t} language={language} locale={localeFor(language)} period={period} {...numbersTiles([], period)}/>
   <div className="chart-empty"><NoApp t={t} slug="rs-learning"/></div>
  </div>
 </div></main></div></LanguageProvider>;
};
// What a finger can reach and what the eye sees: the control's box grown by an invisible ring, and its inner height.
const tapArea = (node: Element) => {
 const own = node.getBoundingClientRect(), ring = getComputedStyle(node, '::before');
 const grow = ring.content === 'none' ? 0 : -(parseFloat(ring.top) || 0) - (parseFloat(ring.bottom) || 0);
 return { reach: own.height + Math.max(0, grow), seen: node.clientHeight };
};

test('with no app connected the figures are unavailable, never a number, and the period switch keeps it so', async () => {
 const screen = await render(numbers('7'));
 await expect.element(screen.getByRole('heading', { level: 1, name: 'Numbers' })).toBeVisible();
 for (const label of ['Spend', 'Leads', 'Cost per lead', 'Revenue']) await expect.element(screen.getByText(label, { exact: true })).toBeVisible();
 expect(screen.getByLabelText('Unavailable').elements().map(value => value.textContent)).toEqual(['—', '—', '—', '—']);
 expect(screen.getByText('No connected app reports this').elements()).toHaveLength(4);
 await expect.element(screen.getByText('No app connected yet')).toBeVisible();
 await expect.element(screen.getByRole('link', { name: 'Connect an app' })).toHaveAttribute('href', '/c/rs-learning/connections');
 expect(document.querySelector('.dash__inner')!.textContent).not.toMatch(/\d/);
 const period = screen.getByRole('group', { name: 'Period' });
 await expect.element(period.getByRole('link', { name: 'Last 7 days' })).toHaveAttribute('aria-current', 'true');
 await expect.element(period.getByRole('link', { name: 'Last 30 days' })).toHaveAttribute('href', '/c/rs-learning/numbers?period=30');
 await screen.rerender(numbers('30'));
 await expect.element(period.getByRole('link', { name: 'Last 30 days' })).toHaveAttribute('aria-current', 'true');
 expect(screen.getByLabelText('Unavailable').elements()).toHaveLength(4);
 expect(document.querySelector('.dash__inner')!.textContent).not.toMatch(/\d/);
});

for (const [language, dir] of [['en', 'ltr'], ['ar', 'rtl']] as const) test(`on a phone in ${language} the period buttons keep the reference's 26px pills at the head's end, each with a 44px tap area`, async () => {
 await page.viewport(390, 900);
 document.documentElement.dir = dir;
 const screen = await render(numbers('7', language));
 const group = screen.getByRole('group', { name: i18n(language).t('numbersPeriod') });
 const links = group.getByRole('link').elements();
 expect(links).toHaveLength(2);
 for (const link of links) {
  const { reach, seen } = tapArea(link);
  expect(reach).toBeGreaterThanOrEqual(44);
  expect(seen).toBeLessThanOrEqual(26);
 }
 const box = group.element().getBoundingClientRect(), head = document.querySelector('.page-head')!.getBoundingClientRect();
 if (dir === 'rtl') expect(box.left).toBeLessThan(head.left + head.width / 2);
 else expect(box.right).toBeGreaterThan(head.left + head.width / 2);
});

test('on a phone the Activity log\'s filters keep the reference\'s 34px fields, each with a 44px tap area', async () => {
 await page.viewport(390, 900);
 const screen = await render(<LanguageProvider language="en"><div className="gw"><main className="log-page">
  <LogFilters slug="rs-learning" who="all" card="all" people={[]} agents={[]} cards={[]} count={0}/>
 </main></div></LanguageProvider>);
 const fields = screen.getByRole('group', { name: 'Log filters' }).getByRole('combobox').elements();
 expect(fields).toHaveLength(2);
 for (const field of fields) expect(tapArea(field)).toEqual({ reach: 44, seen: 34 });
});
