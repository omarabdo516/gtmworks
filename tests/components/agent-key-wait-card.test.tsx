import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { AgentKeyWaitCard } from '@/app/c/[slug]/[[...section]]/agent-key-wait-card';
import { LanguageProvider } from '@/lib/i18n-client';

const item = { kind: 'agent_key', id: 3, title: 'Writer', body: '', asked_by: '', card_id: null, conversation_id: null, created_at: '2026-06-10T09:41:00Z' };
const card = (language: 'en' | 'ar', title = item.title) =>
 render(<div dir={language === 'ar' ? 'rtl' : 'ltr'}><LanguageProvider language={language}><AgentKeyWaitCard item={{ ...item, title }}/></LanguageProvider></div>);

test('an Agent waiting for the company\'s key shows its name, the reason and the way out, and nothing to press', async () => {
 const screen = await card('en');
 const waiting = screen.getByRole('group', { name: 'Writer waits for the company’s API key' });
 await expect.element(waiting.getByText('Writer', { exact: true })).toBeVisible();
 expect(waiting.getByText('Writer', { exact: true }).element().tagName).toBe('B');
 await expect.element(waiting.getByText('Waiting for the company’s API key')).toBeVisible();
 await expect.element(waiting.getByText('Give the key again and it starts on its own profile.')).toBeVisible();
 expect(waiting.element().querySelector('.badge.badge--wait')).not.toBeNull();
 expect(waiting.element().querySelectorAll('button, a, input')).toHaveLength(0);
 expect(waiting.element().textContent).toContain('Jun');
});

test('in Arabic the card reads right to left, and the Agent\'s name keeps its own direction', async () => {
 const screen = await card('ar', 'كاتب المدونة');
 const waiting = screen.getByRole('group', { name: 'كاتب المدونة مستني مفتاح الـAPI بتاع الشركة' });
 await expect.element(waiting.getByText('مستني مفتاح الـAPI بتاع الشركة', { exact: true })).toBeVisible();
 await expect.element(waiting.getByText('ادّي المفتاح تاني ويشتغل على البروفايل بتاعه.')).toBeVisible();
 expect(getComputedStyle(waiting.element()).direction).toBe('rtl');
 expect(waiting.getByText('كاتب المدونة', { exact: true }).element().getAttribute('dir')).toBe('auto');
 expect(waiting.element().querySelectorAll('button, a, input')).toHaveLength(0);
});
