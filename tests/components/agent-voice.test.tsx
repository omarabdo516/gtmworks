import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { LanguageProvider } from '@/lib/i18n-client';
import { AgentVoice, AgentVoiceSpeed } from '@/app/settings-agent-voice';
import { AgentSaveBar } from '@/app/settings-agent-form';
import { ToastHost } from '@/app/toast';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))}/> }));

// #162: the Voice section is the Agent's own settings held as a draft: Listen plays the sound the agent engine makes with
// the saved voice, and is off while the section differs; the voice is a list only for ElevenLabs and otherwise the saved
// one with a line naming what is missing; the arrow keys move the speed, left for faster in Arabic; and the line beside
// Listen says the sample text goes to Microsoft to be spoken, in both languages (Omar, 2026-11-18).
const company = '10000000-0000-0000-0000-000000000001';
const sample = 'Hi Omar, I finished the December campaign analysis and I have three new angles.';

/** A sound the page can play without decoding anything: it keeps what was played and how. */
class FakeAudio {
 static made: FakeAudio[] = [];
 src: string;
 played = 0;
 paused = 0;
 private ended = new Set<() => void>();
 constructor(src: string) { this.src = src; FakeAudio.made.push(this); }
 addEventListener(name: string, listener: () => void) { if (name === 'ended') this.ended.add(listener); }
 play() { this.played += 1; return Promise.resolve(); }
 pause() { this.paused += 1; }
 end() { for (const listener of this.ended) listener(); }
}

const read = (over: Record<string, unknown> = {}) => ({ state: 'found', own: true, language: 'en', speed: 1, provider: 'edge',
 voice: 'en-US-AriaNeural', voiceName: 'en-US-AriaNeural', list: null, speech: null, languages: ['ar', 'en', ''], ...over });

// The Agent page as the server draws it: the Voice group and, in Advanced (#615), the speed, in one draft; the bar after
// the panel, the toasts the page raises. Each test takes a new Agent, so the page's one draft starts from the read.
let count = 0;
const voicePage = (voice = read(), language: 'en' | 'ar' = 'en') => {
 const agent = `ag-voice-${++count}`;
 return render(<LanguageProvider language={language}>
  <ToastHost />
  <div id="sov-agent-panel"><AgentVoice company={company} agent={agent} personName="Omar Abdelrahman" voice={voice as never}/>
   <AgentVoiceSpeed agent={agent} speed={voice.speed as number} editable/></div>
  <AgentSaveBar company={company} agent={agent} name="Lead" />
 </LanguageProvider>);
};

const answerFor = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const speakAnswer = (dataUrl = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAA') => vi.fn(async (url: string, init?: RequestInit) => {
 if (String(url).includes('agent-speak')) return answerFor({ dataUrl, mimeType: 'audio/mpeg' });
 const sent = JSON.parse(String(init?.body));
 const voice = sent?.changes?.voice ?? {};
 return answerFor({ saved: { voice: { language: voice.language ?? 'en', speed: Number(voice.speed ?? 1), voice: 'en-US-AriaNeural' } } });
});

afterEach(() => { FakeAudio.made = []; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('Listen plays the Engine\'s sound, the button reads Stop and stays pressed while it plays, and a second press stops it', async () => {
 vi.stubGlobal('Audio', FakeAudio);
 const fetchSpy = speakAnswer();
 vi.stubGlobal('fetch', fetchSpy);
 const screen = await voicePage();
 await screen.getByRole('button', { name: 'Listen' }).click();
 await expect.poll(() => FakeAudio.made.length).toBe(1);
 expect(FakeAudio.made[0].src).toBe('data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAA');
 const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
 expect(sent).toEqual({ company, agent: sent.agent });
 const stop = screen.getByRole('button', { name: 'Stop' });
 await expect.element(stop).toHaveAttribute('aria-pressed', 'true');
 await expect.element(screen.getByText(`en-US-AriaNeural says: “${sample}” · 1×`)).toBeVisible();
 await stop.click();
 expect(FakeAudio.made[0].paused).toBe(1);
 await expect.element(screen.getByRole('button', { name: 'Listen' })).toHaveAttribute('aria-pressed', 'false');
});

test('the sound ends on its own and the button reads Listen again', async () => {
 vi.stubGlobal('Audio', FakeAudio);
 vi.stubGlobal('fetch', speakAnswer());
 const screen = await voicePage();
 await screen.getByRole('button', { name: 'Listen' }).click();
 await expect.poll(() => FakeAudio.made.length).toBe(1);
 FakeAudio.made[0].end();
 await expect.element(screen.getByRole('button', { name: 'Listen' })).toHaveAttribute('aria-pressed', 'false');
});

test('changing the voice or the language stops the sound, and the section then waits to be saved', async () => {
 vi.stubGlobal('Audio', FakeAudio);
 vi.stubGlobal('fetch', speakAnswer());
 const screen = await voicePage(read({ provider: 'elevenlabs', voice: '21m00Tcm4TlvDq8ikWAM', voiceName: 'Bella',
  list: { state: 'found', available: true, voices: [{ id: 'pNInz6obpgDQGcFmaJgB', name: 'Rachel', label: 'Rachel' }, { id: '21m00Tcm4TlvDq8ikWAM', name: 'Bella', label: 'Bella' }] } }));
 await screen.getByRole('button', { name: 'Listen' }).click();
 await expect.poll(() => FakeAudio.made.length).toBe(1);
 await screen.getByRole('combobox', { name: 'Voice' }).selectOptions('pNInz6obpgDQGcFmaJgB');
 expect(FakeAudio.made[0].paused).toBe(1);
 await expect.element(screen.getByRole('button', { name: 'Listen' })).toBeDisabled();
 // Saved, Listen plays the saved voice again, and a new language stops it just the same.
 await screen.getByRole('button', { name: 'Save', exact: true }).click();
 await expect.poll(() => document.getElementById('dp-savebar')?.hidden).toBe(true);
 await screen.getByRole('button', { name: 'Listen' }).click();
 await expect.poll(() => FakeAudio.made.length).toBe(2);
 await screen.getByRole('combobox', { name: 'Speaking language' }).selectOptions('ar');
 expect(FakeAudio.made[1].paused).toBe(1);
});

test('while the section has unsaved changes Listen is off with the line to save first, and the section says so in the hint', async () => {
 vi.stubGlobal('Audio', FakeAudio);
 vi.stubGlobal('fetch', speakAnswer());
 const screen = await voicePage();
 const listen = screen.getByRole('button', { name: 'Listen' });
 await expect.element(listen).toBeEnabled();
 await screen.getByRole('radio', { name: '1.25×' }).click();
 await expect.element(listen).toBeDisabled();
 await expect.element(screen.getByText('Save your changes first: “Listen” plays the saved voice.')).toBeVisible();
 // Save sends the changed speed, the Engine keeps it, and Listen is back.
 await screen.getByRole('button', { name: 'Save', exact: true }).click();
 await expect.poll(() => document.getElementById('dp-savebar')?.hidden).toBe(true);
 await expect.element(screen.getByRole('button', { name: 'Listen' })).toBeEnabled();
 // The speed's explanation is its optional help (#614), there for the asking.
 const speedHelp = document.getElementById('set-speed-hint')!;
 expect(speedHelp.checkVisibility()).toBe(false);
 await screen.getByRole('button', { name: 'More about Voice speed' }).click();
 await expect.element(screen.getByText('1× is normal speed. Slower is clearer for numbers and names.')).toBeVisible();
});

test('the line beside Listen says the text goes to Microsoft, in English and in Arabic', async () => {
 const english = await voicePage();
 await expect.element(english.getByText('“Listen” sends the sample text to Microsoft to be spoken.')).toBeVisible();
 const arabic = await voicePage(read(), 'ar');
 await expect.element(arabic.getByText('«اسمع» بيبعت نص العيّنة لمايكروسوفت عشان يتقال.')).toBeVisible();
});

test('the arrow keys move the speed: forward is left in Arabic', async () => {
 const screen = await voicePage(read(), 'ar');
 await screen.getByRole('radio', { name: '1×', exact: true }).click();
 await userEvent.keyboard('{ArrowLeft}');
 await expect.element(screen.getByRole('radio', { name: '1.25×' })).toHaveAttribute('aria-checked', 'true');
 await expect.element(screen.getByRole('radio', { name: '1.25×' })).toHaveFocus();
 await userEvent.keyboard('{ArrowRight}');
 await expect.element(screen.getByRole('radio', { name: '1×' })).toHaveAttribute('aria-checked', 'true');
});

test('the arrow keys move the speed: forward is right in English, and ends at the last step', async () => {
 const screen = await voicePage();
 await screen.getByRole('radio', { name: '1×', exact: true }).click();
 await userEvent.keyboard('{ArrowRight}');
 await expect.element(screen.getByRole('radio', { name: '1.25×' })).toHaveAttribute('aria-checked', 'true');
 await userEvent.keyboard('{ArrowRight}');
 await expect.element(screen.getByRole('radio', { name: '1.5×' })).toHaveAttribute('aria-checked', 'true');
 await userEvent.keyboard('{ArrowRight}');
 await expect.element(screen.getByRole('radio', { name: '1.5×' })).toHaveAttribute('aria-checked', 'true');
});

test('the speed in Advanced stops a playing sound, as a change to the voice does (#615)', async () => {
 vi.stubGlobal('Audio', FakeAudio);
 vi.stubGlobal('fetch', speakAnswer());
 const screen = await voicePage();
 await screen.getByRole('button', { name: 'Listen' }).click();
 await expect.poll(() => FakeAudio.made.length).toBe(1);
 await screen.getByRole('radio', { name: '0.85×' }).click();
 await expect.poll(() => FakeAudio.made[0].paused).toBe(1);
 await expect.element(screen.getByRole('button', { name: 'Listen' })).toBeDisabled();
});

test('a Listen answer that arrives after the speed changed is dropped, not played', async () => {
 vi.stubGlobal('Audio', FakeAudio);
 let answer: (value: Response) => void = () => {};
 vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { answer = resolve; })));
 const screen = await voicePage();
 await screen.getByRole('button', { name: 'Listen' }).click();
 await screen.getByRole('radio', { name: '1.25×' }).click();
 answer(answerFor({ dataUrl: 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAA', mimeType: 'audio/mpeg' }));
 await expect.element(screen.getByText('Save your changes first: “Listen” plays the saved voice.')).toBeVisible();
 await new Promise(resolve => setTimeout(resolve, 50));
 expect(FakeAudio.made).toHaveLength(0);
});

test('everyone who may not change the voice reads the speed as text in Advanced', async () => {
 const screen = await render(<LanguageProvider language="en"><AgentVoiceSpeed agent="ag-voice-read" speed={1.25} editable={false}/></LanguageProvider>);
 await expect.poll(() => document.getElementById('set-speed-val')?.textContent).toBe('1.25×');
 expect(screen.container.querySelector('[role=radio]')).toBeNull();
});

test('a provider with no list of voices shows the saved voice, its one line, and no voice to pick', async () => {
 const screen = await voicePage();
 const voice = screen.getByRole('combobox', { name: 'Voice' });
 await expect.element(voice).toBeDisabled();
 await expect.element(voice).toHaveValue('en-US-AriaNeural');
 await expect.element(screen.getByText('The agent engine offers no list of voices for this provider, so the saved voice stays.')).toBeVisible();
});

test('ElevenLabs with no key says the list is not there yet, and the saved voice still shows', async () => {
 const screen = await voicePage(read({ provider: 'elevenlabs', voice: 'pNInz6obpgDQGcFmaJgB', voiceName: 'pNInz6obpgDQGcFmaJgB',
  list: { state: 'found', available: false, voices: [] } }));
 await expect.element(screen.getByText('The agent engine has no list of voices from this provider yet: its key isn’t set.')).toBeVisible();
 await expect.element(screen.getByRole('combobox', { name: 'Voice' })).toBeDisabled();
});

test('an Engine that cannot speak says so where the sample is described', async () => {
 vi.stubGlobal('Audio', FakeAudio);
 vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'voiceUnavailable' }), { status: 502, headers: { 'Content-Type': 'application/json' } })));
 const screen = await voicePage();
 await screen.getByRole('button', { name: 'Listen' }).click();
 await expect.element(screen.getByText('The agent engine has no working speech provider right now, so there’s no sound to play.')).toBeVisible();
 expect(FakeAudio.made.length).toBe(0);
});

// #430: on Deepgram, Arabic reads as Egyptian and the other Arabic variants are named in the page's language; there is
// no "detect".
test('an Agent on Deepgram picks Egyptian Arabic or another Arabic variant, named in the page\'s language', async () => {
 const languages = ['ar', 'ar-SA', 'en'];
 const screen = await voicePage(read({ speech: 'deepgram', language: 'ar', languages }));
 const options = () => [...document.querySelectorAll<HTMLOptionElement>('#set-voice-lang option')].map(option => [option.value, option.textContent]);
 await expect.element(screen.getByLabelText('Speaking language')).toHaveValue('ar');
 expect(options()).toEqual([['ar', 'Arabic (Egypt)'], ['ar-SA', 'Arabic (Saudi Arabia)'], ['en', 'English']]);
 await screen.unmount();
 await voicePage(read({ speech: 'deepgram', language: 'ar', languages }), 'ar');
 expect(options()[0]).toEqual(['ar', 'عربي (مصري)']);
 expect(options()[1][1]).toContain('السعودية');
});
