import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { AddMemberSection, type AddMember } from '@/app/add-member-section';
import { ToastHost } from '@/app/toast';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/' }));

// #952: an Administrator adds a Person who is a Member of another Company they administer, from the Team page, with the
// Person and their Company, a Role that is never Administrator and the Agents they will see; no link is made.
const add = vi.fn<AddMember>();
afterEach(() => { add.mockReset(); });
const people = [{ person_id: 'p-1', name: 'Nour Salah', company: 'Aleem' }, { person_id: 'p-2', name: 'Mona', company: 'R&S Consultations' }];
const agents = [{ id: 'a-2', name: 'Meta Ads' }, { id: 'a-3', name: 'SEO' }];
const show = (language: Language = 'en') => render(<LanguageProvider language={language}>
 <div className="gw"><div className="sov"><AddMemberSection people={people} agents={agents} add={add}/></div></div><ToastHost/>
</LanguageProvider>);

test('the form offers the People with their Company, a Role without Administrator and the Agents, and adds with no link', async () => {
 add.mockResolvedValue({});
 const screen = await show();
 await screen.getByRole('button', { name: 'Add someone from another company' }).click();
 await expect.poll(() => document.activeElement?.id).toBe('addm-person');
 const person = document.getElementById('addm-person') as HTMLSelectElement;
 expect([...person.options].map(option => option.text)).toEqual(['Nour Salah · Aleem', 'Mona · R&S Consultations']);
 const role = document.getElementById('addm-role') as HTMLSelectElement;
 expect([...role.options].map(option => option.value)).toEqual(['manager', 'contributor', 'viewer']);
 expect(role.value).toBe('contributor');
 await userEvent.selectOptions(person, 'p-2');
 await userEvent.selectOptions(role, 'viewer');
 await screen.getByRole('switch', { name: 'Mona · SEO' }).click();
 await expect.element(screen.getByRole('switch', { name: 'Mona · SEO' })).toHaveAttribute('aria-checked', 'true');
 await screen.getByRole('button', { name: 'Add member' }).click();
 expect(add).toHaveBeenCalledWith('p-2', 'viewer', ['a-3']);
 await expect.element(screen.getByText('Mona was added to the team.')).toBeVisible();
 await expect.element(screen.getByRole('button', { name: 'Add someone from another company' })).toBeVisible();
});

test('a refused add shows why and keeps the form; the Arabic form reads as the reference words it', async () => {
 add.mockResolvedValue({ error: 'addMemberAlready' });
 const screen = await show('ar');
 await screen.getByRole('button', { name: 'ضيف حد من شركة تانية' }).click();
 await screen.getByRole('button', { name: 'ضيف العضو' }).click();
 await expect.element(screen.getByText('هو عضو في الشركة دي بالفعل.')).toBeVisible();
 expect(document.getElementById('addm-person')).not.toBeNull();
});
