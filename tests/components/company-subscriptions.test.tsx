import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { CompanySubscriptions } from '@/app/company-engine-client';
import { LanguageProvider } from '@/lib/i18n-client';
import type { CompanySignIns, SubscriptionState } from '@/lib/company-sign-in.mjs';
import en from '@/lib/messages/en.json';
import ar from '@/lib/messages/ar.json';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }) }));
afterEach(() => { refresh.mockReset(); vi.unstubAllGlobals(); });

const companyName = 'RS Learning';
const command = `gtmworks sign-in claude --company "${companyName}"`;
const signIns = (chatgpt: SubscriptionState, claude: SubscriptionState): CompanySignIns['signIns'] =>
  ({ 'openai-codex': { state: chatgpt, flow: 'device_code' }, anthropic: { state: claude, flow: 'external' } });
const section = (props: { owner: boolean, available: boolean, signIns: CompanySignIns['signIns'], noEngine?: boolean }, language: 'en' | 'ar' = 'en') =>
  render(<LanguageProvider language={language}><CompanySubscriptions company="c-1" companyName={companyName} {...props}/></LanguageProvider>);
const stateOf = (provider: string) => document.querySelector(`#sub-${provider}-state`)?.textContent;
const buttons = () => [...document.querySelectorAll('#md-subscriptions button')].map(button => button.getAttribute('aria-label'));

test('a root sign-in is Connected with Disconnect, and the page says one account serves one Company', async () => {
  const sent: object[] = [];
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return Promise.resolve(new Response(JSON.stringify({ status: 'disconnected' }))); });
  const screen = await section({ owner: true, available: true, signIns: signIns('connected', 'notConnected') });
  await expect.element(screen.getByText(en.signInConnected, { exact: true })).toBeVisible();
  expect(buttons()).toEqual(['Disconnect ChatGPT']);
  expect(document.querySelector('#sub-shared')).toBeNull();
  expect(document.querySelector('#md-subscriptions > .set-hint')?.textContent).toBe(`${en.signInHint} ${en.signInOneAccount}`);
  expect(document.querySelector('#sub-anthropic code')?.textContent).toBe(command);
  await screen.getByRole('button', { name: 'Disconnect ChatGPT' }).click();
  await expect.poll(() => refresh.mock.calls.length).toBe(1);
  expect(sent).toEqual([{ company: 'c-1', provider: 'openai-codex', intent: 'disconnect' }]);
});

test('a sign-in an earlier version left for the main agent only says so, and offers Disconnect and Connect again', async () => {
  const screen = await section({ owner: true, available: true, signIns: signIns('mainAgentOnly', 'mainAgentOnly') });
  await expect.poll(() => stateOf('openai-codex')).toBe(en.signInMainAgentOnly);
  expect(stateOf('anthropic')).toBe(en.signInMainAgentOnly);
  expect(buttons()).toEqual(['Disconnect ChatGPT', 'Connect ChatGPT', 'Disconnect Claude']);
  await expect.element(screen.getByText(en.signInTerminalOnly)).toBeVisible();
  expect(document.querySelector('#sub-shared')).toBeNull();
  await screen.unmount();
  await section({ owner: true, available: true, signIns: signIns('mainAgentOnly', 'connected') }, 'ar');
  await expect.poll(() => stateOf('openai-codex')).toBe(ar.signInMainAgentOnly);
  expect(document.querySelector('#md-subscriptions > .set-hint')?.textContent).toBe(`${ar.signInHint} ${ar.signInOneAccount}`);
});

test('a sign-in a stopped Disconnect left in an Agent\'s own profile says so, and keeps Disconnect and Connect again', async () => {
  const screen = await section({ owner: true, available: true, signIns: signIns('someAgentsOnly', 'notConnected') });
  await expect.poll(() => stateOf('openai-codex')).toBe(en.signInSomeAgentsOnly);
  expect(buttons()).toEqual(['Disconnect ChatGPT', 'Connect ChatGPT']);
  await screen.unmount();
});

test('a Company with no reachable Engine offers no sign-in control and says so', async () => {
  for (const language of ['en', 'ar'] as const) {
    const screen = await section({ owner: true, available: false, signIns: null }, language);
    await expect.element(screen.getByText(language === 'en' ? en.signInNoProfile : ar.signInNoProfile)).toBeVisible();
    expect(buttons()).toEqual([]);
    expect(document.querySelector('#md-subscriptions code')).toBeNull();
    await screen.unmount();
  }
});

test('when the company\'s engine is not running, one notice says so in both languages and no sign-in action is offered', async () => {
  for (const [language, text] of [['en', en.noEngine], ['ar', ar.noEngine]] as const) {
    const screen = await section({ owner: true, available: false, signIns: null, noEngine: true }, language);
    await expect.element(screen.getByRole('note')).toHaveTextContent(text);
    expect(buttons()).toEqual([]);
    expect(document.querySelector('#sub-openai-codex')).toBeNull();
    expect(document.querySelector('#md-subscriptions code')).toBeNull();
    expect(document.querySelector('#md-subscriptions > .set-hint')).toBeNull();
    await screen.unmount();
  }
});

test('a member who is not the Owner reads each state and gets no button and no command', async () => {
  for (const [chatgpt, claude] of [['connected', 'mainAgentOnly'], ['notConnected', 'notConnected']] as const) {
    const screen = await section({ owner: false, available: true, signIns: signIns(chatgpt, claude) });
    await expect.poll(() => stateOf('openai-codex')).toBe(chatgpt === 'connected' ? en.signInConnected : en.signInNotConnected);
    expect(stateOf('anthropic')).toBe(claude === 'mainAgentOnly' ? en.signInMainAgentOnly : en.signInNotConnected);
    expect(buttons()).toEqual([]);
    expect(document.querySelector('#md-subscriptions code')).toBeNull();
    await screen.unmount();
  }
});

// #424: ChatGPT and Claude each show their own logo, named, not the shared glyph.
test('each subscription row shows its own logo, named', async () => {
  await section({ owner: true, available: true, signIns: signIns('notConnected', 'notConnected') });
  const logos = ['openai-codex', 'anthropic'].map(provider => document.querySelector(`#sub-${provider} .tool-tile[role=img]`));
  expect(logos.map(logo => [logo?.getAttribute('aria-label'), !!logo?.querySelector('.tool-logo')])).toEqual([['ChatGPT', true], ['Claude', true]]);
  expect(document.querySelector('#md-subscriptions .panel-row__icon')).toBeNull();
});
