import { afterEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { Head, Label } from '@/app/settings-overlay-parts';
import { Advanced } from '@/app/settings-info';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';
import en from '@/lib/messages/en.json';
import ar from '@/lib/messages/ar.json';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

// #614: optional help in Settings sits behind an "i" after a name. A resting mouse, a keyboard landing on it or a press
// shows it; moving away, Escape, a press outside or a second press hides it; the text never leaves a phone's screen.
afterEach(async () => { await page.viewport(1440, 900); });
const help = 'Every agent without a choice of its own runs on this one.';
// Settings as the overlay draws it, with a key listener standing in for the overlay's own Escape (it closes Settings
// unless a part inside took the key).
const inSettings = async (node: React.ReactNode, language: Language = 'en') => {
 const closed: string[] = [];
 const view = await render(<LanguageProvider language={language}><div className="gw" dir={language === 'ar' ? 'rtl' : 'ltr'}>
  <div className="sov" onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) closed.push('settings'); }}>
   <button type="button">Before</button>{node}<button type="button">After</button>
  </div></div></LanguageProvider>);
 return Object.assign(view, { closed });
};
const section = <section aria-labelledby="md-h"><Label id="md-h" info={help}>Default model</Label><div className="panel-card">rows</div></section>;
const panel = () => document.getElementById('md-h-info')!;
const shown = () => !panel().hidden && panel().getBoundingClientRect().height > 0;

test('the section names itself with no paragraph under it; its help waits behind a named "i"', async () => {
 const screen = await inSettings(section);
 const info = screen.getByRole('button', { name: 'More about Default model' });
 await expect.element(info).toHaveAttribute('aria-expanded', 'false');
 expect(info.element().getAttribute('aria-controls')).toBe('md-h-info');
 expect(shown()).toBe(false);
 // Hidden, the text is still in the page, so a field may name it as its description.
 expect(panel().textContent).toBe(help);
 expect(document.querySelector('.sov p')).toBeNull();
});

test('a mouse resting on it shows the help, and moving away hides it; a click keeps it until a second click', async () => {
 const screen = await inSettings(section);
 const info = screen.getByRole('button', { name: 'More about Default model' });
 await userEvent.hover(info);
 await expect.poll(shown).toBe(true);
 await expect.element(info).toHaveAttribute('aria-expanded', 'true');
 await userEvent.hover(screen.getByText('rows'));
 await expect.poll(shown).toBe(false);
 await userEvent.click(info);
 await expect.poll(shown).toBe(true);
 await userEvent.hover(screen.getByText('rows'));
 expect(shown()).toBe(true);
 await userEvent.click(info);
 await expect.poll(shown).toBe(false);
 await expect.element(info).toHaveAttribute('aria-expanded', 'false');
});

test('the mouse can move from the "i" onto the text and read it; Escape hides a tip the mouse opened, not Settings', async () => {
 const screen = await inSettings(section);
 const info = screen.getByRole('button', { name: 'More about Default model' });
 await userEvent.hover(info);
 await expect.poll(shown).toBe(true);
 // Across the gap and onto the text, it stays.
 const button = info.element().getBoundingClientRect(); const text = panel().getBoundingClientRect();
 // Every point of the gap between them belongs to the tip, so the pointer never leaves it on the way.
 expect(text.top).toBeGreaterThan(button.bottom);
 for (let y = button.bottom + 0.5; y < text.top; y += 1) expect(document.querySelector('.info')!.contains(document.elementFromPoint(button.left + button.width / 2, y))).toBe(true);
 await userEvent.hover(page.elementLocator(panel()), { position: { x: 8, y: 2 } });
 expect(shown()).toBe(true);
 // The focus is elsewhere: Escape still hides it first, and Settings keeps its own Escape.
 (screen.getByRole('button', { name: 'After' }).element() as HTMLElement).focus();
 await userEvent.keyboard('{Escape}');
 await expect.poll(shown).toBe(false);
 expect(screen.closed).toEqual([]);
});

test('a tip the keyboard opened stays while a mouse passes over and leaves', async () => {
 const screen = await inSettings(section);
 (screen.getByRole('button', { name: 'Before' }).element() as HTMLElement).focus();
 await userEvent.tab();
 await expect.poll(shown).toBe(true);
 await userEvent.hover(screen.getByRole('button', { name: 'More about Default model' }));
 await userEvent.hover(screen.getByText('rows'));
 expect(shown()).toBe(true);
});

test('a click anywhere else hides it', async () => {
 const screen = await inSettings(section);
 await userEvent.click(screen.getByRole('button', { name: 'More about Default model' }));
 await expect.poll(shown).toBe(true);
 await userEvent.click(screen.getByText('rows'));
 await expect.poll(shown).toBe(false);
});

test('the keyboard opens it by landing on it, keeps it with Enter, and Escape hides it without closing Settings', async () => {
 const screen = await inSettings(section);
 const info = screen.getByRole('button', { name: 'More about Default model' });
 (screen.getByRole('button', { name: 'Before' }).element() as HTMLElement).focus();
 await userEvent.tab();
 await expect.element(info).toHaveFocus();
 await expect.poll(shown).toBe(true);
 await userEvent.keyboard('{Escape}');
 await expect.poll(shown).toBe(false);
 await expect.element(info).toHaveFocus();
 expect(screen.closed).toEqual([]);
 await userEvent.keyboard('{Enter}');
 await expect.poll(shown).toBe(true);
 await userEvent.keyboard('{Enter}');
 await expect.poll(shown).toBe(false);
 await userEvent.keyboard(' ');
 await expect.poll(shown).toBe(true);
 // Leaving it hides it; Escape with nothing open is the overlay's again.
 await userEvent.tab();
 await expect.element(screen.getByRole('button', { name: 'After' })).toHaveFocus();
 await expect.poll(shown).toBe(false);
 await userEvent.keyboard('{Escape}');
 expect(screen.closed).toEqual(['settings']);
});

test('Escape that hides the help never reaches a field\'s own Escape (the knowledge editor\'s Cancel)', async () => {
 const cancelled: string[] = [];
 const screen = await inSettings(<div onKeyDown={event => { if (event.key === 'Escape') cancelled.push('draft'); }}>{section}<textarea aria-label="Draft"/></div>);
 await userEvent.hover(screen.getByRole('button', { name: 'More about Default model' }));
 await expect.poll(shown).toBe(true);
 (screen.getByRole('textbox', { name: 'Draft' }).element() as HTMLElement).focus();
 await userEvent.keyboard('{Escape}');
 await expect.poll(shown).toBe(false);
 expect(cancelled).toEqual([]);
 expect(screen.closed).toEqual([]);
 // With the help closed, the field's Escape is its own again.
 await userEvent.keyboard('{Escape}');
 expect(cancelled).toEqual(['draft']);
});

test('a page head keeps only its title; its help is beside it and a count stays as one short muted fact', async () => {
 const screen = await inSettings(<Head title="Recurring tasks" info="A new task is made with one sentence." meta="2 on out of 2 · across 2 agents."/>);
 const heading = screen.getByRole('heading', { level: 3 });
 expect(heading.element().textContent).toBe('Recurring tasks');
 await expect.element(screen.getByRole('button', { name: 'More about Recurring tasks' })).toBeVisible();
 await expect.element(screen.getByText('2 on out of 2 · across 2 agents.')).toBeVisible();
 expect(document.querySelector('.sov-sub')).toBeNull();
});

test('on an Arabic phone the help opens on a tap, reads in Arabic and stays inside the screen', async () => {
 await page.viewport(390, 800);
 const screen = await inSettings(<div style={{ display: 'flex', justifyContent: 'space-between' }}><Label id="md-h" info={ar.settingsModelsDefaultHint}>{'الموديل الافتراضي للشركة'}</Label></div>, 'ar');
 const info = screen.getByRole('button', { name: ar.settingsInfoAbout.replace('{0}', 'الموديل الافتراضي للشركة') });
 await userEvent.click(info);
 await expect.poll(shown).toBe(true);
 const box = panel().getBoundingClientRect();
 expect(box.left).toBeGreaterThanOrEqual(16);
 expect(box.right).toBeLessThanOrEqual(390 - 16);
 expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
});

test('Advanced starts closed, and a click or the keyboard opens and closes it', async () => {
 for (const [language, label] of [['en', en.settingsAdvanced], ['ar', ar.settingsAdvanced]] as const) {
  const screen = await inSettings(<Advanced id="adv"><label>Max at once <input/></label></Advanced>, language);
  const details = document.getElementById('adv') as HTMLDetailsElement;
  expect(details.open).toBe(false);
  const field = details.querySelector('input')!;
  expect(field.checkVisibility()).toBe(false);
  const summary = screen.getByText(label);
  await userEvent.click(summary);
  await expect.poll(() => details.open).toBe(true);
  expect(field.checkVisibility()).toBe(true);
  await userEvent.click(summary);
  await expect.poll(() => details.open).toBe(false);
  (details.querySelector('summary') as HTMLElement).focus();
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => details.open).toBe(true);
  await screen.unmount();
 }
});
