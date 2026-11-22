import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { overlaySections, overlayGroups, sectionGroup, visibleSections, pickSection, overlayHref, closeTarget, agentsMainFirst, usageTotals, usageModels, usageHeaviest, usageEmpty, companyKnowledgeHref, agentTab, agentTabFocus, memoryAgent } from '../lib/settings-overlay.mjs';
import { messages } from '../lib/i18n.mjs';

// #612 (spec #610): the sidebar is grouped by what a person changes. Company holds Company, Members and Company
// knowledge; Agents holds Agents, Learning, Recurring tasks and Apps; Engine holds Providers and Usage; Backups, Your
// account and About stand on their own at the end.
test('the overlay lists its sections in groups, Backups, Your account and About on their own at the end', () => {
  assert.deepEqual(overlaySections.map(([key]) => key), ['company', 'members', 'knowledge', 'agents', 'learning', 'routines', 'apps', 'models', 'usage', 'backup', 'account', 'about']);
  assert.deepEqual(overlayGroups('owner').map(({ group, sections }) => [group, sections.map(([key]) => key)]), [
    ['company', ['company', 'members', 'knowledge']],
    ['agents', ['agents', 'learning', 'routines', 'apps']],
    ['engine', ['models', 'usage']],
    [null, ['backup', 'account', 'about']],
  ]);
  for (const [key, label] of overlaySections) for (const language of ['en', 'ar']) assert.ok(messages[language][label], `${key}: ${language} label`);
  for (const { group, label } of overlayGroups('owner')) for (const language of ['en', 'ar']) assert.ok(group === null || messages[language][label], `${group}: ${language} label`);
  assert.equal(messages.en.settingsModels, 'Providers');
});

test('a Viewer sees only the Agents, their account and About; Usage is the Owner’s and the Managers’, in the same order', () => {
  assert.deepEqual(visibleSections('viewer').map(([key]) => key), ['agents', 'account', 'about']);
  assert.deepEqual(visibleSections('contributor').map(([key]) => key), ['company', 'members', 'knowledge', 'agents', 'learning', 'routines', 'apps', 'models', 'account', 'about']);
  assert.deepEqual(visibleSections('manager').map(([key]) => key), overlaySections.map(([key]) => key).filter(key => key !== 'backup'));
  assert.deepEqual(visibleSections('owner').map(([key]) => key), overlaySections.map(([key]) => key));
  // A group none of whose pages the person may open is not drawn at all.
  assert.deepEqual(overlayGroups('viewer').map(({ group, sections }) => [group, sections.map(([key]) => key)]), [['agents', ['agents']], [null, ['account', 'about']]]);
  assert.deepEqual(overlayGroups('contributor').find(({ group }) => group === 'engine').sections.map(([key]) => key), ['models']);
});

test('the breadcrumb names the group of the open page, and nothing for a page on its own', () => {
  assert.equal(sectionGroup('members')?.label, 'settingsCompany');
  assert.equal(sectionGroup('routines')?.label, 'agents');
  assert.equal(sectionGroup('usage')?.label, 'settingsGroupEngine');
  for (const key of ['backup', 'account', 'about']) assert.equal(sectionGroup(key), null, key);
});

test('the Owner alone sees Backup (#33)', () => {
  assert.equal(visibleSections('owner').length, 12);
  for (const role of ['manager', 'contributor', 'viewer']) {
    assert.ok(!visibleSections(role).some(([key]) => key === 'backup'), `Backup is the Owner's: ${role}`);
    assert.notEqual(pickSection('backup', role), 'backup', `a request for Backup falls back: ${role}`);
  }
  assert.equal(pickSection('backup', 'owner'), 'backup');
});

test('a request opens the section asked for only when the person may see it, else their first one', () => {
  assert.equal(pickSection(undefined, 'owner'), 'company');
  assert.equal(pickSection('usage', 'manager'), 'usage');
  assert.equal(pickSection('nonsense', 'owner'), 'company');
  assert.equal(pickSection('usage', 'contributor'), 'company');
  assert.equal(pickSection(undefined, 'viewer'), 'agents');
  assert.equal(pickSection('company', 'viewer'), 'agents');
  assert.equal(pickSection('usage', 'viewer'), 'agents');
  assert.equal(pickSection('account', 'viewer'), 'account');
  assert.equal(pickSection('members', 'viewer'), 'agents');
  assert.equal(pickSection('members', 'contributor'), 'members');
  assert.equal(pickSection('about', 'viewer'), 'about');
  // About is everyone's (#616): the installed version and its notes are no Role's secret.
  for (const role of ['owner', 'manager', 'contributor', 'viewer']) assert.equal(pickSection('about', role), 'about', role);
});

// #192: "Open company knowledge" in an Agent's memory is the Company knowledge section, which a Viewer may not open.
test('Company knowledge has an address for everyone but a Viewer', () => {
  for (const role of ['owner', 'manager', 'contributor']) assert.equal(companyKnowledgeHref('rs', role), '/c/rs/settings?section=knowledge', role);
  assert.equal(companyKnowledgeHref('rs', 'viewer'), undefined);
});

test('every overlay state has one address', () => {
  assert.equal(overlayHref('rs', 'company'), '/c/rs/settings');
  assert.equal(overlayHref('rs', 'agents'), '/c/rs/settings?section=agents');
  assert.equal(overlayHref('rs', 'agents', { agent: 'a-1' }), '/c/rs/settings?agent=a-1');
  assert.equal(overlayHref('rs', 'usage', { period: '30' }), '/c/rs/settings?section=usage&period=30');
  assert.equal(overlayHref('rs', 'account'), '/c/rs/settings?section=account');
  assert.equal(overlayHref('rs', 'members'), '/c/rs/settings?section=members');
});

test('closing returns to the page Settings was opened from, never outside the company or back into the overlay', () => {
  assert.equal(closeTarget('/c/rs/work/board?month=2026-06', 'rs'), '/c/rs/work/board?month=2026-06');
  assert.equal(closeTarget(null, 'rs'), '/c/rs/chat');
  assert.equal(closeTarget('/c/other/home', 'rs'), '/c/rs/chat');
  assert.equal(closeTarget('//evil.example/c/rs/', 'rs'), '/c/rs/chat');
  assert.equal(closeTarget('/c/rs/settings?section=agents', 'rs'), '/c/rs/chat');
  assert.equal(closeTarget('/c/rs/settings/members', 'rs'), '/c/rs/settings/members');
});

test('the Agents list puts the main Agent first and keeps the others in order', () => {
  const agents = [{ id: 'a', is_default: false }, { id: 'b', is_default: true }, { id: 'c', is_default: false }];
  assert.deepEqual(agentsMainFirst(agents).map(agent => agent.id), ['b', 'a', 'c']);
});

// #193: the Memory tab of an Agent's page is a real tab with its own address, and the address opens it with the focus.
test('an Agent’s Memory tab has its own address and opens with the focus on it', () => {
  assert.equal(overlayHref('rs', 'agents', { agent: 'a-1', tab: 'memory' }), '/c/rs/settings?agent=a-1&tab=memory');
  assert.equal(overlayHref('rs', 'agents', { agent: 'a-1' }), '/c/rs/settings?agent=a-1');
  assert.equal(agentTab('memory'), 'memory');
  for (const other of [undefined, '', 'settings', 'anything']) assert.equal(agentTab(other), 'settings', String(other));
  assert.equal(agentTabFocus('memory'), 'sov-tab-memory');
  assert.equal(agentTabFocus('settings'), 'sov-tab-settings');
});

// #193: Company knowledge links to the memory of the first Agent the reader sees that is not the main one, or to the main
// Agent when there is no other; a reader who sees no Agent is offered no link.
test('Company knowledge opens the memory of the first Agent that is not main, else the main one', () => {
  const main = { id: 'main', is_default: true }, ads = { id: 'ads', is_default: false }, seo = { id: 'seo', is_default: false };
  assert.equal(memoryAgent([main, ads, seo]).id, 'ads');
  assert.equal(memoryAgent([seo, main]).id, 'seo');
  assert.equal(memoryAgent([main]).id, 'main');
  assert.equal(memoryAgent([]), null);
});

// #347: the period is Hermes's (its usage analytics over the days asked); the totals add up this company's profiles.
test('usage totals add up only this company’s profiles, and count the ones Hermes could not be asked about apart', () => {
  const rows = [
    { company_id: 'rs', input: 100, output: 20, sessions: 2 },
    { company_id: 'rs', input: 10, output: 5, sessions: 1 },
    { company_id: 'rs', input: null, output: null, sessions: null },
    { company_id: 'other', input: 5000, output: 0, sessions: 9 },
  ];
  assert.deepEqual(usageTotals(rows, 'rs'), { tokens: 135, sessions: 3, unknown: 1 });
  assert.deepEqual(usageTotals([], 'rs'), { tokens: 0, sessions: 0, unknown: 0 });
});

// #32: Hermes's by_model rows are each model's own count, added across the profiles that ran on it, and always their
// own table: Hermes merges auxiliary usage into them, so their sum can pass the totals and is never added to them.
test('the per-model table adds each model across the company’s profiles, apart from the totals', () => {
  const rows = [
    { company_id: 'rs', input: 100, output: 20, sessions: 2, models: [{ model: 'opus', input: 160, output: 10, sessions: 1 }, { model: 'gpt', input: 40, output: 10, sessions: 1 }] },
    { company_id: 'rs', input: 10, output: 5, sessions: 1, models: [{ model: 'opus', input: 10, output: 5, sessions: 1 }] },
    { company_id: 'rs', input: null, output: null, sessions: null, models: null },
    { company_id: 'other', input: 5000, output: 0, sessions: 9, models: [{ model: 'gemini', input: 9000, output: 0, sessions: 9 }] },
  ];
  const models = usageModels(rows, 'rs');
  assert.deepEqual(models, [
    { model: 'opus', input: 170, output: 15, sessions: 2 },
    { model: 'gpt', input: 40, output: 10, sessions: 1 },
  ]);
  assert.equal(models.reduce((sum, model) => sum + model.input + model.output, 0), 235);
  assert.equal(usageTotals(rows, 'rs').tokens, 135, 'the totals stay Hermes\'s own');
  assert.deepEqual(usageModels([], 'rs'), []);
});

test('the heaviest Agent is the one whose profile used the most tokens, and the period is empty only with nothing to show', () => {
  const rows = [
    { company_id: 'rs', input: 100, output: 20, sessions: 2, models: [] },
    { company_id: 'rs', input: 10, output: 5, sessions: 1, models: [] },
    { company_id: 'other', input: 5000, output: 0, sessions: 9, models: [] },
  ];
  assert.deepEqual(usageHeaviest(rows, 'rs'), rows[0]);
  assert.equal(usageHeaviest([], 'rs'), null);
  assert.equal(usageEmpty([]), true);
  assert.equal(usageEmpty([{ company_id: 'rs', input: 0, output: 0, sessions: 0, models: [] }]), true);
  assert.equal(usageEmpty([{ company_id: 'rs', input: 0, output: 0, sessions: 0, models: [{ model: 'opus', input: 1, output: 0, sessions: 1 }] }]), false);
  assert.equal(usageEmpty([{ company_id: 'rs', input: null, output: null, sessions: null, models: null }]), false, 'unknown usage is shown, never an empty period');
  assert.equal(usageEmpty(rows), false);
});

test('the overlay shows no invented figures: no prices, no sample usage or backups', () => {
  const source = readFileSync('app/settings-overlay.tsx', 'utf8');
  assert.doesNotMatch(source, /EGP|جنيه|MB|Opus|GPT|Gemini/);
  // The Models section keeps one slot for the company's own subscription sign-in (#3).
  assert.match(source, /function ModelsSubscriptions/);
});
