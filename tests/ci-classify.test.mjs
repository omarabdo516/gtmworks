import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify } from '../scripts/ci-classify.mjs';

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

test('any other red is your change', () => {
  for (const job of ['database-133610408482', 'integration-133640016093', 'integration-133599861446']) {
    assert.deepEqual(outcome(classify(log(job))), yourChange, job);
  }
  assert.deepEqual(outcome(classify('')), yourChange, 'an empty log');
});
