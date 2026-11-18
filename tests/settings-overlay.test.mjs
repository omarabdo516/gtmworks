import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { overlaySections, visibleSections, pickSection, overlayHref, closeTarget, agentsMainFirst, usageTotals, usageModels, usageHeaviest, usageEmpty } from '../lib/settings-overlay.mjs';
import { messages } from '../lib/i18n.mjs';

test('the overlay lists the reference’s ten sections in its order, Your account under “You”', () => {
  assert.deepEqual(overlaySections.map(([key]) => key), ['company', 'agents', 'knowledge', 'learning', 'models', 'apps', 'routines', 'usage', 'backup', 'account']);
  assert.deepEqual(overlaySections.filter(section => section[4]).map(([key]) => key), ['account']);
  for (const [key, label] of overlaySections) for (const language of ['en', 'ar']) assert.ok(messages[language][label], `${key}: ${language} label`);
});

test('a Viewer sees only their account and the Agents; Usage is the Owner’s and the Managers’, in the same order', () => {
  assert.deepEqual(visibleSections('viewer').map(([key]) => key), ['agents', 'account']);
  assert.deepEqual(visibleSections('contributor').map(([key]) => key), ['company', 'agents', 'knowledge', 'learning', 'models', 'apps', 'routines', 'account']);
  assert.deepEqual(visibleSections('manager').map(([key]) => key), overlaySections.map(([key]) => key).filter(key => key !== 'backup'));
  assert.deepEqual(visibleSections('owner').map(([key]) => key), overlaySections.map(([key]) => key));
});

test('the Owner alone sees Backup (#33)', () => {
  assert.equal(visibleSections('owner').length, 10);
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
});

test('every overlay state has one address', () => {
  assert.equal(overlayHref('rs', 'company'), '/c/rs/settings');
  assert.equal(overlayHref('rs', 'agents'), '/c/rs/settings?section=agents');
  assert.equal(overlayHref('rs', 'agents', { agent: 'a-1' }), '/c/rs/settings?agent=a-1');
  assert.equal(overlayHref('rs', 'usage', { period: '30' }), '/c/rs/settings?section=usage&period=30');
  assert.equal(overlayHref('rs', 'account'), '/c/rs/settings?section=account');
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
