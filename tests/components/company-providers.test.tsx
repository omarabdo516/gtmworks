import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { CompanyProviders, type ProviderKeysData, type ProviderModelsData } from '@/app/settings-providers';
import { LanguageProvider } from '@/lib/i18n-client';
import type { CompanySignIns, SubscriptionState } from '@/lib/company-sign-in.mjs';
import en from '@/lib/messages/en.json';
import ar from '@/lib/messages/ar.json';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

// Settings, Subscription and models: the Company's Providers as one list with the chosen one's details (#617).
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }) }));
afterEach(() => { refresh.mockReset(); vi.unstubAllGlobals(); });

const company = 'c-1';
const companyName = 'RS Learning';
const command = `gtmworks sign-in claude --company "${companyName}"`;
const secret = 'sk-or-v1-component-test-0123456789abcdef';
const signIns = (chatgpt: SubscriptionState, claude: SubscriptionState): CompanySignIns['signIns'] =>
  ({ 'openai-codex': { state: chatgpt, flow: 'device_code' }, anthropic: { state: claude, flow: 'external' } });
const keys = (extra: Partial<ProviderKeysData> = {}): ProviderKeysData => ({
  keys: [{ provider: 'openrouter', label: 'OpenRouter', set: false }, { provider: 'anthropic', label: 'Anthropic', set: true }],
  waiting: null, leftover: null, unknown: null, ...extra,
});
type Props = { owner?: boolean, signIns?: CompanySignIns['signIns'], available?: boolean, noEngine?: boolean, keys?: ProviderKeysData | null, models?: ProviderModelsData | null };
const providers = async ({ owner = true, signIns: signed = signIns('connected', 'notConnected'), available = true, noEngine = false, keys: held = keys(), models = null }: Props = {}, language: 'en' | 'ar' = 'en', width = 1440) => {
  await page.viewport(width, 900);
  return render(<div className="gw" dir={language === 'ar' ? 'rtl' : 'ltr'}><div className="sov"><div className="sov-page sov-page--models"><LanguageProvider language={language}>
    <CompanyProviders company={company} companyName={companyName} owner={owner} keys={held} models={models} subscriptions={{ available, signIns: signed, noEngine }}/>
    <section className="dp-sec" id="md-below">Below</section>
  </LanguageProvider></div></div></div>);
};
const rows = () => [...document.querySelectorAll<HTMLElement>('#md-providers .pv-row')].map(row => row.innerText.replace(/\s+/g, ' ').trim());
const shown = () => [...document.querySelectorAll<HTMLElement>('.pv-detail')].filter(detail => !detail.hidden).map(detail => detail.id);
const visible = (selector: string) => { const node = document.querySelector<HTMLElement>(selector); return !!node && node.getClientRects().length > 0; };
const buttons = (detail: string) => [...document.querySelectorAll(`#${detail} button`)].map(button => button.getAttribute('aria-label') || button.textContent);

test('the list shows each connected subscription and held key with its type and status, and a desktop shows the first one\'s details beside it', async () => {
  const screen = await providers({ signIns: signIns('connected', 'mainAgentOnly') });
  expect(rows()).toEqual([`ChatGPT ${en.providersSubscription} · ${en.signInConnected}`, `Claude ${en.providersSubscription} · ${en.providersPartly}`,
    `Anthropic ${en.providersKey} · ${en.providersKeySaved}`, en.providersAdd]);
  expect(document.querySelector('#pv-row-sub-openai-codex')?.getAttribute('aria-current')).toBe('true');
  expect(shown()).toEqual(['pv-d-sub-openai-codex']);
  expect(visible('.pv-list') && visible('#pv-d-sub-openai-codex')).toBe(true);
  // Its header: the brand's own mark, named, and its name; one Back is drawn only for a phone.
  const head = screen.getByRole('region', { name: 'ChatGPT' });
  await expect.element(head.getByRole('heading', { name: 'ChatGPT' })).toBeVisible();
  await expect.element(head.getByRole('img', { name: 'ChatGPT' })).toBeVisible();
  expect(visible('#pv-d-sub-openai-codex .pv-back')).toBe(false);
  expect(document.querySelector('#sub-openai-codex-state')?.textContent).toBe(en.signInConnected);
  expect(buttons('pv-d-sub-openai-codex')).toEqual([en.providers, 'Disconnect ChatGPT']);
  // Advanced is closed until opened, and names the Provider as the Engine does.
  const advanced = document.querySelector<HTMLDetailsElement>('#pv-d-sub-openai-codex-adv');
  expect(advanced?.open).toBe(false);
  await head.getByText(en.providersAdvanced).click();
  await expect.poll(() => advanced?.open).toBe(true);
  await expect.element(head.getByText('openai-codex', { exact: true })).toBeVisible();
  // Choosing another row shows its details instead; the partial sign-in says what it means and offers both ways out.
  await screen.getByRole('button', { name: /^Claude/ }).click();
  expect(shown()).toEqual(['pv-d-sub-anthropic']);
  expect(document.querySelector('#sub-anthropic-state')?.textContent).toBe(en.signInMainAgentOnly);
  await expect.element(screen.getByRole('region', { name: 'Claude' }).getByText(command)).toBeVisible();
  expect(document.activeElement?.id).toBe('pv-row-sub-anthropic');
});

test('a sign-in a stopped Disconnect left in an Agent\'s own profile reads partly connected, and keeps Disconnect and Connect again', async () => {
  const screen = await providers({ signIns: signIns('someAgentsOnly', 'notConnected') });
  expect(rows()[0]).toBe(`ChatGPT ${en.providersSubscription} · ${en.providersPartly}`);
  expect(document.querySelector('#sub-openai-codex-state')?.textContent).toBe(en.signInSomeAgentsOnly);
  expect(buttons('pv-d-sub-openai-codex')).toEqual([en.providers, 'Disconnect ChatGPT', 'Connect ChatGPT']);
  // Its Advanced says what a subscription is, and that one account serves one Company, in both languages.
  expect(document.querySelector('#pv-d-sub-openai-codex-adv .set-hint')?.textContent).toBe(`${en.signInWhat} ${en.signInHint} ${en.signInOneAccount}`);
  await screen.unmount();
  await providers({ signIns: signIns('connected', 'notConnected') }, 'ar');
  expect(document.querySelector('#pv-d-sub-openai-codex-adv .set-hint')?.textContent).toBe(`${ar.signInWhat} ${ar.signInHint} ${ar.signInOneAccount}`);
});

test('a held key\'s details say it is a key, the Owner removes or replaces it, and the value typed is sent once and never drawn', async () => {
  const sent: object[] = [];
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return Promise.resolve(new Response('{}')); });
  const screen = await providers();
  await screen.getByRole('button', { name: /^Anthropic/ }).click();
  const detail = screen.getByRole('region', { name: 'Anthropic' });
  await expect.element(detail.getByText(en.providersKey, { exact: true }).first()).toBeVisible();
  expect(document.querySelector('#mdl-key-anthropic-state')?.textContent).toBe(en.settingsModelsKeySet);
  await detail.getByRole('button', { name: en.settingsModelsKeyReplace }).click();
  await detail.getByLabelText(en.settingsModelsKeyValue).fill(secret);
  await detail.getByRole('button', { name: en.settingsModelsKeySave }).click();
  await expect.poll(() => refresh.mock.calls.length).toBe(1);
  expect(sent).toEqual([{ company, provider: 'anthropic', intent: 'set', value: secret }]);
  await expect.poll(() => document.querySelector('#mdl-key-anthropic-value')).toBeNull();
  await expect.poll(() => document.body.innerHTML.includes(secret)).toBe(false);
  await detail.getByRole('button', { name: 'Remove the Anthropic key' }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toEqual({ company, provider: 'anthropic', intent: 'remove' });
});

test('a key the Engine refused leaves the field empty with the reason, so the value typed stays nowhere on the page', async () => {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ error: 'keyFailed' }), { status: 502 })));
  const screen = await providers();
  await screen.getByRole('button', { name: /^Anthropic/ }).click();
  const detail = screen.getByRole('region', { name: 'Anthropic' });
  await detail.getByRole('button', { name: en.settingsModelsKeyReplace }).click();
  await detail.getByLabelText(en.settingsModelsKeyValue).fill(secret);
  await detail.getByRole('button', { name: en.settingsModelsKeySave }).click();
  await expect.element(detail.getByRole('alert')).toHaveTextContent(en.settingsModelsKeyError);
  expect((document.getElementById('mdl-key-anthropic-value') as HTMLInputElement).value).toBe('');
  expect(document.body.innerHTML.includes(secret)).toBe(false);
  expect(refresh).not.toHaveBeenCalled();
});

test('the Owner\'s last row connects what is not connected yet: a subscription by sign-in, a provider by its key', async () => {
  const sent: object[] = [];
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return Promise.resolve(new Response('{}')); });
  const screen = await providers({ keys: keys({ waiting: [{ agent: 'a-1', name: 'Writer' }] }) });
  await screen.getByRole('button', { name: en.providersAdd }).click();
  const add = screen.getByRole('region', { name: en.providersAdd });
  expect(document.querySelector('#pv-d-add #sub-openai-codex')).toBeNull();
  await expect.element(add.getByText(command)).toBeVisible();
  await expect.element(add.getByRole('img', { name: 'Claude' })).toBeVisible();
  expect(document.querySelector('#pv-d-add #mdl-key-anthropic-state')).toBeNull();
  expect(document.querySelector('#mdl-key-openrouter-state')?.textContent).toBe(en.settingsModelsKeyUnset);
  await add.getByRole('button', { name: en.settingsModelsKeyGive }).click();
  await add.getByLabelText(en.settingsModelsKeyValue).fill(secret);
  await add.getByRole('button', { name: en.settingsModelsKeySave }).click();
  await expect.poll(() => refresh.mock.calls.length).toBe(1);
  expect(sent).toEqual([{ company, provider: 'openrouter', intent: 'set', value: secret }]);
  await expect.poll(() => document.body.innerHTML.includes(secret)).toBe(false);
  // An Agent made since the last key waits for it, named under the list.
  await expect.element(screen.getByText(new RegExp(en.settingsModelsKeyWaiting))).toBeVisible();
});

test('with nothing connected the list says so and the Owner\'s desktop opens on what to connect', async () => {
  await providers({ signIns: signIns('notConnected', 'notConnected'), keys: keys({ keys: [{ provider: 'openrouter', label: 'OpenRouter', set: false }] }) });
  expect(rows()).toEqual([en.providersAdd]);
  expect(document.getElementById('pv-none')?.textContent).toBe(en.providersNone);
  expect(shown()).toEqual(['pv-d-add']);
  expect(buttons('pv-d-add')).toContain('Connect ChatGPT');
});

test('a Provider connected from the Owner\'s last row opens in its place once the page reads it again', async () => {
  const none = keys({ keys: [{ provider: 'openrouter', label: 'OpenRouter', set: false }] });
  const screen = await providers({ signIns: signIns('notConnected', 'notConnected'), keys: none });
  expect(shown()).toEqual(['pv-d-add']);
  await screen.rerender(<div className="gw" dir="ltr"><div className="sov"><div className="sov-page sov-page--models"><LanguageProvider language="en">
    <CompanyProviders company={company} companyName={companyName} owner keys={keys({ keys: [{ provider: 'openrouter', label: 'OpenRouter', set: true }] })}
      subscriptions={{ available: true, signIns: signIns('notConnected', 'notConnected'), noEngine: false }}/>
  </LanguageProvider></div></div></div>);
  await expect.poll(shown).toEqual(['pv-d-key-openrouter']);
  expect(document.querySelector('#pv-row-key-openrouter')?.getAttribute('aria-current')).toBe('true');
});

test('on a phone, a Provider connected from the last row opens with the focus on its name', async () => {
  const none = keys({ keys: [{ provider: 'openrouter', label: 'OpenRouter', set: false }] });
  const view = (held: ProviderKeysData) => <div className="gw" dir="ltr"><div className="sov"><div className="sov-page sov-page--models"><LanguageProvider language="en">
    <CompanyProviders company={company} companyName={companyName} owner keys={held} subscriptions={{ available: true, signIns: signIns('notConnected', 'notConnected'), noEngine: false }}/>
  </LanguageProvider></div></div></div>;
  const screen = await providers({ signIns: signIns('notConnected', 'notConnected'), keys: none }, 'en', 390);
  await screen.getByRole('button', { name: en.providersAdd }).click();
  await expect.poll(() => document.activeElement?.id).toBe('pv-d-add-name');
  await screen.rerender(view(keys({ keys: [{ provider: 'openrouter', label: 'OpenRouter', set: true }] })));
  await expect.poll(() => document.activeElement?.id).toBe('pv-d-key-openrouter-name');
  expect(visible('.pv-list')).toBe(false);
});

test('on a phone the list comes first; a row opens its details with its name and one Back, and Back returns to the row', async () => {
  const screen = await providers({}, 'ar', 390);
  expect(visible('.pv-list')).toBe(true);
  expect(visible('.pv-details')).toBe(false);
  expect(visible('#md-below')).toBe(true);
  await screen.getByRole('button', { name: /^ChatGPT/ }).click();
  await expect.poll(() => document.activeElement?.id).toBe('pv-d-sub-openai-codex-name');
  expect(visible('.pv-list')).toBe(false);
  expect(visible('#md-below')).toBe(false);
  expect(visible('#md-h-pv')).toBe(false);
  const backs = [...document.querySelectorAll<HTMLElement>('.pv-back')].filter(back => back.getClientRects().length > 0);
  expect(backs.map(back => back.textContent)).toEqual([ar.providers]);
  // Nothing runs off the side of a phone, in Arabic too.
  const panel = document.querySelector<HTMLElement>('#md-providers')!;
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
  await backs[0].click();
  await expect.poll(() => document.activeElement?.id).toBe('pv-row-sub-openai-codex');
  expect(visible('.pv-list') && visible('#md-below')).toBe(true);
  expect(visible('.pv-details')).toBe(false);
});

test('a member who is not the Owner reads every Provider\'s state, with no control, no row to connect and no command', async () => {
  for (const language of ['en', 'ar'] as const) {
    const messages = language === 'en' ? en : ar;
    const screen = await providers({ owner: false, signIns: signIns('connected', 'mainAgentOnly'), keys: keys({ waiting: null }) }, language);
    expect(document.querySelector('#pv-row-add')).toBeNull();
    expect(document.querySelector('#pv-d-add')).toBeNull();
    for (const detail of ['pv-d-sub-openai-codex', 'pv-d-sub-anthropic', 'pv-d-key-anthropic'])
      expect(buttons(detail)).toEqual([messages.providers]);
    expect(document.querySelector('#md-providers code.sub-code')).toBeNull();
    expect(document.querySelector('#md-providers input')).toBeNull();
    expect(document.querySelector('#sub-anthropic-state')?.textContent).toBe(messages.signInMainAgentOnly);
    await expect.element(screen.getByText(messages.providersOwnerOnly)).toBeVisible();
    await screen.unmount();
  }
});

test('when the company\'s engine is not running, one notice says so in both languages and no Provider or control is drawn', async () => {
  for (const [language, text] of [['en', en.noEngine], ['ar', ar.noEngine]] as const) {
    const screen = await providers({ available: false, signIns: null, noEngine: true, keys: null }, language);
    await expect.element(screen.getByRole('note')).toHaveTextContent(text);
    expect(document.querySelectorAll('#md-providers button').length).toBe(0);
    expect(document.querySelector('#md-providers code')).toBeNull();
    await screen.unmount();
  }
});

test('an Engine without the Company\'s profile still lists the held keys and says sign-in is unavailable where the Owner connects', async () => {
  const screen = await providers({ available: false, signIns: null });
  expect(rows()).toEqual([`Anthropic ${en.providersKey} · ${en.providersKeySaved}`, en.providersAdd]);
  await screen.getByRole('button', { name: en.providersAdd }).click();
  await expect.element(screen.getByRole('region', { name: en.providersAdd }).getByText(en.signInNoProfile)).toBeVisible();
  expect(buttons('pv-d-add')).not.toContain('Connect ChatGPT');
});

test('a sign-in or key read that failed is said under the list for every Role, never read as nothing connected', async () => {
  for (const owner of [true, false]) {
    const screen = await providers({ owner, signIns: null, keys: keys({ keys: null }) });
    expect(document.getElementById('pv-none')).toBeNull();
    expect(document.getElementById('pv-no-profile')?.textContent).toBe(en.signInUnknown);
    expect(document.getElementById('pv-keys-unread')?.textContent).toBe(en.settingsModelsKeyUnread);
    await screen.unmount();
  }
  await providers({ owner: false, available: false, signIns: null });
  expect(document.getElementById('pv-no-profile')?.textContent).toBe(en.signInNoProfile);
  expect(rows()).toEqual([`Anthropic ${en.providersKey} · ${en.providersKeySaved}`]);
});

test('a Claude subscription with an Anthropic key says the subscription is used first and the key is the paid fallback, in both languages (#438)', async () => {
  for (const [language, messages] of [['en', en], ['ar', ar]] as const) {
    const screen = await providers({ signIns: signIns('connected', 'connected') }, language);
    expect(document.querySelector('#pv-d-sub-anthropic #sub-anthropic-order')?.textContent).toBe(messages.signInKeyFallback);
    expect(document.querySelector('#sub-openai-codex-order')).toBeNull();
    await screen.unmount();
  }
  const screen = await providers({ signIns: signIns('connected', 'connected'), keys: keys({ keys: [{ provider: 'anthropic', label: 'Anthropic', set: false }] }) });
  expect(document.querySelector('#sub-anthropic-order')).toBeNull();
  await screen.unmount();
});

// #424: every Provider shows its brand's own mark, named in its details and with what is not connected yet; a provider
// with no logo keeps its first letter. In the list the name is beside the mark, so the mark is not read out again.
test('each Provider shows its own brand mark, named, or its first letter', async () => {
  const held = [{ provider: 'openrouter', label: 'OpenRouter', set: true }, { provider: 'anthropic', label: 'Anthropic', set: true },
    { provider: 'nvidia', label: 'NVIDIA NIM', set: false }, { provider: 'moa', label: 'Mixture of Agents', set: true }];
  await providers({ signIns: signIns('connected', 'connected'), keys: keys({ keys: held }) });
  const tile = (selector: string) => { const found = document.querySelector(`${selector} .tool-tile`); return [found?.getAttribute('aria-label'), found?.querySelector('img.tool-logo')?.getAttribute('src') ?? (found?.querySelector('svg.tool-logo') ? 'svg' : found?.textContent)]; };
  expect(['sub-openai-codex', 'sub-anthropic', 'key-openrouter', 'key-anthropic', 'key-moa'].map(id => tile(`#pv-d-${id} .pv-head`))).toEqual([
    ['ChatGPT', 'svg'], ['Claude', 'svg'], ['OpenRouter', '/logos/lobe/openrouter-color.svg'], ['Anthropic', '/logos/lobe/anthropic.svg'], ['Mixture of Agents', 'M']]);
  expect(tile('#mdl-key-row-nvidia')).toEqual(['NVIDIA NIM', '/logos/lobe/nvidia-color.svg']);
  expect([...document.querySelectorAll('.pv-list .tool-tile')].every(found => found.getAttribute('aria-hidden') === 'true')).toBe(true);
  const loaded = [...document.querySelectorAll<HTMLImageElement>('img.tool-logo')];
  await expect.poll(() => loaded.every(image => image.complete && image.naturalWidth > 0)).toBe(true);
});

// #620: each Provider's models, each with the Owner's switch; another Role reads each one.
const claudeModels: ProviderModelsData = {
  'sub-anthropic': [{ model: 'claude-opus-4-6', enabled: true }, { model: 'claude-sonnet-4-6', enabled: false }],
  'key-anthropic': [{ model: 'claude-opus-4-6', enabled: true }, { model: 'claude-sonnet-4-6', enabled: true }],
};
const switchOf = (detail: string, model: string, name: string) => document.querySelector<HTMLButtonElement>(`#${detail} [role="switch"][aria-label="${en.providersModelSwitch.replace('{0}', model).replace('{1}', name)}"]`);

test('the Owner switches one Provider\'s model off and on, each change sent once and the page read again', async () => {
  const sent: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }));
  const screen = await providers({ signIns: signIns('notConnected', 'connected'), models: claudeModels });
  expect(shown()).toEqual(['pv-d-sub-anthropic']);
  await expect.element(screen.getByRole('region', { name: 'Claude' }).getByRole('heading', { name: en.providersModels })).toBeVisible();
  expect(switchOf('pv-d-sub-anthropic', 'claude-opus-4-6', 'Claude')?.getAttribute('aria-checked')).toBe('true');
  expect(switchOf('pv-d-sub-anthropic', 'claude-sonnet-4-6', 'Claude')?.getAttribute('aria-checked')).toBe('false');
  switchOf('pv-d-sub-anthropic', 'claude-opus-4-6', 'Claude')!.click();
  await expect.poll(() => refresh.mock.calls.length).toBe(1);
  expect(sent).toEqual([{ company, entry: 'sub-anthropic', model: 'claude-opus-4-6', enabled: false }]);
  expect(switchOf('pv-d-sub-anthropic', 'claude-opus-4-6', 'Claude')?.getAttribute('aria-checked')).toBe('false');
  // The key's own switches are its own: the same model stays on there.
  await screen.getByRole('button', { name: /^Anthropic/ }).click();
  expect(switchOf('pv-d-key-anthropic', 'claude-opus-4-6', 'Anthropic')?.getAttribute('aria-checked')).toBe('true');
  switchOf('pv-d-key-anthropic', 'claude-sonnet-4-6', 'Anthropic')!.click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toEqual({ company, entry: 'key-anthropic', model: 'claude-sonnet-4-6', enabled: false });
});

test('a switch the server refuses goes back and says why; a Manager reads each switch and has none', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'providerModelFailed' }), { status: 502 })));
  const screen = await providers({ signIns: signIns('notConnected', 'connected'), models: claudeModels });
  switchOf('pv-d-sub-anthropic', 'claude-opus-4-6', 'Claude')!.click();
  await expect.element(screen.getByRole('alert')).toHaveTextContent(en.providersModelError);
  expect(switchOf('pv-d-sub-anthropic', 'claude-opus-4-6', 'Claude')?.getAttribute('aria-checked')).toBe('true');
  expect(refresh).not.toHaveBeenCalled();
  await screen.unmount();
  await providers({ owner: false, signIns: signIns('notConnected', 'connected'), models: claudeModels }, 'ar');
  expect(document.querySelectorAll('#pv-d-sub-anthropic [role="switch"]').length).toBe(0);
  expect([...document.querySelectorAll<HTMLElement>('#pv-d-sub-anthropic-models li')].map(row => row.innerText.replace(/\s+/g, ' ').trim()))
    .toEqual([`claude-opus-4-6 ${ar.providersModelOn}`, `claude-sonnet-4-6 ${ar.providersModelOff}`]);
});

test('a Provider whose models could not be read says so, and one listing none says that', async () => {
  await providers({ signIns: signIns('notConnected', 'connected'), models: null });
  expect(document.querySelector('#pv-d-sub-anthropic')?.textContent).toContain(en.providersModelsUnread);
  document.body.innerHTML = '';
  await providers({ signIns: signIns('notConnected', 'connected'), models: { 'sub-anthropic': [] } });
  expect(document.querySelector('#pv-d-sub-anthropic')?.textContent).toContain(en.providersModelsNone);
});
