import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { onTestFinished } from 'vitest';
import { CardDescription, type TickResult } from '@/app/card-description';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/card-window.css';

// #679: a Card's description read drawn, ticked while reading, counted (design-reference-card: deHTML, deReadHTML).
const tick = vi.fn<(line: number, item: string, done: boolean) => Promise<TickResult>>(async () => ({ ticked: true }));
afterEach(() => { tick.mockReset(); tick.mockImplementation(async () => ({ ticked: true })); });

async function show(body: string, { canTick = true, language = 'en' as Language } = {}) {
 const { lang, dir } = document.documentElement;
 Object.assign(document.documentElement, { lang: language, dir: language === 'ar' ? 'rtl' : 'ltr' });
 onTestFinished(() => { Object.assign(document.documentElement, { lang, dir }); });
 await page.viewport(900, 800);
 return render(<LanguageProvider language={language}><div className="gw"><section className="cw-desc-sec"><CardDescription body={body} slug="rs-learning" canTick={canTick} tick={tick}/></section></div></LanguageProvider>);
}

test('headings, lists, to-do items, quotes, links, tables, images and code are drawn', async () => {
 const screen = await show('# Brief\n\nSome **bold** and `code`.\n\n- one\n  - nested\n1. first\n\n> A quote\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n![Logo](/c/rs-learning/files/12)\n\n```\nnpm run\n```\n\n[Docs](https://example.com)\n\n---');
 await expect.element(screen.getByRole('heading', { name: 'Brief', level: 3 })).toBeVisible();
 expect(document.querySelector('.de strong')?.textContent).toBe('bold');
 expect(document.querySelector('.de .de-c')?.textContent).toBe('code');
 expect([...document.querySelectorAll('.de-b[data-t="ul"]')].map(b => b.getAttribute('data-l'))).toEqual(['0', '1']);
 expect(document.querySelector('.de-b[data-t="ol"] .de-num')?.textContent).toBe('1.');
 expect(document.querySelector('.de-b[data-q] .de-t')?.textContent).toBe('A quote');
 await expect.element(screen.getByRole('table')).toBeVisible();
 expect(document.querySelector('.de-img')?.getAttribute('src')).toBe('/c/rs-learning/files/12');
 expect(document.querySelector('.de-b[data-t="code"]')?.getAttribute('dir')).toBe('ltr');
 const link = screen.getByRole('link', { name: 'Docs' });
 await expect.element(link).toHaveAttribute('href', 'https://example.com/');
 await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
 expect(document.querySelector('.de-hr')).not.toBeNull();
});

test('HTML is drawn as its text, a link to anywhere unsafe is no link, and a picture from outside never loads', async () => {
 const screen = await show('<script>window.hit=1</script>\n\nHi <b onclick="x">there</b> [run](javascript:alert(1)) ![pixel](https://tracker.example/p.png)\n\n![other](/c/other/files/3)');
 expect(document.querySelector('.de script, .de b')).toBeNull();
 expect(document.querySelector('.de')?.textContent).toContain('<script>window.hit=1</script>');
 expect(document.querySelector('.de')?.textContent).toContain('<b onclick="x">there</b>');
 expect((window as unknown as { hit?: number }).hit).toBeUndefined();
 await expect.element(screen.getByText('run')).toBeVisible();
 expect(document.querySelectorAll('.de a')).toHaveLength(0);
 expect(document.querySelectorAll('.de img')).toHaveLength(0);
 await expect.element(screen.getByText('pixel')).toBeVisible();
 await expect.element(screen.getByText('other')).toBeVisible();
});

test('each line takes its own direction, with its tick box on its own start', async () => {
 const screen = await show('- [ ] اكتب الخطاف\n- [ ] Write the caption');
 const [arabic, english] = [...document.querySelectorAll<HTMLElement>('.de-b[data-t="todo"]')];
 expect([arabic.getAttribute('dir'), english.getAttribute('dir')]).toEqual(['auto', 'auto']);
 const side = (line: HTMLElement) => { const box = line.querySelector('.de-box')!.getBoundingClientRect(); const text = line.querySelector('.de-t')!.getBoundingClientRect(); return box.left < text.left ? 'left' : 'right'; };
 expect([side(arabic), side(english)]).toEqual(['right', 'left']);
 await expect.element(screen.getByRole('checkbox', { name: 'اكتب الخطاف' })).toBeVisible();
});

test('a to-do is ticked while reading with the mouse or the keyboard, by its line and text, and the count follows', async () => {
 const screen = await show('Intro\n\n- [ ] Write the hook\n- [x] Pick the format\n  - [ ] Nested step\n\nAfter');
 await expect.element(screen.getByText('1/3')).toBeVisible();
 const hook = screen.getByRole('checkbox', { name: 'Write the hook' });
 await expect.element(hook).toHaveAttribute('aria-checked', 'false');
 await hook.click();
 expect(tick).toHaveBeenLastCalledWith(3, 'Write the hook', true);
 await expect.element(hook).toHaveAttribute('aria-checked', 'true');
 const nested = screen.getByRole('checkbox', { name: 'Nested step' });
 (nested.element() as HTMLElement).focus();
 await userEvent.keyboard(' ');
 expect(tick).toHaveBeenLastCalledWith(5, 'Nested step', true);
 await expect.element(nested).toHaveAttribute('aria-checked', 'true');
 // The count is the description's as the board reads it next; the box shows the tick at once.
 expect(document.querySelectorAll('.de-prog')).toHaveLength(1);
});

test('a tick refused because the item changed is taken back and says so', async () => {
 tick.mockImplementation(async () => ({ gone: true }));
 const screen = await show('- [ ] Write the hook');
 const hook = screen.getByRole('checkbox', { name: 'Write the hook' });
 await hook.click();
 await expect.element(hook).toHaveAttribute('aria-checked', 'false');
 await expect.element(screen.getByRole('alert')).toHaveTextContent('That item changed meanwhile. Here is the description as it is now.');
});

test('a Viewer sees the boxes and cannot press them', async () => {
 const screen = await show('- [x] Done one\n- [ ] Open one', { canTick: false });
 const open = screen.getByRole('checkbox', { name: 'Open one' });
 await expect.element(open).toHaveAttribute('aria-disabled', 'true');
 expect(document.querySelectorAll('.de button')).toHaveLength(0);
 await open.click({ force: true });
 expect(tick).not.toHaveBeenCalled();
 await expect.element(screen.getByRole('checkbox', { name: 'Done one' })).toHaveAttribute('aria-checked', 'true');
});

test('a long description folds after about twelve lines and opens with Show more', async () => {
 const screen = await show(Array.from({ length: 30 }, (_, n) => `Line ${n + 1}`).join('\n\n'));
 const more = screen.getByRole('button', { name: 'Show more' });
 await expect.element(more).toHaveAttribute('aria-expanded', 'false');
 expect(document.querySelector('.de')?.classList.contains('is-fold')).toBe(true);
 await more.click();
 await expect.element(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
 expect(document.querySelector('.de')?.classList.contains('is-fold')).toBe(false);
});

test('a short description does not fold, and an empty one draws nothing', async () => {
 await show('Just one line');
 expect(document.querySelector('.de-more')).toBeNull();
 const screen = await show('   ');
 expect(screen.container.querySelector('.de')).toBeNull();
});

test('in Arabic the count and the show-more read in Arabic', async () => {
 const screen = await show('- [x] أ\n- [ ] ب', { language: 'ar' });
 expect(document.querySelector('.de-prog')?.textContent).toBe('1/2 خلصوا');
 await expect.element(screen.getByRole('checkbox', { name: 'ب' })).toBeVisible();
});
