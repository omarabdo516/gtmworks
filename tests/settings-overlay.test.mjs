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

test('the overlay shows no invented figures: no prices, no sample usage or backups', () => {
  const source = readFileSync('app/settings-overlay.tsx', 'utf8');
  assert.doesNotMatch(source, /EGP|جنيه|MB|Opus|GPT|Gemini/);
  // The Models section keeps one slot for the company's own subscription sign-in (#3).
  assert.match(source, /function ModelsSubscriptions/);
});
