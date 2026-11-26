import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { VoiceSettings } from '@/app/settings-voice';
import { LanguageProvider } from '@/lib/i18n-client';
import { ToastHost } from '@/app/toast';
import type { CompanyVoice } from '@/lib/company-speech.mjs';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

// #863: Settings → Voice. Hermes's own speech-to-text options for the whole Company, read by the page after it is
// drawn: the Owner changes each at once, a Manager reads them, and the choices are the ones Hermes offers the provider.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/settings' }));
afterEach(() => { vi.unstubAllGlobals(); });

const company = '10000000-0000-0000-0000-000000000001';
const voice = (over: Partial<CompanyVoice> = {}): CompanyVoice => ({ provider: 'openai', keys: ['openai', 'groq'], language: 'en', model: 'whisper-1', prompt: '', trimSilence: true,
 languages: ['', 'ar', 'en'], models: ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'gpt-transcribe'], ...over });
const json = (body: object, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
// The route: a read answers `read`, a save answers the read with the change and `failed`.
function engine(read: CompanyVoice, failed: { agent: string | null, name: string | null }[] = []) {
 const sent: { url: string, body: Record<string, unknown> }[] = [];
 let held = read;
 vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
  if (!init?.method || init.method === 'GET') return json({ data: held, readAt: Date.now() });
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  sent.push({ url, body });
  if (url === '/api/speech-provider') { held = { ...held, provider: body.provider as CompanyVoice['provider'], model: 'whisper-large-v3-turbo', models: ['whisper-large-v3-turbo', 'whisper-large-v3'] }; return json({ provider: held.provider, keys: held.keys, missing: [], failed: [], savedAt: Date.now() }); }
  const options = Object.fromEntries(Object.entries(body).filter(([name]) => name !== 'company'));
  held = { ...held, ...options, ...(typeof options.prompt === 'string' ? { prompt: options.prompt.trim() } : {}) };
  return json({ ...held, failed, savedAt: Date.now() });
 });
 return sent;
}
const voicePage = (owner = true, language: 'en' | 'ar' = 'en') => render(<LanguageProvider language={language}><VoiceSettings company={company} slug="rs-learning" owner={owner}/><ToastHost/></LanguageProvider>);
const optionsOf = (id: string) => [...document.querySelectorAll<HTMLOptionElement>(`#${id} option`)].map(option => [option.value, option.textContent]);

test('the Owner sets the language to Automatic once, and the page says it saved for every Agent', async () => {
 const sent = engine(voice());
 const screen = await voicePage();
 const language = screen.getByRole('combobox', { name: 'Language' });
 await expect.element(language).toHaveValue('en');
 expect(optionsOf('vc-language')).toEqual([['', 'Automatic'], ['ar', 'Arabic'], ['en', 'English']]);
 await language.selectOptions('');
 await expect.poll(() => sent.map(item => [item.url, item.body])).toEqual([['/api/voice-settings', { company, language: '' }]]);
 await expect.element(screen.getByText('Voice settings saved.')).toBeVisible();
 await expect.element(language).toHaveValue('');
});

test('the model is the provider\'s own list, the vocabulary is saved with its own button, and the silence trim is a switch', async () => {
 const sent = engine(voice());
 const screen = await voicePage();
 await screen.getByRole('combobox', { name: 'Model' }).selectOptions('gpt-4o-transcribe');
 const words = screen.getByRole('textbox', { name: 'Vocabulary' });
 await words.fill('gtmworks, Hermes');
 await screen.getByRole('button', { name: 'Save' }).click();
 await screen.getByRole('switch', { name: 'Silence trim' }).click();
 await expect.poll(() => sent.map(item => item.body)).toEqual([{ company, model: 'gpt-4o-transcribe' }, { company, prompt: 'gtmworks, Hermes' }, { company, trimSilence: false }]);
 await expect.element(screen.getByRole('switch', { name: 'Silence trim' })).toHaveAttribute('aria-checked', 'false');
 // Hermes's own note on which providers ignore the vocabulary is the row's help.
 await screen.getByRole('button', { name: 'More about Vocabulary' }).click();
 await expect.element(screen.getByText('Sent with each recording to OpenAI and Groq; ElevenLabs and Deepgram transcribe without it.')).toBeVisible();
});

test('Transcribe with offers only the providers with a key, and a switch reads the new provider\'s models', async () => {
 const sent = engine(voice());
 const screen = await voicePage();
 await expect.element(screen.getByRole('combobox', { name: 'Transcribe with' })).toHaveValue('openai');
 expect(optionsOf('vc-provider')).toEqual([['openai', 'OpenAI'], ['groq', 'Groq']]);
 await screen.getByRole('combobox', { name: 'Transcribe with' }).selectOptions('groq');
 await expect.poll(() => sent.map(item => [item.url, item.body])).toEqual([['/api/speech-provider', { company, provider: 'groq', intent: 'set' }]]);
 await expect.poll(() => optionsOf('vc-model').map(([value]) => value)).toEqual(['whisper-large-v3-turbo', 'whisper-large-v3']);
});

// Deepgram has no Hermes model and no automatic; Arabic is Egyptian there and its other Arabic variants stay, named in
// the page's language.
test('on Deepgram there is no model row, Arabic is Egyptian and the other Arabic variants are named in the page\'s language', async () => {
 engine(voice({ provider: 'deepgram', keys: ['deepgram'], language: 'ar', model: null, models: [], languages: ['ar', 'ar-SA', 'en'] }));
 const screen = await voicePage();
 await expect.element(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('ar');
 expect(optionsOf('vc-language')).toEqual([['ar', 'Arabic (Egypt)'], ['ar-SA', 'Arabic (Saudi Arabia)'], ['en', 'English']]);
 expect(screen.getByRole('combobox', { name: 'Model' }).query()).toBeNull();
 await screen.unmount();
 const arabic = await voicePage(true, 'ar');
 await expect.element(arabic.getByRole('combobox', { name: 'اللغة' })).toHaveValue('ar');
 expect(optionsOf('vc-language')[0]).toEqual(['ar', 'عربي (مصري)']);
 expect(optionsOf('vc-language')[1][1]).toContain('السعودية');
});

test('a Manager reads every option with no control, and the line says only the Owner changes them', async () => {
 const sent = engine(voice({ language: '', prompt: 'gtmworks', trimSilence: false }));
 const screen = await voicePage(false);
 await expect.element(screen.getByText('Only the Owner changes these.')).toBeVisible();
 await expect.element(screen.getByText('Automatic')).toBeVisible();
 await expect.element(screen.getByText('gtmworks')).toBeVisible();
 expect(screen.getByRole('combobox').query()).toBeNull();
 expect(screen.getByRole('switch').query()).toBeNull();
 expect(sent).toEqual([]);
});

test('an Agent a save missed is named, with no success toast', async () => {
 engine(voice(), [{ agent: 'a-2', name: 'Designer' }]);
 const screen = await voicePage();
 await screen.getByRole('combobox', { name: 'Language' }).selectOptions('ar');
 await expect.element(screen.getByText('The change did not reach Designer. Try again.')).toBeVisible();
 expect(screen.getByText('Voice settings saved.').query()).toBeNull();
});

test('with no speech provider holding a key, the page points the Owner to Providers', async () => {
 engine(voice({ provider: null, keys: [], model: null, models: [] }));
 const none = await voicePage();
 await expect.element(none.getByText('No speech-to-text provider has a key yet.')).toBeVisible();
 await expect.element(none.getByRole('link', { name: 'Add a key in Providers' })).toHaveAttribute('href', '/c/rs-learning/settings?section=models');
});
