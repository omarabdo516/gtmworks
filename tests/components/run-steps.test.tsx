import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { ConversationTurns } from '@/app/conversation-thread';
import { LanguageProvider } from '@/lib/i18n-client';
import type { ConversationRecord } from '@/lib/conversation-record';
import type { RunStep, RunSteps } from '@/lib/conversations';
import '@/app/tokens.css';
import '@/app/shell.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/conversations/cv-1', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
afterEach(() => { vi.useRealTimers(); });

// design-reference: threads['th-meta'] m3, its four steps in 41 seconds, the third one skipped; here each is a tool's name
// and the Engine's preview, and the skipped one a call the Engine reported failed.
const four: RunStep[] = [
 { tool: 'meta_ads', preview: 'campaign results August to October', state: 'done' },
 { tool: 'meta_ads', preview: 'saved audiences', state: 'done' },
 { tool: 'ga4', preview: null, state: 'failed' },
 { tool: 'sheets', preview: 'budget split over 30 days', state: 'done' },
];
const at = '2026-06-10T10:14:00Z';
const record = (steps?: RunSteps): ConversationRecord => ({
 conversation: { id: 'cv-1', agent_id: null, agent_name: 'Ads', face: 'c-1' },
 messages: [
  { id: 1, author: 'person', author_name: 'Omar', body: 'Plan the December campaign', created_at: at },
  { id: 2, author: 'agent', author_name: 'Ads', body: 'I read the last three campaigns.', created_at: at, ...(steps ? { steps } : {}) },
 ],
 usage: { input: 0, output: 0 }, pending: false, failed: false, working: null, canStop: false,
});
const drawn = (language: 'en' | 'ar', steps?: RunSteps) => render(<LanguageProvider language={language}><div dir={language === 'ar' ? 'rtl' : 'ltr'}><div className="gw"><div className="chat">
 <ConversationTurns slug="rs-learning" company="co-1" record={record(steps)} writer asked={() => {}}/></div></div></div></LanguageProvider>);
const listOf = (button: Element) => document.getElementById(button.getAttribute('aria-controls') ?? '')!;
const words = { en: { done: 'Done', skipped: 'Skipped' }, ar: { done: 'تم', skipped: 'اتخطى' } };

test.each([
 ['en', 1, 'Used 1 tool · 41 sec'], ['en', 2, 'Used 2 tools · 41 sec'], ['en', 4, 'Used 4 tools · 41 sec'],
 ['ar', 1, 'استخدم 1 أداة · 41 ثانية'], ['ar', 2, 'استخدم 2 أداة · 41 ثانية'], ['ar', 4, 'استخدم 4 أدوات · 41 ثانية'],
] as const)('in the %s interface, a reply with %i steps shows "%s" under the sender line, and pressing it opens and closes the list', async (language, count, line) => {
 const steps = four.slice(0, count);
 const screen = await drawn(language, { list: steps, seconds: 41 });
 const button = screen.getByRole('button', { name: line, exact: true });
 await expect.element(button).toBeVisible();
 const turn = button.element().closest('li')!;
 expect(button.element().closest('.steps')?.previousElementSibling?.className, 'right after the sender line').toBe('sender');
 expect(button.element().closest('.steps')?.nextElementSibling?.className, 'and before the bubble').toContain('bubble--agent');
 const list = listOf(button.element());
 expect(turn.contains(list)).toBe(true);
 await expect.element(button).toHaveAttribute('aria-expanded', 'false');
 expect(list.hidden).toBe(true);

 await button.click();
 await expect.element(button).toHaveAttribute('aria-expanded', 'true');
 expect(list.hidden).toBe(false);
 const lines = [...list.querySelectorAll('.step')];
 expect(lines.map(item => item.querySelector('.step__label')?.textContent)).toEqual(steps.map(step => step.preview ? `${step.tool} · ${step.preview}` : step.tool));
 expect(lines.map(item => item.querySelector('.step__state')?.textContent)).toEqual(steps.map(step => step.state === 'done' ? words[language].done : words[language].skipped));
 expect(document.activeElement).toBe(button.element());

 await button.click();
 await expect.element(button).toHaveAttribute('aria-expanded', 'false');
 expect(list.hidden).toBe(true);
});

test.each(['en', 'ar'] as const)('in the %s interface, a failed call is drawn as the reference\'s skipped step: a hollow dot and no check', async language => {
 const screen = await drawn(language, { list: four, seconds: 41 });
 await screen.getByRole('button').click();
 const skipped = screen.getByText(words[language].skipped, { exact: true });
 await expect.element(skipped).toBeVisible();
 const line = skipped.element().closest('.step')!;
 expect(line.classList.contains('step--skipped')).toBe(true);
 expect(line.querySelector('.step__ck')).toBeNull();
 expect(getComputedStyle(line.querySelector('.step__dot')!).backgroundColor).not.toBe(getComputedStyle(document.querySelector('.step--done .step__dot')!).backgroundColor);
 expect([...document.querySelectorAll('.step--done')].every(done => done.querySelector('.step__ck'))).toBe(true);
});

test('the list opens and closes by keyboard, Enter and Space alike, and the focus stays on the button', async () => {
 const screen = await drawn('en', { list: four, seconds: 41 });
 const button = screen.getByRole('button', { name: 'Used 4 tools · 41 sec' });
 await userEvent.keyboard('{Tab}');
 expect(document.activeElement).toBe(button.element());
 await userEvent.keyboard('{Enter}');
 await expect.element(button).toHaveAttribute('aria-expanded', 'true');
 expect(listOf(button.element()).hidden).toBe(false);
 await userEvent.keyboard(' ');
 await expect.element(button).toHaveAttribute('aria-expanded', 'false');
 expect(listOf(button.element()).hidden).toBe(true);
 await userEvent.keyboard(' ');
 await expect.element(button).toHaveAttribute('aria-expanded', 'true');
 expect(document.activeElement).toBe(button.element());
});

test.each<[string, RunSteps | undefined]>([['no steps', undefined], ['a Run that reported none', { list: [], seconds: 41 }]])('a reply with %s shows no button', async (_, steps) => {
 const screen = await drawn('en', steps);
 await expect.element(screen.getByText('I read the last three campaigns.')).toBeVisible();
 expect(screen.container.querySelector('.steps')).toBeNull();
 expect(screen.getByRole('button').elements()).toEqual([]);
});

test.each([
 ['en', 59, 'Used 4 tools · 59 sec'], ['en', 60, 'Used 4 tools · 1 min'], ['en', 135, 'Used 4 tools · 2 min 15 sec'], ['en', null, 'Used 4 tools'],
 ['ar', 59, 'استخدم 4 أدوات · 59 ثانية'], ['ar', 120, 'استخدم 4 أدوات · 2 دقيقة'], ['ar', 135, 'استخدم 4 أدوات · 2 دقيقة و15 ثانية'], ['ar', null, 'استخدم 4 أدوات'],
 ['ar', 5, 'استخدم 4 أدوات · 5 ثواني'], ['ar', 240, 'استخدم 4 أدوات · 4 دقايق'], ['ar', 663, 'استخدم 4 أدوات · 11 دقيقة و3 ثواني'],
] as const)('in the %s interface, a Run of %s seconds reads "%s"', async (language, seconds, line) => {
 const screen = await drawn(language, { list: four, seconds });
 await expect.element(screen.getByRole('button', { name: line, exact: true })).toBeVisible();
});

// Egyptian Arabic: the plural for three to ten, the singular from eleven on, as for one and two.
test.each([
 [3, 'استخدم 3 أدوات'], [10, 'استخدم 10 أدوات'], [11, 'استخدم 11 أداة'], [25, 'استخدم 25 أداة'], [100, 'استخدم 100 أداة'],
] as const)('in Arabic, a reply with %i steps reads "%s"', async (count, line) => {
 const list = Array.from({ length: count }, (_, index) => ({ tool: `tool_${index}`, preview: null, state: 'done' as const }));
 const screen = await drawn('ar', { list, seconds: null });
 await expect.element(screen.getByRole('button', { name: line, exact: true })).toBeVisible();
});

test('a step whose end the Engine never reported shows its line with no state', async () => {
 const screen = await drawn('en', { list: [{ tool: 'terminal', preview: null, state: 'started' }, four[0]], seconds: 41 });
 await screen.getByRole('button', { name: 'Used 2 tools · 41 sec' }).click();
 const lines = [...document.querySelectorAll('.step')];
 expect(lines.map(line => [line.querySelector('.step__label')?.textContent, line.querySelector('.step__state')?.textContent ?? null])).toEqual([['terminal', null], ['meta_ads · campaign results August to October', 'Done']]);
});

test('the steps rise and their checks draw only for the moment after the list opens', async () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 const screen = await drawn('en', { list: four, seconds: 41 });
 const button = screen.getByRole('button', { name: 'Used 4 tools · 41 sec' });
 await button.click();
 await expect.element(button).toHaveAttribute('aria-expanded', 'true');
 const list = listOf(button.element());
 expect(list.classList.contains('is-just')).toBe(true);
 expect([...list.querySelectorAll('.step')].map(line => (line as HTMLElement).style.getPropertyValue('--i'))).toEqual(['0', '1', '2', '3']);
 await vi.advanceTimersByTimeAsync(700);
 await expect.element(page.elementLocator(list)).not.toHaveClass('is-just');
 await button.click();
 await expect.element(button).toHaveAttribute('aria-expanded', 'false');
 await button.click();
 await expect.element(button).toHaveAttribute('aria-expanded', 'true');
 expect(list.classList.contains('is-just'), 'opened again').toBe(true);
});
