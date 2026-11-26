import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { ModelsParts } from '@/app/settings-models-parts';
import { LanguageProvider } from '@/lib/i18n-client';
import en from '@/lib/messages/en.json';
import ar from '@/lib/messages/ar.json';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

// #791 (ADR 0030): Settings → Models draws at once and each part the Engine backs fills in from its own read. A part
// still on its first read says so; a part whose read fails with no good read shows its own line, and the other parts
// stay; a failed read that has a last good read keeps it and says it is read again.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/settings' }));
afterEach(() => { vi.unstubAllGlobals(); });

const options = [{ provider: 'anthropic', providerName: 'Anthropic', model: 'claude-opus-4-6' }];
const read = {
  signIns: { profile: 'default', profiles: ['default'], signIns: { 'openai-codex': { state: 'notConnected', flow: 'device_code' }, anthropic: { state: 'notConnected', flow: 'external' } }, accounts: [] },
  models: { models: { default: { model: 'anthropic/claude-opus-4-6', options }, agents: [] } },
  keys: { keys: [{ provider: 'anthropic', label: 'Anthropic', set: true }], waiting: null, leftover: null, unknown: null },
  providers: { anthropic: [{ model: 'claude-opus-4-6', enabled: true }] },
  speech: { provider: null, missing: [] },
} as Record<string, unknown>;
// Each part answers as `answer` says: a body, a failure, or never.
const stub = (answer: (part: string) => object | 'fail' | 'never') => vi.stubGlobal('fetch', (url: string) => {
  const part = new URL(url, 'http://x').searchParams.get('part')!;
  const given = answer(part);
  if (given === 'never') return new Promise<Response>(() => {});
  if (given === 'fail') return Promise.resolve(new Response('{"error":"settingFailed"}', { status: 502 }));
  return Promise.resolve(new Response(JSON.stringify({ data: given, readAt: Date.now() }), { status: 200 }));
});
const draw = (company: string, language: 'en' | 'ar' = 'en', asked = 1) => render(<LanguageProvider language={language}>
  <ModelsParts company={company} companyName="RS Learning" owner names={{}} order={{}} fallback={null} asked={asked}/>
</LanguageProvider>);

for (const [language, words] of [['en', en], ['ar', ar]] as const) test(`a part on its first read says so while the others fill in (${language})`, async () => {
  stub(part => part === 'signIns' ? 'never' : read[part] as object);
  const screen = await draw(`co-first-${language}`, language);
  await expect.element(screen.getByText('claude-opus-4-6').first()).toBeVisible();
  await expect.element(screen.getByText(words.settingsPartReading)).toBeVisible();
});

test('a failed read with no good read shows its own line and the other parts stay', async () => {
  stub(part => part === 'models' ? 'fail' : read[part] as object);
  const screen = await draw('co-failed');
  await expect.element(screen.getByText(en.settingsModelsUnread)).toBeVisible();
  await expect.element(screen.getByText(en.settingsSpeech)).toBeVisible();
  await expect.element(screen.getByText(en.settingsPartReadAgain)).not.toBeInTheDocument();
});

test('a failed read keeps the last good read and says it is read again', async () => {
  stub(part => read[part] as object);
  const first = await draw('co-kept');
  await expect.element(first.getByText('claude-opus-4-6').first()).toBeVisible();
  first.unmount();
  stub(part => part === 'models' ? 'fail' : read[part] as object);
  const again = await draw('co-kept', 'en', 2);
  await expect.element(again.getByRole('status').filter({ hasText: en.settingsPartReadAgain })).toBeVisible();
  await expect.element(again.getByText('claude-opus-4-6').first()).toBeVisible();
});
