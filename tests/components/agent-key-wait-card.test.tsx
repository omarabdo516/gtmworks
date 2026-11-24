import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import type { ComponentProps } from 'react';
import { AgentKeyWaitCard } from '@/app/c/[slug]/[[...section]]/agent-key-wait-card';
import { LanguageProvider } from '@/lib/i18n-client';

// A link stays on the test page: following it is the app's router's work, not the card's.
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/>, pageBeingOpened: () => null }));

const item = { kind: 'agent_key', id: 3, title: 'Writer', body: '', asked_by: '', card_id: null, conversation_id: null, created_at: '2026-06-10T09:41:00Z' };
const card = (language: 'en' | 'ar', title = item.title) =>
 render(<div dir={language === 'ar' ? 'rtl' : 'ltr'}><LanguageProvider language={language}><AgentKeyWaitCard slug="rs-learning" item={{ ...item, title }}/></LanguageProvider></div>);

test('an Agent with no model to run on says so in plain words and opens Settings at Providers (#660)', async () => {
 const screen = await card('en');
 const waiting = screen.getByRole('link', { name: 'Writer can’t start yet: connect an AI subscription or model key in Providers' });
 await expect.element(waiting).toBeVisible();
 expect(waiting.element().getAttribute('href')).toBe('/c/rs-learning/settings?section=models#md-providers');
 expect(waiting.getByText('Writer', { exact: true }).element().tagName).toBe('B');
 await expect.element(waiting.getByText('No AI subscription or model key it can run on')).toBeVisible();
 await expect.element(waiting.getByText('Connect one in Providers and it starts on its own.')).toBeVisible();
 expect(waiting.element().querySelector('.badge.badge--wait')).not.toBeNull();
 expect(waiting.element().classList.contains('mcard')).toBe(true);
 expect(waiting.element().textContent).toContain('Jun');
 expect(waiting.element().textContent).not.toContain('API key');
});

test('in Arabic the card reads right to left, opens Providers too, and the Agent\'s name keeps its own direction', async () => {
 const screen = await card('ar', 'كاتب المدونة');
 const waiting = screen.getByRole('link', { name: 'كاتب المدونة مش قادر يبدأ لسه: وصّل اشتراك ذكاء اصطناعي أو مفتاح موديل من المزوّدين' });
 expect(waiting.element().getAttribute('href')).toBe('/c/rs-learning/settings?section=models#md-providers');
 await expect.element(waiting.getByText('مفيش اشتراك ذكاء اصطناعي ولا مفتاح موديل يشتغل عليه', { exact: true })).toBeVisible();
 await expect.element(waiting.getByText('وصّل واحد من المزوّدين ويبدأ لوحده.')).toBeVisible();
 expect(getComputedStyle(waiting.element()).direction).toBe('rtl');
 expect(waiting.getByText('كاتب المدونة', { exact: true }).element().getAttribute('dir')).toBe('auto');
});
