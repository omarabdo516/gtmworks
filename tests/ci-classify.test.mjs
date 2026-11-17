import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, failedStep } from '../scripts/ci-classify.mjs';

// A red job carries one label (#256, spec #255 D12): an infrastructure cause when the job ended on a known signature, and
// otherwise "your change". The logs are excerpts of real failed jobs from 2026-11-16 (tests/ci-logs/README.md).
const log = name => readFileSync(`tests/ci-logs/${name}.log`, 'utf8');
const infrastructure = cause => ({ label: 'infrastructure', cause });
const yourChange = { label: 'your change', cause: null };
const outcome = ({ label, cause }) => ({ label, cause });

// The 7 database jobs counted as registry rate limits: each pull was retried and went through, the stack started, and
// the job ended on failed pgTAP tests, so a rate-limit line earlier in the log is not why it failed.
for (const job of ['133592988053', '133596593734', '133600998199', '133607458789', '133614975910', '133627087516', '133630248163']) {
  test(`database ${job}: a registry rate limit the pull recovered from is not the cause; the failed tests are`, () => {
    const text = log(`database-${job}`);
    assert.match(text, /Rate exceeded/);
    assert.deepEqual(outcome(classify(text)), yourChange);
  });
}

test('a registry rate limit that ends the job is infrastructure', () => {
  const result = classify(log('constructed-registry-rate-limit'));
  assert.deepEqual(outcome(result), infrastructure('registry rate limit'));
  assert.match(result.evidence, /Rate exceeded/);
});

// The 7 PC browser jobs where the browser's network changed under it (#241): Chrome reports it only for a change on the
// host, so every failure in that job is suspect, also the ones whose own error names something else.
for (const job of ['133515802171', '133560059656', '133569580338', '133574814781', '133580631427', '133585741295', '133592987843']) {
  test(`browser ${job}: a network change on the runner is infrastructure`, () => {
    const result = classify(log(`integration-${job}`));
    assert.deepEqual(outcome(result), infrastructure('network change'));
    assert.match(result.evidence, /ERR_NETWORK_CHANGED/);
  });
}

test('a runner shutdown is infrastructure', () => {
  const result = classify(log('integration-133545390129'));
  assert.deepEqual(outcome(result), infrastructure('runner shutdown'));
  assert.match(result.evidence, /shutdown signal/);
});

test('a stack port held by another job is infrastructure, although a recovered rate limit came first (#216)', () => {
  const text = log('database-133269529029');
  assert.match(text, /Rate exceeded/);
  const result = classify(text);
  assert.deepEqual(outcome(result), infrastructure('port in use'));
  assert.match(result.evidence, /address already in use/);
});

test('a failed test whose own error is a 429, and a later step that hit a rate limit, are still your change', () => {
  const text = log('constructed-test-failure-429');
  assert.match(text, /429 Too Many Requests/);
  assert.deepEqual(outcome(classify(text)), yourChange);
});

test('a rate limit counts where the failed step ended: in an action\'s own error, from npm, or before a few lines of diagnostics', () => {
  for (const [name, evidence] of [['constructed-action-rate-limit', /toomanyrequests/], ['constructed-npm-429', /E429|429 Too Many Requests/], ['constructed-registry-rate-limit', /Rate exceeded/]]) {
    const result = classify(log(name));
    assert.deepEqual(outcome(result), infrastructure('registry rate limit'), name);
    assert.match(result.evidence, evidence, name);
  }
});

test('what an earlier step printed, or a failed test prints, is not where the job ended', () => {
  for (const name of ['constructed-short-failed-step', 'constructed-node-test-port', 'constructed-quoted-shutdown']) {
    assert.deepEqual(outcome(classify(log(name))), yourChange, name);
  }
});

// Pulls run side by side, so another layer's line says nothing of the pull that hit the limit (Codex on #285).
test('a rate limit counts as recovered only when the same image then finished downloading', () => {
  const text = log('constructed-registry-rate-limit');
  const lines = text.split('\n');
  const at = lines.findIndex(line => line.includes('failed to pull docker image'));
  const another = [...lines.slice(0, at + 1), '2026-11-16T20:34:05.1079440Z 921bfecda4c1: Pull complete', '2026-11-16T20:34:05.1079441Z Retrying after 4s: public.ecr.aws/supabase/postgres:17.11.0.011', ...lines.slice(at + 1)];
  assert.deepEqual(outcome(classify(another.join('\n'))), infrastructure('registry rate limit'));
  const elsewhere = [...lines.slice(0, at + 1), '2026-11-16T20:34:05.1079440Z Status: Downloaded newer image for public.ecr.aws/supabase/kong:2.8.1', ...lines.slice(at + 1)];
  assert.deepEqual(outcome(classify(elsewhere.join('\n'))), infrastructure('registry rate limit'), 'another image finished');
});

test('a rate limit the job recovered from, or a test that failed on its own, is your change', () => {
  for (const name of ['constructed-recovered-pull-then-verify', 'constructed-component-test-error']) {
    assert.deepEqual(outcome(classify(log(name))), yourChange, name);
  }
});

// The job's steps from the API (job 133610408482) name the one that failed; a step allowed to fail is not it.
test('the failed step is the one the API marks failed, counted among the steps that ran, as the log prints them', () => {
  const steps = [
    { name: 'Set up job', conclusion: 'success' }, { name: 'Run actions/checkout@v4', conclusion: 'success' },
    { name: "reserve the stack's ports", conclusion: 'success' }, { name: 'Run actions/setup-node@v4', conclusion: 'success' },
    { name: 'database', conclusion: 'failure' }, { name: 'upload ledger results', conclusion: 'skipped' },
    { name: 'Post Run actions/setup-node@v4', conclusion: 'skipped' }, { name: 'Post Run actions/checkout@v4', conclusion: 'success' },
    { name: 'Complete job', conclusion: 'success' },
  ];
  assert.equal(failedStep(steps), 3);
  assert.equal(failedStep(steps.map(step => ({ ...step, conclusion: 'success' }))), null);
  const text = log('constructed-continue-on-error');
  assert.deepEqual(outcome(classify(text)), infrastructure('registry rate limit'), 'without the API, the action that printed an error looks like the failed step');
  assert.deepEqual(outcome(classify(text, { failedStep: 2 })), yourChange);
  assert.equal(classify(log('database-133610408482'), { failedStep: 3 }).label, 'your change');
});

test('any other red is your change', () => {
  for (const job of ['database-133610408482', 'integration-133640016093', 'integration-133599861446']) {
    assert.deepEqual(outcome(classify(log(job))), yourChange, job);
  }
  assert.deepEqual(outcome(classify('')), yourChange, 'an empty log');
});
