import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { overlaySections, visibleSections, pickSection, overlayHref, closeTarget, agentsMainFirst, usageTotals } from '../lib/settings-overlay.mjs';
import { messages } from '../lib/i18n.mjs';

test('the overlay lists the reference’s ten sections in its order, Your account under “You”', () => {
  assert.deepEqual(overlaySections.map(([key]) => key), ['company', 'agents', 'knowledge', 'learning', 'models', 'apps', 'routines', 'usage', 'backup', 'account']);
  assert.deepEqual(overlaySections.filter(section => section[4]).map(([key]) => key), ['account']);
  for (const [key, label] of overlaySections) for (const language of ['en', 'ar']) assert.ok(messages[language][label], `${key}: ${language} label`);
});

test('a Viewer sees only their account and the Agents; everyone else sees every section', () => {
  assert.deepEqual(visibleSections('viewer').map(([key]) => key), ['agents', 'account']);
  for (const role of ['owner', 'manager', 'contributor']) assert.equal(visibleSections(role).length, 10, role);
});

test('a request opens the section asked for only when the person may see it, else their first one', () => {
  assert.equal(pickSection(undefined, 'owner'), 'company');
  assert.equal(pickSection('usage', 'manager'), 'usage');
  assert.equal(pickSection('nonsense', 'owner'), 'company');
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

test('usage totals count only this company’s days inside the period, today included', () => {
  const today = new Date('2026-11-13T15:00:00Z');
  const rows = [
    { company_id: 'rs', day: '2026-11-13', input_tokens: 100, output_tokens: 20, runs: 2, unknown_runs: 1 },
    { company_id: 'rs', day: '2026-11-07', input_tokens: 10, output_tokens: 5, runs: 1, unknown_runs: 0 },
    { company_id: 'rs', day: '2026-11-06', input_tokens: 1000, output_tokens: 0, runs: 4, unknown_runs: 0 },
    { company_id: 'other', day: '2026-11-13', input_tokens: 5000, output_tokens: 0, runs: 9, unknown_runs: 0 },
  ];
  assert.deepEqual(usageTotals(rows, 'rs', 7, today), { tokens: 135, runs: 3, unknown: 1 });
  assert.deepEqual(usageTotals(rows, 'rs', 30, today), { tokens: 1135, runs: 7, unknown: 1 });
  assert.deepEqual(usageTotals([], 'rs', 7, today), { tokens: 0, runs: 0, unknown: 0 });
});

test('the overlay shows no invented figures: no prices, no sample usage or backups', () => {
  const source = readFileSync('app/settings-overlay.tsx', 'utf8');
  assert.doesNotMatch(source, /EGP|جنيه|MB|Opus|GPT|Gemini/);
  // The Models section keeps one slot for the company's own subscription sign-in (#3).
  assert.match(source, /function ModelsSubscriptions/);
});
