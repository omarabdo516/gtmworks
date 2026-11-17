import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { beforeMidnight, uuid } from './clock.mjs';

// The nightly run repeats the fast layers under Cairo and a west-of-UTC zone, near that zone's midnight (#266).
const workflow = load(readFileSync('.github/workflows/time-zones.yml', 'utf8'));
const job = Object.values(workflow.jobs)[0];
const zones = job.strategy.matrix.zone;
// West of UTC in winter and summer: its day ends after UTC's.
const west = zones.find(zone => ['2026-01-15', '2026-07-15'].every(day => beforeMidnight(day, zone, 0) > beforeMidnight(day, 'UTC', 0)));

test('the workflow reads the code only, names no secret and never runs a fork\'s change with the base\'s rights', () => {
  const text = readFileSync('.github/workflows/time-zones.yml', 'utf8');
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(Object.values(workflow.jobs).filter(each => each.permissions).length, 0);
  assert.doesNotMatch(text, /secrets\./);
  assert.ok(!('pull_request_target' in workflow.on));
  assert.equal(Object.keys(workflow.jobs).length, 1);
});

test('the node and component tests run under the matrix zone, Cairo and a west-of-UTC one, and components runs after red node tests', () => {
  assert.ok(zones.includes('Africa/Cairo'));
  assert.ok(west, `a zone west of UTC all year: ${zones}`);
  assert.equal(job.env.TZ, '${{ matrix.zone }}');
  assert.equal(job.strategy['fail-fast'], false);
  const steps = Object.fromEntries(job.steps.filter(step => step.id).map(step => [step.id, step]));
  assert.equal(steps['node-tests'].run, 'npm test');
  assert.ok(job.steps.findIndex(step => step.run === 'npm ci') < job.steps.findIndex(step => step.id === 'node-tests'), 'installed first');
  assert.equal(steps.components.run, './ci.sh components');
  assert.equal(steps.components.if, '${{ !cancelled() }}');
  assert.equal(job.steps.at(-1).if, 'always()');
  assert.match(job.steps.at(-1).run, /GITHUB_STEP_SUMMARY/);
});

test('the nightly run starts within 30 minutes before midnight in the west zone', () => {
  const [minute, hour] = workflow.on.schedule[0].cron.split(' ').map(Number);
  for (const day of ['2026-01-15', '2026-07-15', '2026-11-17']) {
    const [year, month, date] = day.split('-').map(Number);
    const start = new Date(Date.UTC(year, month - 1, date, hour, minute));
    const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: west }).format(start);
    const left = beforeMidnight(localDay, west, 0) - start;
    assert.ok(left > 0 && left <= 30 * 60 * 1000, `${day}: ${left / 60000} minutes before midnight in ${west}`);
  }
});

test('beforeMidnight is the instant before a local day ends, a clock change included', () => {
  assert.equal(beforeMidnight('2026-11-17', 'Africa/Cairo').toISOString(), '2026-11-17T21:59:30.000Z');
  assert.equal(beforeMidnight('2026-11-17', 'America/Sao_Paulo').toISOString(), '2026-11-18T02:59:30.000Z');
  assert.equal(beforeMidnight('2026-11-01', 'America/New_York').toISOString(), '2026-11-02T04:59:30.000Z');
  assert.equal(beforeMidnight('2026-11-17', 'UTC', 1).toISOString(), '2026-11-17T23:59:59.000Z');
  // Clocks that jump forward at midnight: the day still ends at 23:59:59 on its own clock, an hour before the jump's UTC.
  assert.equal(beforeMidnight('2026-03-07', 'America/Havana', 1).toISOString(), '2026-03-08T04:59:59.000Z');
  assert.equal(beforeMidnight('2026-03-07', 'America/Havana', 0).toISOString(), '2026-03-08T05:00:00.000Z', 'the day ends at the jump');
  // Clocks that go back across midnight: the day ends at the first of its two midnights.
  assert.equal(beforeMidnight('2021-10-28', 'Asia/Amman').toISOString(), '2021-10-28T20:59:30.000Z');
  assert.equal(beforeMidnight('2026-04-23', 'Africa/Cairo').toISOString(), '2026-04-23T21:59:30.000Z');
});

test('uuid gives the n-th fixed id in the shape of a version 4 UUID', () => {
  assert.equal(uuid(1), '00000000-0000-4000-8000-000000000001');
  assert.equal(uuid(255), '00000000-0000-4000-8000-0000000000ff');
  assert.match(uuid(255), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
