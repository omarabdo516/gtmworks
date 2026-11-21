import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import type { ComponentProps } from 'react';
import { LanguageProvider } from '@/lib/i18n-client';
import { MorningCard } from '@/app/morning-card';
import type { MorningCard as Card } from '@/lib/good-morning-card';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))}/> }));

// #183: the morning's card (design-reference: checkinHTML). The foot shows the job's real time, or that it is off; the
// Viewer reads "Waiting on the team"; "Change the time" is for the Owner and the Managers.
const lead = '6a000000-0000-0000-0000-000000000001';
const ads = { id: '6a000000-0000-0000-0000-000000000002', connection_id: 'f0000000-0000-0000-0000-000000000011', name: 'Ads' };
const card = (over: Partial<Card> = {}): Card => ({ day: '2026-11-11', main: lead, viewer: false, manage: true,
 waiting: [{ kind: 'question', id: 7, title: 'Which offer goes first?', body: '', asked_by: 'Lead', card_id: null, conversation_id: 'c1000000-0000-0000-0000-000000000001', channel_id: null, channel_message_id: null, note_id: null, agent: null }],
 handed: [], overnight: [{ id: 1, agent: ads, routine: 'Ad-pause routine', line: 'Paused the Video 2 ad when cost per lead hit EGP 52', at: '2026-11-11T00:40:00Z' }],
 foot: { on: true, time: '9:30', custom: null, zone: 'Africa/Cairo' }, ...over });
const cardPage = (value: Card, language: 'en' | 'ar' = 'en') => render(<LanguageProvider language={language}><MorningCard slug="rs-learning" card={value}/></LanguageProvider>);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('the card sums itself up, lists each part, and its foot shows the job\'s real time with Change the time', async () => {
 const screen = await cardPage(card());
 await expect.element(screen.getByText('Good morning · Wed, Nov 11')).toBeVisible();
 await expect.element(screen.getByText('One thing waiting on you · 1 things ran overnight')).toBeVisible();
 await expect.element(screen.getByRole('link', { name: /Which offer goes first\?/ })).toHaveAttribute('href', '/c/rs-learning/conversations/c1000000-0000-0000-0000-000000000001');
 await expect.element(screen.getByRole('link', { name: /Paused the Video 2 ad/ })).toHaveAttribute('href', `/c/rs-learning/chat/${ads.id}`);
 await expect.element(screen.getByText('Arrives every day at 9:30 AM. If there’s nothing new, it won’t send anything.')).toBeVisible();
 await expect.element(screen.getByRole('link', { name: 'Change the time' })).toHaveAttribute('href', `/c/rs-learning/settings?agent=${lead}&focus=time`);
});

const off = card({ foot: { on: false, time: '9:30', custom: null, zone: 'Africa/Cairo' } });
test('switched off, the foot says it will not arrive tomorrow', async () => {
 const screen = await cardPage(off);
 await expect.element(screen.getByText('Good morning is off, so it won’t arrive tomorrow.')).toBeVisible();
});

test('in Arabic the title names the day as the reference does, and the foot says it is off', async () => {
 const arabic = await cardPage(off, 'ar');
 await expect.element(arabic.getByText('صباح الخير مقفول دلوقتي، مش هيوصلك بكرة.')).toBeVisible();
 await expect.element(arabic.getByText('صباح الخير · الأربع 11 نوفمبر')).toBeVisible();
});

test('a Viewer reads Waiting on the team and no Change the time; with nothing waiting the part says so', async () => {
 const screen = await cardPage(card({ viewer: true, manage: false, waiting: [] }));
 await expect.element(screen.getByText('Waiting on the team')).toBeVisible();
 await expect.element(screen.getByText('Nothing waiting on you right now. All agents are running on their own.')).toBeVisible();
 expect(screen.getByRole('link', { name: 'Change the time' }).elements()).toHaveLength(0);
});
