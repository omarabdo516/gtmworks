import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { SpeechToText, DefaultModel, EachAgent, AgentModel, DefaultEffort, type AgentModels, type ModelOption } from '@/app/settings-models';
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

// #430: the Company's speech-to-text provider. Deepgram is first; the Owner picks one and pastes its key, which is sent
// once and never drawn; the provider in use can be removed; a member reads which one is in use with no control.
test('the Owner picks a speech-to-text provider with its key, Deepgram first; a member only reads it', async () => {
  const sent = stub({ provider: 'deepgram', missing: [] });
  const screen = await renderNode(<SpeechToText company={company} owner data={{ provider: null, missing: [] }}/>);
  expect([...document.querySelectorAll('#md-stt .md-key')].map(row => row.id)).toEqual(['mdl-stt-row-deepgram', 'mdl-stt-row-elevenlabs', 'mdl-stt-row-openai', 'mdl-stt-row-groq']);
  await expect.element(screen.getByText(en.settingsSpeechNone)).toBeVisible();
  await expect.element(screen.getByText(en.settingsSpeechDeepgram)).toBeVisible();
  await page.elementLocator(document.querySelector('#mdl-stt-row-deepgram .link-btn')!).click();
  await screen.getByLabelText(en.settingsModelsKeyValue).fill(key);
  await screen.getByRole('button', { name: en.settingsModelsKeySave }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ url: '/api/speech-provider', body: { company, provider: 'deepgram', intent: 'set', value: key } });
  await expect.poll(() => refresh.mock.calls.length).toBe(1);
  expect(document.body.textContent).not.toContain(key);
  await screen.unmount();
  const used = await renderNode(<SpeechToText company={company} owner data={{ provider: 'deepgram', missing: [{ agent: 'a-1', name: 'Writer' }] }}/>);
  await expect.element(used.getByText(en.settingsSpeechInUse)).toBeVisible();
  await expect.element(used.getByText(new RegExp(en.settingsSpeechMissing))).toBeVisible();
  await used.getByRole('button', { name: 'Remove the Deepgram Nova-3 key' }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toEqual({ url: '/api/speech-provider', body: { company, provider: 'deepgram', intent: 'remove' } });
  await used.unmount();
  await renderNode(<SpeechToText company={company} owner={false} data={{ provider: 'deepgram', missing: [] }}/>, 'ar');
  expect(document.querySelector('#md-stt input')).toBeNull();
  expect(document.querySelector('#md-stt button:not(.info__btn)')).toBeNull();
  await expect.element(page.getByText(ar.settingsSpeechOwnerOnly)).toBeVisible();
  await expect.element(page.getByText(ar.settingsSpeechInUse)).toBeVisible();
});

test('a speech-to-text change that misses an Agent names it and says to try again, with no success toast', async () => {
  stub({ provider: 'deepgram', missing: [], failed: [{ agent: 'a-1', name: 'Writer' }] });
  const screen = await renderNode(<><ToastHost/><SpeechToText company={company} owner data={{ provider: 'deepgram', missing: [] }}/></>);
  await screen.getByRole('button', { name: 'Remove the Deepgram Nova-3 key' }).click();
  await expect.element(screen.getByRole('alert')).toHaveTextContent(en.settingsSpeechNotReached.replace('{0}', 'Writer'));
  expect(screen.container.textContent).not.toContain(en.settingsModelsKeyRemoved);
});

test('the Company default is the Engine\'s list for its space: the Owner picks one, every other member reads it', async () => {
  const sent = stub();
  const models = { model: 'openrouter/openai/gpt-5.5', options };
  const screen = await renderNode(<DefaultModel readAt={Date.now()} company={company} owner models={models}/>);
  const chosen = screen.getByRole('radio', { name: /claude-opus-4-6/ });
  await chosen.click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ url: '/api/agent-settings', body: { company, setting: 'model', value: 'anthropic/claude-opus-4-6' } });
  await screen.unmount();
  await renderNode(<DefaultModel readAt={Date.now()} company={company} owner={false} models={models}/>);
  expect(document.querySelectorAll('[role=radio]')).toHaveLength(0);
  expect(document.querySelector('[aria-current=true]')?.textContent).toContain('gpt-5.5');
  await expect.element(page.getByText(en.settingsModelsOwnerOnly)).toBeVisible();
});

test('each Agent\'s model is chosen from its own profile\'s list, and following the default again is a choice too', async () => {
  const sent = stub();
  const screen = await renderNode(<EachAgent readAt={Date.now()} company={company} owner models={{ default: { model: 'openrouter/openai/gpt-5.5', options }, agents: [agent()] }}/>);
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
  const screen = await renderNode(<EachAgent readAt={Date.now()} company={company} owner models={{ default: { model: 'openrouter/openai/gpt-5.5', options }, agents: [agent()] }}/>);
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
  const on = await renderNode(<EachAgent readAt={Date.now()} company={company} owner models={{ default: { model: 'openrouter/openai/gpt-5.5', options }, agents: [agent({ subagents: true, settings })] }}/>, 'ar');
  // The Engine's sub-agent settings are rarely changed: under Advanced, closed until opened (#614).
  expect((document.getElementById('mdl-sub-a-1-advanced') as HTMLDetailsElement).open).toBe(false);
  await on.getByText(ar.settingsAdvanced, { exact: true }).click();
  await expect.element(on.getByText(ar.settingSubagentEffort)).toBeVisible();
  expect((document.getElementById('mdl-sub-a-1-max_concurrent_children') as HTMLInputElement).value).toBe('10');
  await expect.element(on.getByText(ar.settingsSubagentsAtOnce.replace('{0}', '10'))).toBeVisible();
  expect(document.getElementById('mdl-sub-a-1-effort')).not.toBeNull();
});

test('a member below Owner reads every model and the sub-agents state with no control', async () => {
  const settings = [{ key: 'delegation.max_concurrent_children', type: 'number' as const, choices: null, default: 10, value: 4, limits: { min: 1, integer: true }, label: 'settingSubagentLimit' }];
  await renderNode(<EachAgent readAt={Date.now()} company={company} owner={false} models={{ default: { model: 'openrouter/openai/gpt-5.5', options }, agents: [agent({ subagents: true, settings })] }}/>);
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
 const screen = await renderNode(<><ToastHost/><DefaultModel readAt={Date.now()} company={company} owner models={{ model: 'openrouter/openai/gpt-5.5', options }}/></>);
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
  const screen = await renderNode(<AgentModel readAt={Date.now()} choice={null} company={company} agent="a-1" name="Writer" model="openrouter/openai/gpt-5.5" options={options} choosable owner/>);
  await screen.getByRole('radio', { name: /claude-opus-4-6/ }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ url: '/api/agent-settings', body: { company, agent: 'a-1', setting: 'model', value: 'anthropic/claude-opus-4-6' } });
  await screen.unmount();
  await renderNode(<AgentModel readAt={Date.now()} choice={null} company={company} agent="lead" name="Lead" model="openrouter/openai/gpt-5.5" options={[]} choosable={false} owner/>);
  expect(document.querySelectorAll('[role=radio]')).toHaveLength(0);
  expect(document.getElementById('set-model')?.textContent).toContain('gpt-5.5');
});

test('the model choices are one Tab stop and the arrow keys move and select them, left in Arabic', async () => {
 const sent = stub();
 const screen = await renderNode(<DefaultModel readAt={Date.now()} company={company} owner models={{ model: 'openrouter/openai/gpt-5.5', options }}/>);
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
 const arabic = await renderNode(<DefaultModel readAt={Date.now()} company={company} owner models={{ model: 'openrouter/openai/gpt-5.5', options }}/>, 'ar');
 arabic.getByRole('radio', { name: /gpt-5.5/ }).element().focus();
 await userEvent.keyboard('{ArrowLeft}');
 await expect.poll(() => sent.length).toBe(2);
 expect(sent[1].body).toEqual({ company, setting: 'model', value: 'anthropic/claude-opus-4-6' });
 await arabic.unmount();
 const agent = await renderNode(<AgentModel readAt={Date.now()} choice={null} company={company} agent="a-1" name="Writer" model="openrouter/openai/gpt-5.5" options={options} choosable owner/>);
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
 const screen = await renderNode(<DefaultModel readAt={Date.now()} company={company} owner models={{ model: null, options }}/>);
 const first = screen.getByRole('radio', { name: /gpt-5.5/ });
 expect(first.element().tabIndex).toBe(0);
 expect(screen.getByRole('radio', { name: /claude-opus-4-6/ }).element().tabIndex).toBe(-1);
 first.element().focus();
 await userEvent.keyboard('{ArrowDown}');
 await expect.poll(() => sent.length).toBe(1);
 expect(sent[0].body).toEqual({ company, setting: 'model', value: 'openrouter/openai/gpt-5.5' });
 await screen.unmount();
 const agent = await renderNode(<AgentModel readAt={Date.now()} choice={null} company={company} agent="a-1" name="Writer" model={null} options={options} choosable owner/>);
 const agentFirst = agent.getByRole('radio', { name: /gpt-5.5/ });
 expect(agentFirst.element().tabIndex).toBe(0);
 agentFirst.element().focus();
 await userEvent.keyboard('{ArrowDown}');
 await expect.poll(() => sent.length).toBe(2);
 expect(sent[1].body).toEqual({ company, agent: 'a-1', setting: 'model', value: 'openrouter/openai/gpt-5.5' });
});

test('each Agent in "Each agent" reads its model and its own thinking level', async () => {
 const agents = [agent({ effort: 'high' }), agent({ id: 'a-2', name: 'Critic', model: 'anthropic/claude-opus-4-6', effort: 'low' })];
 await renderNode(<EachAgent readAt={Date.now()} company={company} owner={false} models={{ default: { model: 'openrouter/openai/gpt-5.5', options }, agents }}/>);
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
  { key: 'delegation.model', type: 'string' as const, choices: null, default: '', value: 'openai/gpt-5.5', limits: null, label: 'settingSubagentModel' },
  { key: 'delegation.provider', type: 'string' as const, choices: null, default: '', value: '', limits: null, label: 'settingSubagentProvider' },
 ];
 const screen = await renderNode(<EachAgent readAt={Date.now()} company={company} owner models={{ default: { model: 'openrouter/openai/gpt-5.5', options }, agents: [agent({ subagents: true, settings })] }}/>);
 await screen.getByText(en.settingsAdvanced, { exact: true }).click();
 await screen.getByRole('combobox', { name: en.settingSubagentModel }).selectOptions('openrouter/openai/gpt-5.5');
 await expect.poll(() => sent.length).toBe(1);
 expect(sent[0]).toEqual({ url: '/api/agent-settings', body: { company, agent: 'a-1', settings: { 'delegation.provider': 'openrouter', 'delegation.model': 'openai/gpt-5.5' } } });
 // Changing the provider sends the model it runs on in the same request, so the Engine never holds one without the other.
 await screen.getByRole('combobox', { name: en.settingSubagentProvider }).selectOptions('anthropic');
 await expect.poll(() => sent.length).toBe(2);
 expect(sent[1].body).toEqual({ company, agent: 'a-1', settings: { 'delegation.provider': 'anthropic', 'delegation.model': 'openai/gpt-5.5' } });
 // Clearing the provider clears the pair together.
 await screen.getByRole('combobox', { name: en.settingSubagentProvider }).selectOptions('');
 await expect.poll(() => sent.length).toBe(3);
 expect(sent[2].body).toEqual({ company, agent: 'a-1', settings: { 'delegation.provider': '', 'delegation.model': '' } });
});

// #424: each provider row shows its company's logo, a file of this install, named by the provider; a provider with no
// logo in Lobe Icons keeps its first letter.
const tileOf = (row: Element | null) => {
  const tile = row?.querySelector('.tool-tile');
  return [tile?.getAttribute('aria-label'), tile?.querySelector('img.tool-logo')?.getAttribute('src') ?? tile?.textContent];
};
test('every default model row shows its provider\'s logo out of the radio\'s name', async () => {
  // A model choice shows its provider's logo too, out of the radio's name, which says the provider in words already.
  const screen = await renderNode(<DefaultModel readAt={Date.now()} company={company} owner models={{ model: null, options }}/>);
  expect(options.map(option => tileOf(document.getElementById(`mdl-def-${option.provider}-${option.model}`)))).toEqual([
    [null, '/logos/lobe/openrouter-color.svg'], [null, '/logos/lobe/anthropic.svg']]);
  await expect.element(screen.getByRole('radio', { name: /^openai\/gpt-5\.5/ })).toBeVisible();
  const loaded = [...document.querySelectorAll<HTMLImageElement>('img.tool-logo')];
  await expect.poll(() => loaded.every(image => image.complete && image.naturalWidth > 0)).toBe(true);
});


// #661: a choice is marked at once and its row says "Saving" while the Engine writes it; the page is never read again.
// A held answer stands in for an Engine write that takes 3 s.
const heldAnswer = () => {
  let answer: (status: number, body: object) => void = () => {};
  const sent: { url: string, method: string, body: unknown }[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Promise<Response>(resolve => { answer = (status, body) => resolve(new Response(JSON.stringify(body), { status })); });
  });
  return { sent, answer: (status: number, body: object) => answer(status, body) };
};
test('a model choice is marked with "Saving" at once, nothing greyed, and is confirmed with no read of the page', async () => {
  const engine = heldAnswer();
  const screen = await renderNode(<AgentModel readAt={Date.now()} choice={null} company={company} agent="a-saving" name="Writer" model="openrouter/openai/gpt-5.5" options={options} choosable owner/>);
  const picked = screen.getByRole('radio', { name: /claude-opus-4-6/ });
  const clicked = performance.now();
  await picked.click();
  await expect.element(picked).toHaveAttribute('aria-checked', 'true');
  await expect.element(screen.getByText(en.settingsSaving)).toBeVisible();
  expect(performance.now() - clicked).toBeLessThan(1000);
  expect(document.querySelectorAll('[role=radio]:disabled')).toHaveLength(0);
  expect(screen.getByRole('radio', { name: /gpt-5.5/ }).element().getAttribute('aria-checked')).toBe('false');
  engine.answer(200, { setting: 'model', agent: 'a-saving', model: 'anthropic/claude-opus-4-6', running: 'anthropic/claude-opus-4-6', savedAt: Date.now() });
  await expect.element(screen.getByText(en.settingsSaving)).not.toBeInTheDocument();
  await expect.element(picked).toHaveAttribute('aria-checked', 'true');
  expect(refresh).not.toHaveBeenCalled();
  // A page the router kept from before the save still shows what was saved; a page read after it shows the server's.
  await screen.unmount();
  await renderNode(<AgentModel readAt={Date.now() - 60000} choice={null} company={company} agent="a-saving" name="Writer" model="openrouter/openai/gpt-5.5" options={options} choosable owner/>);
  await expect.element(page.getByRole('radio', { name: /claude-opus-4-6/ })).toHaveAttribute('aria-checked', 'true');
});

test('a model save that fails puts the row back on the old model and says why', async () => {
  const engine = heldAnswer();
  const screen = await renderNode(<AgentModel readAt={Date.now()} choice={null} company={company} agent="a-failing" name="Writer" model="openrouter/openai/gpt-5.5" options={options} choosable owner/>);
  await screen.getByRole('radio', { name: /claude-opus-4-6/ }).click();
  await expect.element(screen.getByText(en.settingsSaving)).toBeVisible();
  engine.answer(502, { error: 'settingMismatch' });
  await expect.element(screen.getByRole('alert')).toHaveTextContent(en.settingsModelsError);
  await expect.element(screen.getByRole('radio', { name: /gpt-5.5/ })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: /claude-opus-4-6/ }).element().getAttribute('aria-checked')).toBe('false');
  expect(refresh).not.toHaveBeenCalled();
});

test('a new Company default shows on every Agent it reached, with no read of the page', async () => {
  const engine = heldAnswer();
  const models = { default: { model: 'openrouter/openai/gpt-5.5', options }, agents: [agent({ id: 'a-follows' })] };
  const screen = await renderNode(<><DefaultModel readAt={Date.now()} company={company} owner models={models.default}/><EachAgent readAt={Date.now()} company={company} owner models={models}/></>);
  await screen.getByRole('radio', { name: /claude-opus-4-6/ }).click();
  await expect.element(screen.getByText(en.settingsSaving)).toBeVisible();
  engine.answer(200, { setting: 'model', value: 'anthropic/claude-opus-4-6', space: true, agents: [{ agent: 'a-follows', name: 'Writer', written: true }], failed: [], savedAt: Date.now() });
  await expect.poll(() => document.getElementById('mdl-agent-a-follows-model')?.textContent).toBe(`${en.settingsModelsFollows} · anthropic/claude-opus-4-6 · ${en.settingsEffortMedium}`);
  expect(refresh).not.toHaveBeenCalled();
});

test('turning sub-agents on reads that Agent\'s sub-agent settings alone, and a failed switch goes back off', async () => {
  const sent: { url: string, method: string }[] = [];
  const settings = [{ key: 'delegation.max_concurrent_children', type: 'number' as const, choices: null, default: 10, value: 3, limits: { min: 1, integer: true }, label: 'settingSubagentLimit' }, { key: 'agent.reasoning_effort', type: 'select' as const, choices: null, default: '', value: '', limits: null, label: 'x' }];
  let fail = false;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    sent.push({ url, method: init?.method ?? 'GET' });
    if (init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify(fail ? { error: 'settingFailed' } : { setting: 'subagents', savedAt: Date.now() }), { status: fail ? 502 : 200 }));
    return Promise.resolve(new Response(JSON.stringify({ agents: [{ id: 'a-sub', settings }] }), { status: 200 }));
  });
  const screen = await renderNode(<EachAgent readAt={Date.now()} company={company} owner models={{ default: { model: 'openrouter/openai/gpt-5.5', options }, agents: [agent({ id: 'a-sub' })] }}/>);
  const toggle = screen.getByRole('switch', { name: en.settingsSubagents });
  await toggle.click();
  await expect.element(toggle).toHaveAttribute('aria-checked', 'true');
  await expect.element(page.getByText(en.settingsAdvanced, { exact: true })).toBeVisible();
  expect(sent.map(request => request.method)).toEqual(['POST', 'GET']);
  expect(sent[1].url).toBe(`/api/agent-settings?company=${company}&agent=a-sub`);
  await screen.getByText(en.settingsAdvanced, { exact: true }).click();
  expect((document.getElementById('mdl-sub-a-sub-max_concurrent_children') as HTMLInputElement).value).toBe('3');
  fail = true;
  await toggle.click();
  await expect.element(screen.getByRole('alert')).toHaveTextContent(en.settingsModelsError);
  await expect.element(toggle).toHaveAttribute('aria-checked', 'true');
  expect(refresh).not.toHaveBeenCalled();
});
