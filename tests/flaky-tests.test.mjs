import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flakyTests, renderSummary, issueTitle } from '../scripts/flaky-tests.mjs';

const results = (...statuses) => statuses.map((status) => ({ status, error: status === 'failed' ? { message: '\u001b[31mexpected 1\u001b[39m\n second line' } : undefined }));
const spec = (title, status, project = 'functional') => ({ title, file: 'a.spec.ts', tests: [{ projectName: project, status, results: results(...(status === 'flaky' ? ['failed', 'passed'] : status === 'unexpected' ? ['failed', 'failed'] : ['passed'])) }] });
const report = (...specs) => ({ suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', suites: [{ title: 'board', file: 'a.spec.ts', specs }] }] });

test('no flaky tests: an empty list and an empty summary', () => {
  assert.deepEqual(flakyTests(report(spec('opens', 'expected'))), []);
  assert.deepEqual(flakyTests(null), []);
  assert.equal(renderSummary([], 'https://example.test/run/1'), '');
});

test('one flaky test: named once with the first failure\'s error line', () => {
  const [t, ...rest] = flakyTests(report(spec('opens', 'expected'), spec('drags', 'flaky')));
  assert.equal(rest.length, 0);
  assert.equal(t.title, 'a.spec.ts › board › drags');
  assert.equal(t.error, 'expected 1');
  assert.equal(issueTitle(t), 'Flaky test: a.spec.ts › board › drags');
  const summary = renderSummary([t], 'https://example.test/run/2');
  assert.match(summary, /drags: expected 1/);
  assert.match(summary, /example\.test\/run\/2/);
});

test('the same title flaky twice is one entry', () => {
  const list = flakyTests(report(spec('drags', 'flaky', 'visual'), spec('drags', 'flaky', 'functional')));
  assert.equal(list.length, 1);
  assert.equal(list[0].occurrences, 2);
  assert.deepEqual(list[0].projects, ['visual', 'functional']);
});

test('a hard failure is not flaky', () => {
  assert.deepEqual(flakyTests(report(spec('drags', 'unexpected'))), []);
});

test('the command exits zero even when the report has a hard failure, and non-zero only on its own error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flaky-'));
  const file = join(dir, 'results.json');
  writeFileSync(file, JSON.stringify(report(spec('drags', 'unexpected'), spec('drops', 'flaky'))));
  const ran = spawnSync('node', ['scripts/flaky-tests.mjs', file, 'https://example.test/run/3', join(dir, 'out.json')], { encoding: 'utf8' });
  assert.equal(ran.status, 0);
  assert.equal(JSON.parse(execFileSync('cat', [join(dir, 'out.json')], { encoding: 'utf8' })).length, 1);
  assert.equal(spawnSync('node', ['scripts/flaky-tests.mjs'], { encoding: 'utf8' }).status, 2);
});
