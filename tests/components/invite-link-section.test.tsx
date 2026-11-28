import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { InviteLinkSection, type MakeLink } from '@/app/invite-link-section';
import { ToastHost } from '@/app/toast';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

// #950: the Administrator makes an Invite link on the Team page with the Person's name, a Role that is never
// Administrator and the Agents the Person will see; the full link is shown once, with a copy button and a confirmation.
const make = vi.fn<MakeLink>();
afterEach(() => { make.mockReset(); vi.unstubAllGlobals(); });
const link = `http://127.0.0.1:3000/join#code=${'c'.repeat(64)}`;
const agents = [{ id: 'a-2', name: 'Meta Ads' }, { id: 'a-3', name: 'SEO' }];
const show = (language: Language = 'en') => render(<LanguageProvider language={language}>
 <div className="gw"><div className="sov"><InviteLinkSection agents={agents} make={make}/></div></div><ToastHost/>
</LanguageProvider>);

test('the form takes a name, a Role without Administrator and the Agents, and shows the made link once with a copy button', async () => {
 const copied: string[] = [];
 vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async (text: string) => { copied.push(text); } } });
 make.mockResolvedValue({ link });
 const screen = await show();
 await screen.getByRole('button', { name: 'Make an invite link' }).click();
 await expect.poll(() => document.activeElement?.id).toBe('lnk-label');
 const role = document.getElementById('lnk-role') as HTMLSelectElement;
 expect([...role.options].map(option => option.value)).toEqual(['manager', 'contributor', 'viewer']);
 expect(role.value).toBe('contributor');
 // Nothing is made without a name.
 await screen.getByRole('button', { name: 'Make the link' }).click();
 await expect.element(screen.getByText('Write the person’s name, so you know whose link it is.')).toBeVisible();
 expect(make).not.toHaveBeenCalled();
 await userEvent.type(document.getElementById('lnk-label')!, 'Nour Salah');
 await userEvent.selectOptions(role, 'viewer');
 await screen.getByRole('switch', { name: 'SEO' }).click();
 await expect.element(screen.getByRole('switch', { name: 'SEO' })).toHaveAttribute('aria-checked', 'true');
 await expect.element(screen.getByRole('switch', { name: 'Meta Ads' })).toHaveAttribute('aria-checked', 'false');
 await expect.element(screen.getByText('The main agent is shown to everyone.')).toBeVisible();
 await screen.getByRole('button', { name: 'Make the link' }).click();
 expect(make).toHaveBeenCalledWith('Nour Salah', 'viewer', ['a-3']);
 // The link in full, read-only, and the copy button with the focus on it.
 await expect.element(screen.getByLabelText('Invite link for Nour Salah')).toHaveValue(link);
 await expect.poll(() => document.activeElement?.id).toBe('lnk-copy');
 await screen.getByRole('button', { name: 'Copy the link' }).click();
 expect(copied).toEqual([link]);
 await expect.element(screen.getByText('Link copied. Send it to Nour Salah any way you like.')).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
 // Closing it keeps nothing: the link is gone from the page.
 await screen.getByRole('button', { name: 'Done' }).click();
 expect(document.body.textContent).not.toContain('c'.repeat(64));
 await expect.poll(() => document.activeElement?.id).toBe('lnk-toggle');
});

test('a refused make shows why and keeps the form; the Arabic form reads as the reference words it', async () => {
 make.mockResolvedValue({ error: 'inviteLinkFailed' });
 const screen = await show('ar');
 await screen.getByRole('button', { name: 'اعمل لينك دعوة' }).click();
 await userEvent.type(document.getElementById('lnk-label')!, 'نور');
 await screen.getByRole('button', { name: 'اعمل اللينك' }).click();
 await expect.element(screen.getByText('معرفناش نعمل اللينك. جرّب تاني.')).toBeVisible();
 expect(document.getElementById('lnk-link')).toBeNull();
 await expect.element(screen.getByText('الوكلاء اللي هيشوفهم')).toBeVisible();
});

// #313, #953: the form that replaced the email invitation keeps the promise its test held (#257 removed the compared
// screens): on a phone its controls reach 44px under a finger, and its small controls keep their 22px size.
const tapArea = (node: Element) => {
 const own = node.getBoundingClientRect(), ring = getComputedStyle(node, '::before');
 const grow = ring.content === 'none' ? 0 : -(parseFloat(ring.top) || 0) - (parseFloat(ring.bottom) || 0);
 return { reach: own.height + Math.max(0, grow), seen: node.clientHeight };
};
for (const language of ['en', 'ar'] as const) test(`on a phone in ${language} the Invite link form's controls reach 44px, and its small controls keep their 22px size`, async () => {
 await page.viewport(390, 900);
 const screen = await show(language);
 make.mockResolvedValue({ link });
 const closed = tapArea(document.getElementById('lnk-toggle')!);
 expect(closed.reach, '"Make an invite link" reaches 44px').toBeGreaterThanOrEqual(44);
 expect(closed.seen, '"Make an invite link" keeps at least 22px').toBeGreaterThanOrEqual(22);
 await screen.getByRole('button', { name: language === 'ar' ? 'اعمل لينك دعوة' : 'Make an invite link' }).click();
 const fields = [...document.querySelectorAll('.inv-sec .inv :is(input#lnk-label, select, button[type=submit])')];
 expect(fields).toHaveLength(3);
 for (const field of fields) {
  const area = tapArea(field);
  expect(area.reach, `${field.id || field.tagName} reaches 44px`).toBeGreaterThanOrEqual(44);
  expect(area.seen, `${field.id || field.tagName} keeps at least 22px`).toBeGreaterThanOrEqual(22);
 }
 const cancel = tapArea(document.querySelector('.inv-sec .dp-label .link-btn')!);
 expect(cancel.reach, 'Cancel reaches 44px').toBeGreaterThanOrEqual(44);
 expect(cancel.seen, 'Cancel keeps at least 22px').toBeGreaterThanOrEqual(22);
 await userEvent.type(document.getElementById('lnk-label')!, 'Nour Salah');
 await screen.getByRole('button', { name: language === 'ar' ? 'اعمل اللينك' : 'Make the link' }).click();
 await expect.element(screen.getByLabelText(language === 'ar' ? 'لينك دعوة لـ Nour Salah' : 'Invite link for Nour Salah')).toHaveValue(link);
 for (const control of [document.getElementById('lnk-link')!, document.getElementById('lnk-copy')!, document.querySelector('.inv-sec .dp-label .link-btn')!]) {
  const area = tapArea(control);
  expect(area.reach, `${control.id || control.textContent} reaches 44px`).toBeGreaterThanOrEqual(44);
  expect(area.seen, `${control.id || control.textContent} keeps at least 22px`).toBeGreaterThanOrEqual(22);
 }
});
