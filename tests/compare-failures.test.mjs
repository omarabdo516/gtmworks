import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareFailures, failedTests, renderMarkdown } from '../scripts/compare-failures.mjs';

const spec = (file, title, status, project = 'functional') => ({ title, file, tests: [{ projectName: project, status, results: [{ status: status === 'unexpected' ? 'failed' : 'passed' }] }] });
const report = (...specs) => ({ suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', suites: [{ title: 'board', file: 'a.spec.ts', specs }] }] });
const ok = spec('a.spec.ts', 'opens', 'expected');

test('no failures: nothing inherited, nothing own', () => {
  assert.deepEqual(compareFailures(report(ok), report(ok)), { mainReport: true, inherited: [], own: [] });
  assert.deepEqual(failedTests({}), []);
});

test('failures only on the PR are its own', () => {
  const pr = report(ok, spec('a.spec.ts', 'drags', 'unexpected'));
  const result = compareFailures(pr, report(ok));
  assert.deepEqual(result.inherited, []);
  assert.deepEqual(result.own, ['functional › a.spec.ts › board › drags']);
});

test('failures red on both runs are inherited; the rest stay own', () => {
  const shared = spec('a.spec.ts', 'drags', 'unexpected');
  const pr = report(shared, spec('a.spec.ts', 'drops', 'unexpected'));
  const result = compareFailures(pr, report(shared, ok));
  assert.deepEqual(result.inherited, ['functional › a.spec.ts › board › drags']);
  assert.deepEqual(result.own, ['functional › a.spec.ts › board › drops']);
});

test('a main run with no report names nothing as inherited', () => {
  const result = compareFailures(report(spec('a.spec.ts', 'drags', 'unexpected')), null);
  assert.equal(result.mainReport, false);
  assert.deepEqual(result.inherited, []);
  assert.equal(result.own.length, 1);
  assert.match(renderMarkdown(result, 'https://example.test/run/1'), /saved no usable Playwright report/);
});

test('a renamed test is the PR\'s own, not inherited', () => {
  const result = compareFailures(report(spec('a.spec.ts', 'drags cards', 'unexpected')), report(spec('a.spec.ts', 'drags', 'unexpected')));
  assert.deepEqual(result.inherited, []);
  assert.deepEqual(result.own, ['functional › a.spec.ts › board › drags cards']);
});

test('the summary lists both groups and links the main run', () => {
  const text = renderMarkdown({ mainReport: true, inherited: ['x'], own: ['y'] }, 'https://example.test/run/9');
  assert.match(text, /Inherited from main \(1\)[\s\S]*- x/);
  assert.match(text, /own \(1\)[\s\S]*- y/);
  assert.match(text, /https:\/\/example\.test\/run\/9/);
});

test('a main run that did not run Playwright counts as no report', () => {
  const result = compareFailures(report(spec('a.spec.ts', 'drags', 'unexpected')), { notRun: true, suites: [] });
  assert.equal(result.mainReport, false);
  assert.equal(result.own.length, 1);
});

test('a PR run that did not run Playwright says so instead of passing silently', () => {
  const result = compareFailures({ notRun: true, suites: [] }, report(ok));
  assert.equal(result.prNotRun, true);
  assert.match(renderMarkdown(result, ''), /Playwright did not run in this CI run/);
});
