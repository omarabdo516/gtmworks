import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { ProviderKeys, DefaultModel, EachAgent, AgentModel, DefaultEffort, type AgentModels, type ModelOption } from '@/app/settings-models';
import { LanguageProvider } from '@/lib/i18n-client';
import { ToastHost } from '@/app/toast';
import en from '@/lib/messages/en.json';
import ar from '@/lib/messages/ar.json';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

// #29: Subscription and models as components. The Owner gives a key without it ever being drawn back, chooses the
// Company's default and each Agent's model, and turns sub-agents on for one Agent; a member reads every value and has no
// control.
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }) }));
afterEach(() => { refresh.mockReset(); vi.unstubAllGlobals(); });

const company = '10000000-0000-0000-0000-000000000001';
const key = 'sk-or-v1-component-test-0123456789abcdef';
const options: ModelOption[] = [
  { provider: 'openrouter', providerName: 'OpenRouter', model: 'openai/gpt-5.5' },
  { provider: 'anthropic', providerName: 'Anthropic', model: 'claude-opus-4-6' },
];
const keysData = {
  keys: [{ provider: 'openrouter', label: 'OpenRouter', set: false }, { provider: 'anthropic', label: 'Anthropic', set: true }],
  waiting: [{ agent: 'a-1', name: 'Writer' }], leftover: null, unknown: null,
};
const agent = (extra: Partial<AgentModels> = {}): AgentModels => ({
  id: 'a-1', name: 'Writer', own: true, choosable: true, model: 'openrouter/openai/gpt-5.5', choice: null,
  subagents: false, options, effort: 'medium', settings: [], ...extra,
});
const stub = (body: object = { ok: true }) => {
  const sent: { url: string, body: object }[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => { sent.push({ url, body: JSON.parse(String(init.body)) as object }); return Promise.resolve(new Response(JSON.stringify(body), { status: 200 })); });
  return sent;
};
const renderNode = (node: React.ReactNode, language: 'en' | 'ar' = 'en') => render(<LanguageProvider language={language}>{node}</LanguageProvider>);

test('the Owner gives a provider key: it is sent once and never drawn, and each provider says whether one is set', async () => {
  const sent = stub();
  const screen = await renderNode(<ProviderKeys company={company} owner data={keysData}/>);
  await expect.element(screen.getByText(en.settingsModelsKeyUnset, { exact: true })).toBeVisible();
  await expect.element(screen.getByText(en.settingsModelsKeySet, { exact: true })).toBeVisible();
  await screen.getByRole('button', { name: en.settingsModelsKeyGive }).click();
  await screen.getByLabelText(en.settingsModelsKeyValue).fill(key);
  await screen.getByRole('button', { name: en.settingsModelsKeySave }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ url: '/api/provider-keys', body: { company, provider: 'openrouter', intent: 'set', value: key } });
  await expect.poll(() => refresh.mock.calls.length).toBe(1);
  expect(document.body.textContent).not.toContain(key);
  await expect.poll(() => (document.getElementById('mdl-key-openrouter-value') as HTMLInputElement | null)?.value ?? '').toBe('');
  await expect.element(screen.getByText(new RegExp(en.settingsModelsKeyWaiting))).toBeVisible();
  await screen.unmount();
  await renderNode(<ProviderKeys company={company} owner={false} data={keysData}/>, 'ar');
  expect(document.querySelector('#mdl-key-row-openrouter input')).toBeNull();
  expect(document.querySelector('#mdl-key-row-openrouter button')).toBeNull();
  await expect.element(page.getByText(ar.settingsModelsKeyOwnerOnly)).toBeVisible();
  await expect.element(page.getByText(ar.settingsModelsKeySet, { exact: true })).toBeVisible();
});

test('the Company default is the Engine\'s list for its space: the Owner picks one, every other member reads it', async () => {
  const sent = stub();
  const models = { model: 'openrouter/openai/gpt-5.5', options };
  const screen = await renderNode(<DefaultModel company={company} owner models={models}/>);
  const chosen = screen.getByRole('radio', { name: /claude-opus-4-6/ });
  await chosen.click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ url: '/api/agent-settings', body: { company, setting: 'model', value: 'anthropic/claude-opus-4-6' } });
  await screen.unmount();
  await renderNode(<DefaultModel company={company} owner={false} models={models}/>);
  expect(document.querySelectorAll('[role=radio]')).toHaveLength(0);
  expect(document.querySelector('[aria-current=true]')?.textContent).toContain('gpt-5.5');
  await expect.element(page.getByText(en.settingsModelsOwnerOnly)).toBeVisible();
});

test('each Agent\'s model is chosen from its own profile\'s list, and following the default again is a choice too', async () => {
  const sent = stub();
  const screen = await renderNode(<EachAgent company={company} owner models={{ default: { model: 'openrouter/openai/gpt-5.5', options }, agents: [agent()] }}/>);
  await screen.getByRole('combobox', { name: en.settingsModelsModelField.replace('{0}', 'Writer') }).selectOptions('anthropic/claude-opus-4-6');
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ url: '/api/agent-settings', body: { company, agent: 'a-1', setting: 'model', value: 'anthropic/claude-opus-4-6' } });
  await screen.getByRole('combobox', { name: en.settingsModelsModelField.replace('{0}', 'Writer') }).selectOptions('');
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1].body).toEqual({ company, agent: 'a-1', setting: 'model', value: null });
  await expect.element(page.getByText(new RegExp(en.settingsModelsShared))).not.toBeInTheDocument();
});

test('sub-agents are off until the Owner turns them on: the switch is sent, and then the Engine\'s settings show', async () => {
  const sent = stub();
  const screen = await renderNode(<EachAgent company={company} owner models={{ default: { model: 'openrouter/openai/gpt-5.5', options }, agents: [agent()] }}/>);
  const toggle = screen.getByRole('switch', { name: en.settingsSubagents });
  await expect.element(toggle).toHaveAttribute('aria-checked', 'false');
  expect(document.getElementById('mdl-sub-a-1-settings')).toBeNull();
  await toggle.click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].body).toEqual({ company, agent: 'a-1', setting: 'subagents', value: true });
  await screen.unmount();
  const settings = [
    { key: 'delegation.model', type: 'string' as const, choices: null, default: '', value: '', limits: null, label: 'settingSubagentModel' },
    { key: 'delegation.provider', type: 'string' as const, choices: null, default: '', value: '', limits: null, label: 'settingSubagentProvider' },
    { key: 'delegation.max_concurrent_children', type: 'number' as const, choices: null, default: 10, value: 10, limits: { min: 1, integer: true }, label: 'settingSubagentLimit' },
    { key: 'delegation.reasoning_effort', type: 'select' as const, choices: ['', 'low', 'high'], default: '', value: 'high', limits: null, label: 'settingSubagentEffort' },
    { key: 'delegation.max_spawn_depth', type: 'number' as const, choices: null, default: 1, value: 1, limits: { min: 1, integer: true }, label: 'settingSubagentDepth' },
  ];
  const on = await renderNode(<EachAgent company={company} owner models={{ default: { model: 'openrouter/openai/gpt-5.5', options }, agents: [agent({ subagents: true, settings })] }}/>, 'ar');
  await expect.element(on.getByText(ar.settingSubagentEffort)).toBeVisible();
  expect((document.getElementById('mdl-sub-a-1-max_concurrent_children') as HTMLInputElement).value).toBe('10');
  await expect.element(on.getByText(ar.settingsSubagentsAtOnce.replace('{0}', '10'))).toBeVisible();
  expect(document.getElementById('mdl-sub-a-1-effort')).not.toBeNull();
});

test('a member below Owner reads every model and the sub-agents state with no control', async () => {
  const settings = [{ key: 'delegation.max_concurrent_children', type: 'number' as const, choices: null, default: 10, value: 4, limits: { min: 1, integer: true }, label: 'settingSubagentLimit' }];
  await renderNode(<EachAgent company={company} owner={false} models={{ default: { model: 'openrouter/openai/gpt-5.5', options }, agents: [agent({ subagents: true, settings })] }}/>);
  expect(document.querySelectorAll('[role=switch]')).toHaveLength(0);
  expect(document.querySelectorAll('select')).toHaveLength(0);
  expect(document.querySelector('#mdl-sub-a-1-state')?.textContent).toBe(en.settingsSubagentsOn);
  await expect.element(page.getByText(en.settingsModelsOwn)).not.toBeInTheDocument();
  expect(document.body.textContent).toContain('4');
  expect(document.body.textContent).not.toContain(key);
});

test('the default names the Agents it did not reach and the Owner can send it again, with no success toast until it lands', async () => {
 const bodies: object[] = [];
 vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
  bodies.push(JSON.parse(String(init.body)) as object);
  const failed = bodies.length === 1 ? [{ agent: 'a-2', name: 'Critic' }] : [];
  return Promise.resolve(new Response(JSON.stringify({ agents: [{ agent: 'a-1', name: 'Writer', written: failed.length === 0 }], failed }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
 });
 const screen = await renderNode(<><ToastHost/><DefaultModel company={company} owner models={{ model: 'openrouter/openai/gpt-5.5', options }}/></>);
 await screen.getByRole('radio', { name: /claude-opus-4-6/ }).click();
 await expect.element(screen.getByText(en.settingsModelsNotReached.replace('{0}', 'Critic'))).toBeVisible();
 expect(document.querySelector('.toast')?.textContent ?? '').not.toContain(en.settingsModelsSaved);
 await screen.getByRole('button', { name: en.settingsModelsRetry }).click();
 await expect.poll(() => bodies.length).toBe(2);
 expect(bodies[1]).toEqual(bodies[0]);
 await expect.poll(() => document.querySelector('.toast')?.textContent ?? '').toContain(en.settingsModelsSaved);
 await expect.element(screen.getByText(en.settingsModelsNotReached.replace('{0}', 'Critic'))).not.toBeInTheDocument();
});

test('an Agent\'s "Thinks with" rows change its own profile\'s model, and an Agent on the Company profile only reads', async () => {
  const sent = stub();
  const screen = await renderNode(<AgentModel company={company} agent="a-1" name="Writer" model="openrouter/openai/gpt-5.5" options={options} choosable owner/>);
  await screen.getByRole('radio', { name: /claude-opus-4-6/ }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ url: '/api/agent-settings', body: { company, agent: 'a-1', setting: 'model', value: 'anthropic/claude-opus-4-6' } });
  await screen.unmount();
  await renderNode(<AgentModel company={company} agent="lead" name="Lead" model="openrouter/openai/gpt-5.5" options={[]} choosable={false} owner/>);
  expect(document.querySelectorAll('[role=radio]')).toHaveLength(0);
  expect(document.getElementById('set-model')?.textContent).toContain('gpt-5.5');
});

test('the model choices are one Tab stop and the arrow keys move and select them, left in Arabic', async () => {
 const sent = stub();
 const screen = await renderNode(<DefaultModel company={company} owner models={{ model: 'openrouter/openai/gpt-5.5', options }}/>);
 const first = screen.getByRole('radio', { name: /gpt-5.5/ });
 const second = screen.getByRole('radio', { name: /claude-opus-4-6/ });
 await expect.element(first).toHaveAttribute('aria-checked', 'true');
 expect(first.element().tabIndex).toBe(0);
 expect(second.element().tabIndex).toBe(-1);
 first.element().focus();
 await userEvent.keyboard('{ArrowDown}');
 await expect.poll(() => sent.length).toBe(1);
 expect(sent[0]).toEqual({ url: '/api/agent-settings', body: { company, setting: 'model', value: 'anthropic/claude-opus-4-6' } });
 expect(document.activeElement?.textContent).toContain('claude-opus-4-6');
 await screen.unmount();
 const arabic = await renderNode(<DefaultModel company={company} owner models={{ model: 'openrouter/openai/gpt-5.5', options }}/>, 'ar');
 arabic.getByRole('radio', { name: /gpt-5.5/ }).element().focus();
 await userEvent.keyboard('{ArrowLeft}');
 await expect.poll(() => sent.length).toBe(2);
 expect(sent[1].body).toEqual({ company, setting: 'model', value: 'anthropic/claude-opus-4-6' });
 await arabic.unmount();
 const agent = await renderNode(<AgentModel company={company} agent="a-1" name="Writer" model="openrouter/openai/gpt-5.5" options={options} choosable owner/>);
 const agentFirst = agent.getByRole('radio', { name: /gpt-5.5/ });
 const agentSecond = agent.getByRole('radio', { name: /claude-opus-4-6/ });
 expect(agentFirst.element().tabIndex).toBe(0);
 expect(agentSecond.element().tabIndex).toBe(-1);
 agentFirst.element().focus();
 await userEvent.keyboard('{ArrowRight}');
 await expect.poll(() => sent.length).toBe(3);
 expect(sent[2].body).toEqual({ company, agent: 'a-1', setting: 'model', value: 'anthropic/claude-opus-4-6' });
 expect(document.activeElement?.textContent).toContain('claude-opus-4-6');
});

test('a group with no model marked still gives its first choice the Tab stop and the keyboard can pick it', async () => {
 const sent = stub();
 const screen = await renderNode(<DefaultModel company={company} owner models={{ model: null, options }}/>);
 const first = screen.getByRole('radio', { name: /gpt-5.5/ });
 expect(first.element().tabIndex).toBe(0);
 expect(screen.getByRole('radio', { name: /claude-opus-4-6/ }).element().tabIndex).toBe(-1);
 first.element().focus();
 await userEvent.keyboard('{ArrowDown}');
 await expect.poll(() => sent.length).toBe(1);
 expect(sent[0].body).toEqual({ company, setting: 'model', value: 'openrouter/openai/gpt-5.5' });
 await screen.unmount();
 const agent = await renderNode(<AgentModel company={company} agent="a-1" name="Writer" model={null} options={options} choosable owner/>);
 const agentFirst = agent.getByRole('radio', { name: /gpt-5.5/ });
 expect(agentFirst.element().tabIndex).toBe(0);
 agentFirst.element().focus();
 await userEvent.keyboard('{ArrowDown}');
 await expect.poll(() => sent.length).toBe(2);
 expect(sent[1].body).toEqual({ company, agent: 'a-1', setting: 'model', value: 'openrouter/openai/gpt-5.5' });
});

test('each Agent in "Each agent" reads its model and its own thinking level', async () => {
 const agents = [agent({ effort: 'high' }), agent({ id: 'a-2', name: 'Critic', model: 'anthropic/claude-opus-4-6', effort: 'low' })];
 await renderNode(<EachAgent company={company} owner={false} models={{ default: { model: 'openrouter/openai/gpt-5.5', options }, agents }}/>);
 expect(document.getElementById('mdl-agent-a-1-model')?.textContent).toBe(`${en.settingsModelsFollows} · openrouter/openai/gpt-5.5 · ${en.settingsEffortHigh}`);
 expect(document.getElementById('mdl-agent-a-2-model')?.textContent).toBe(`${en.settingsModelsFollows} · anthropic/claude-opus-4-6 · ${en.settingsEffortLow}`);
});

test('the default thinking level is the reference\'s read-only Medium with its line, for every Role', async () => {
 const screen = await renderNode(<DefaultEffort/>);
 await expect.poll(() => document.getElementById('mdl-eff')?.textContent).toBe(en.settingsEffortMedium);
 await expect.element(screen.getByText(en.settingsEffortMediumHint)).toBeVisible();
 expect(document.querySelectorAll('[role=radio]')).toHaveLength(0);
 await screen.unmount();
 await renderNode(<DefaultEffort/>, 'ar');
 await expect.poll(() => document.getElementById('mdl-eff')?.textContent).toBe(ar.settingsEffortMedium);
 await expect.element(page.getByText(ar.settingsEffortMediumHint)).toBeVisible();
});

test('a sub-agent model is one choice that saves the provider and the bare model id apart, as the Engine reads them', async () => {
 const sent = stub();
 const settings = [
  { key: 'delegation.model', type: 'string' as const, choices: null, default: '', value: '', limits: null, label: 'settingSubagentModel' },
  { key: 'delegation.provider', type: 'string' as const, choices: null, default: '', value: '', limits: null, label: 'settingSubagentProvider' },
 ];
 const screen = await renderNode(<EachAgent company={company} owner models={{ default: { model: 'openrouter/openai/gpt-5.5', options }, agents: [agent({ subagents: true, settings })] }}/>);
 await screen.getByRole('combobox', { name: en.settingSubagentModel }).selectOptions('openrouter/openai/gpt-5.5');
 await expect.poll(() => sent.length).toBe(1);
 expect(sent[0]).toEqual({ url: '/api/agent-settings', body: { company, agent: 'a-1', settings: { 'delegation.provider': 'openrouter', 'delegation.model': 'openai/gpt-5.5' } } });
});
