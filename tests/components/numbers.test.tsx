import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { cdp, page } from 'vitest/browser';
// Gives cdp() Playwright's session type (its send), as the config's provider does at run time.
import type {} from '@vitest/browser-playwright';
import type { ComponentProps } from 'react';
import { NoApp, NumbersFigures, NumbersHead, WaitingRow } from '@/app/c/[slug]/numbers/parts';
import { LogFilters } from '@/app/c/[slug]/log/log-client';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n, localeFor, type Language } from '@/lib/i18n.mjs';
import { numbersTiles, type AppReading, type Period } from '@/lib/numbers.mjs';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/log.css';
import '@/app/numbers.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
const reducedMotion = (on: boolean) => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
afterEach(async () => { document.documentElement.dir = ''; vi.restoreAllMocks(); await reducedMotion(false); });

// The Numbers page of a Company with no app connected, as the page draws it.
// With readings, the figures of the apps that report them; the figures are drawn again for each period, as the page's
// Suspense (keyed by the period) draws them.
const numbers = (period: Period, language: Language = 'en', readings: AppReading[] = []) => {
 const { t } = i18n(language);
 return <LanguageProvider language={language}><div className="gw"><main className="numbers-page"><div className="dash">
  <NumbersHead t={t} slug="rs-learning" period={period}/>
  <div className="dash__inner" key={period}>
   <NumbersFigures t={t} language={language} locale={localeFor(language)} period={period} {...numbersTiles(readings, period)}/>
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

for (const language of ['en', 'ar'] as const) test(`in ${language} an Agent waiting for the company's key gives the reason and opens "Waiting on you"`, async () => {
 const { t } = i18n(language);
 const item = { kind: 'agent_key', id: 3, title: 'Writer', body: '', asked_by: '', card_id: null, conversation_id: null, created_at: '2026-06-10T09:41:00Z' };
 const screen = await render(<LanguageProvider language={language}><div className="gw" dir={language === 'ar' ? 'rtl' : 'ltr'}><div className="panel-card">
  <WaitingRow t={t} slug="rs-learning" writer item={item} face={null}/>
 </div></div></LanguageProvider>);
 const row = screen.getByRole('link');
 await expect.element(row).toHaveAttribute('href', '/c/rs-learning/approvals');
 await expect.element(row.getByText('Writer', { exact: true })).toBeVisible();
 await expect.element(row.getByText(t('waitingAgentKeyReason'), { exact: true })).toBeVisible();
 await expect.element(row.getByText(t('numbersWaitingOnYou'), { exact: true })).toBeVisible();
});

// #165: a permission request on Numbers opens its chat at the card, the channel's in its channel, named by what it asks
// and its Agent.
for (const language of ['en', 'ar'] as const) test(`in ${language} a permission request on Numbers opens its chat at the card`, async () => {
 const { t } = i18n(language);
 const asked = { kind: 'permission', id: 51, title: 'delete the old exports', body: '', asked_by: 'Ads', card_id: 9, conversation_id: 'c-7', created_at: '2026-06-10T09:41:00Z' };
 const screen = await render(<LanguageProvider language={language}><div className="gw" dir={language === 'ar' ? 'rtl' : 'ltr'}><div className="panel-card">
  <WaitingRow t={t} slug="rs-learning" writer item={asked} face={null}/>
  <WaitingRow t={t} slug="rs-learning" writer item={{ ...asked, kind: 'channel_permission', id: 6, card_id: null, conversation_id: null, channel_id: 'ch-1' }} face={null}/>
 </div></div></LanguageProvider>);
 const [chat, channel] = screen.getByRole('link').elements();
 expect(chat.getAttribute('href')).toBe('/c/rs-learning/conversations/c-7#permission-51');
 expect(channel.getAttribute('href')).toBe('/c/rs-learning/channels/ch-1#permission-6');
 await expect.element(screen.getByRole('link').first().getByText('delete the old exports', { exact: true })).toBeVisible();
 await expect.element(screen.getByRole('link').first().getByText('Ads', { exact: true })).toBeVisible();
});

// #134: the figures count to their value (design-reference: countUp). The clock is the test's: performance.now() reads
// it and each animation frame runs when the test moves it, so a figure is read at exactly 0, 325 and 650ms.
const clock = () => {
 let now = 0, frames: FrameRequestCallback[] = [];
 vi.spyOn(performance, 'now').mockImplementation(() => now);
 vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
 vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
 return { to: (ms: number) => { now = ms; const due = frames; frames = []; for (const frame of due) frame(now); } };
};
const ads = (period: Period, leads: number): AppReading => ({ app: 'Meta Ads', period, spend: 12400, leads, currency: 'EGP' });
const figure = (name: string) => document.querySelector(`.kpi[data-figure="${name}"] .kpi__val`)!;
// What the eye reads, and what a screen reader is given (the figure's text without what is hidden from it).
// The eye skips what is not drawn: a part not displayed, or clipped away to a point as a screen reader's text is.
const drawnText = (node: Node): string => {
 if (!(node instanceof Element)) return node.textContent ?? '';
 const style = getComputedStyle(node);
 if (style.display === 'none' || style.clip === 'rect(0px, 0px, 0px, 0px)') return '';
 return [...node.childNodes].map(drawnText).join('');
};
const seen = (name: string) => drawnText(figure(name));
const heard = (name: string) => [...figure(name).childNodes].filter(node => !(node instanceof Element && node.getAttribute('aria-hidden') === 'true')).map(node => node.textContent).join('');

test('each figure with a value counts from 0 to it in 650ms on the reference\'s curve, and an unavailable one does not count', async () => {
 const time = clock();
 await render(numbers('7', 'en', [ads('7', 400)]));
 // Spend 12,400 EGP and 400 leads, so 31.0 a lead; no app reports revenue.
 expect([seen('spend'), seen('leads'), seen('costPerLead'), seen('revenue')]).toEqual(['EGP0', '0', 'EGP0.0', '—']);
 expect([heard('spend'), heard('leads'), heard('costPerLead')]).toEqual(['EGP12,400', '400', 'EGP31.0']);
 time.to(325);
 // Halfway through the time, 1 - 0.5^3 = 87.5% of the way.
 await expect.poll(() => [seen('spend'), seen('leads'), seen('costPerLead'), seen('revenue')]).toEqual(['EGP10,850', '350', 'EGP27.1', '—']);
 time.to(650);
 await expect.poll(() => [seen('spend'), seen('leads'), seen('costPerLead'), seen('revenue')]).toEqual(['EGP12,400', '400', 'EGP31.0', '—']);
 expect(figure('revenue').querySelector('.kpi__count')).toBeNull();
 expect([heard('spend'), heard('leads'), heard('costPerLead')]).toEqual(['EGP12,400', '400', 'EGP31.0']);
});

test('in Arabic the count is written in the reader\'s digits with the currency after it', async () => {
 const time = clock();
 document.documentElement.dir = 'rtl';
 await render(numbers('7', 'ar', [ads('7', 400)]));
 expect(heard('leads')).toBe(new Intl.NumberFormat(localeFor('ar')).format(400));
 time.to(325);
 await expect.poll(() => seen('leads')).toBe(new Intl.NumberFormat(localeFor('ar')).format(350));
 time.to(650);
 await expect.poll(() => seen('spend')).toBe(`${new Intl.NumberFormat(localeFor('ar')).format(12400)}EGP`);
});

test('a period change counts each figure from the value it showed to the new one, and a figure that did not change does not move', async () => {
 const time = clock();
 const screen = await render(numbers('7', 'en', [ads('7', 400)]));
 time.to(650);
 await expect.poll(() => seen('leads')).toBe('400');
 // The person picks the period (the page's link; the test stays on its page), and the page draws it.
 const stay = (event: Event) => event.preventDefault();
 document.addEventListener('click', stay, { once: true });
 await screen.getByRole('link', { name: 'Last 30 days' }).click();
 await screen.rerender(numbers('30', 'en', [ads('30', 1000)]));
 // Drawn at 650ms: 600 more leads, 87.5% of the way halfway through; the spend is the same in both periods, so it holds.
 expect([seen('leads'), seen('spend')]).toEqual(['400', 'EGP12,400']);
 time.to(975);
 await expect.poll(() => [seen('leads'), seen('spend')]).toEqual(['925', 'EGP12,400']);
 time.to(1300);
 await expect.poll(() => [seen('leads'), seen('costPerLead')]).toEqual(['1,000', 'EGP12.4']);
 // Opened again, the page counts from zero.
 await screen.rerender(<div key="opened-again">{numbers('30', 'en', [ads('30', 1000)])}</div>);
 expect(seen('leads')).toBe('0');
});

test('with reduced motion the figures are drawn at their value at once', async () => {
 await reducedMotion(true);
 const frame = vi.spyOn(window, 'requestAnimationFrame');
 await render(numbers('7', 'en', [ads('7', 400)]));
 await expect.poll(() => [seen('spend'), seen('leads'), seen('costPerLead'), seen('revenue')]).toEqual(['EGP12,400', '400', 'EGP31.0', '—']);
 expect([heard('spend'), heard('leads')]).toEqual(['EGP12,400', '400']);
 expect(frame).not.toHaveBeenCalled();
});
