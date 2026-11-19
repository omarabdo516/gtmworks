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

const profile = 'co-10000000000000000000000000000001';
const command = 'docker exec -it -u hermes gtmworks-engine-first hermes';
const signIns = (chatgpt: SubscriptionState, claude: SubscriptionState): CompanySignIns['signIns'] =>
  ({ 'openai-codex': { state: chatgpt, flow: 'device_code' }, anthropic: { state: claude, flow: 'external' } });
const section = (props: { owner: boolean, oneCompany: boolean, signIns: CompanySignIns['signIns'] }, language: 'en' | 'ar' = 'en') =>
  render(<LanguageProvider language={language}><CompanySubscriptions company="c-1" profile={profile} {...props}/></LanguageProvider>);
const stateOf = (provider: string) => document.querySelector(`#sub-${provider}-state`)?.textContent;
const buttons = () => [...document.querySelectorAll('#md-subscriptions button')].map(button => button.getAttribute('aria-label'));

test('on an install with one company a root sign-in is Connected with Disconnect, no shared warning, and Claude\'s command names no profile', async () => {
  const sent: object[] = [];
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return Promise.resolve(new Response(JSON.stringify({ status: 'disconnected' }))); });
  const screen = await section({ owner: true, oneCompany: true, signIns: signIns('connected', 'notConnected') });
  await expect.element(screen.getByText(en.signInConnected, { exact: true })).toBeVisible();
  expect(buttons()).toEqual(['Disconnect ChatGPT']);
  expect(document.querySelector('#sub-shared')).toBeNull();
  expect(document.querySelector('#md-subscriptions > .set-hint')?.textContent).toBe(`${en.signInHint} ${en.signInOneCompany}`);
  expect(document.querySelector('#sub-anthropic code')?.textContent).toBe(`${command} auth add anthropic --type oauth --no-browser`);
  await screen.getByRole('button', { name: 'Disconnect ChatGPT' }).click();
  await expect.poll(() => refresh.mock.calls.length).toBe(1);
  expect(sent).toEqual([{ company: 'c-1', provider: 'openai-codex', intent: 'disconnect' }]);
});

test('an older sign-in that serves the main agent only says so, and offers Disconnect and Connect again', async () => {
  const screen = await section({ owner: true, oneCompany: true, signIns: signIns('mainAgentOnly', 'mainAgentOnly') });
  await expect.poll(() => stateOf('openai-codex')).toBe(en.signInMainAgentOnly);
  expect(stateOf('anthropic')).toBe(en.signInMainAgentOnly);
  expect(buttons()).toEqual(['Disconnect ChatGPT', 'Connect ChatGPT', 'Disconnect Claude']);
  await expect.element(screen.getByText(en.signInTerminalOnly)).toBeVisible();
  expect(document.querySelector('#sub-shared')).toBeNull();
  await screen.unmount();
  await section({ owner: true, oneCompany: true, signIns: signIns('mainAgentOnly', 'connected') }, 'ar');
  await expect.poll(() => stateOf('openai-codex')).toBe(ar.signInMainAgentOnly);
  expect(document.querySelector('#md-subscriptions > .set-hint')?.textContent).toBe(`${ar.signInHint} ${ar.signInOneCompany}`);
});

test('a sign-in a stopped Disconnect left in an Agent\'s own profile says so, and keeps Disconnect and Connect again', async () => {
  const screen = await section({ owner: true, oneCompany: true, signIns: signIns('someAgentsOnly', 'notConnected') });
  await expect.poll(() => stateOf('openai-codex')).toBe(en.signInSomeAgentsOnly);
  expect(buttons()).toEqual(['Disconnect ChatGPT', 'Connect ChatGPT']);
  await screen.unmount();
});

test('on an install with several companies a root sign-in is shared: the warning shows and no button does', async () => {
  const screen = await section({ owner: true, oneCompany: false, signIns: signIns('shared', 'notConnected') });
  await expect.element(screen.getByRole('note')).toHaveTextContent(en.signInSharedWarning);
  expect(stateOf('openai-codex')).toBe(en.signInShared);
  expect(buttons()).toEqual([]);
  expect(document.querySelector('#sub-anthropic code')?.textContent).toBe(`${command} -p ${profile} auth add anthropic --type oauth --no-browser`);
  expect(document.querySelector('#md-subscriptions > .set-hint')?.textContent).toBe(`${en.signInHint} ${en.signInOwnSpace}`);
});

test('a member who is not the Owner reads each state and gets no button and no command', async () => {
  for (const [chatgpt, claude] of [['connected', 'mainAgentOnly'], ['notConnected', 'notConnected']] as const) {
    const screen = await section({ owner: false, oneCompany: true, signIns: signIns(chatgpt, claude) });
    await expect.poll(() => stateOf('openai-codex')).toBe(chatgpt === 'connected' ? en.signInConnected : en.signInNotConnected);
    expect(stateOf('anthropic')).toBe(claude === 'mainAgentOnly' ? en.signInMainAgentOnly : en.signInNotConnected);
    expect(buttons()).toEqual([]);
    expect(document.querySelector('#md-subscriptions code')).toBeNull();
    await screen.unmount();
  }
});
