import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import type { ComponentProps } from 'react';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n } from '@/lib/i18n.mjs';
import { SkillPage } from '@/app/settings-skill-page';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

// #181: a learned Skill's page in Settings › Learning, as the server draws it. The pinned Engine has no management route
// over the Skill ledger, so the page shows the current text line by line in one column under "Steps": no Before/After,
// no version, no Why, and no restore control. "Back" returns to Learning, and the link keeps the page's address.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: ({ onClick, ...props }: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))} onClick={event => { onClick?.(event); event.preventDefault(); }}/> }));

afterEach(() => { sessionStorage.clear(); });

const data: import('@/lib/company-skill-page.mjs').CompanySkillPage = {
 state: 'found',
 agent: { id: '3a000000-0000-0000-0000-000000000011', name: 'Lead', own: true },
 skill: 'weekly-recap',
 mode: 'auto',
 content: '---\nname: weekly-recap\ndescription: Writes the Friday recap.\n---\n\nSend the Friday recap to the team.',
};
const screen = (language: 'en' | 'ar' = 'en', value = data) => render(<LanguageProvider language={language}>
 <SkillPage t={i18n(language).t} slug="rs-learning" rtl={language === 'ar'} data={value}/>
</LanguageProvider>);

test('one column under Steps: the Skill\'s name, whose Skill it is with its learning mode, and the text line by line', async () => {
 const page = await screen();
 await expect.element(page.getByRole('heading', { name: 'weekly-recap' })).toBeVisible();
 await expect.element(page.getByText('A skill of Lead · Learns on its own')).toBeVisible();
 await expect.element(page.getByRole('heading', { name: 'Steps' })).toBeVisible();
 const lines = [...document.querySelectorAll('.sk-col ol li')].map(line => line.textContent);
 expect(lines).toEqual(['---', 'name: weekly-recap', 'description: Writes the Friday recap.', '---', 'Send the Friday recap to the team.']);
 expect(document.querySelectorAll('.sk-diff')).toHaveLength(1);
 expect(document.querySelectorAll('.sk-col')).toHaveLength(1);
 expect(document.querySelectorAll('.sk-col.is-cur')).toHaveLength(1);
});

test('no Before or After, no version, no Why and no restore control: the pinned Engine cannot read the ledger', async () => {
 const page = await screen();
 await expect.element(page.getByRole('heading', { name: 'Steps' })).toBeVisible();
 expect(page.getByText(/Before|After|version|Why/i).elements()).toEqual([]);
 expect(page.getByRole('button').elements()).toEqual([]);
 expect(page.getByText(/Restore|previous/i).elements()).toEqual([]);
});

test('Back returns to Learning and names the learned row the focus goes to', async () => {
 const page = await screen();
 const back = page.getByRole('link', { name: 'Learning' });
 await expect.element(back).toBeVisible();
 expect(back.element().getAttribute('href')).toBe('/c/rs-learning/settings?section=learning');
 await back.click();
 expect(sessionStorage.getItem('gw-return-focus')).toBe('ln-see-3a000000-0000-0000-0000-000000000011:weekly-recap');
});

test('Arabic draws the same one column with its own words, and a mode that cannot be read is left out', async () => {
 const page = await screen('ar', { ...data, mode: null });
 await expect.element(page.getByRole('heading', { name: 'weekly-recap' })).toBeVisible();
 await expect.element(page.getByText('مهارة عند Lead')).toBeVisible();
 await expect.element(page.getByRole('heading', { name: 'الخطوات' })).toBeVisible();
 expect(page.getByText(/يتعلّم لوحده/).elements()).toEqual([]);
});
