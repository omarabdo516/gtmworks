import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// docs/testing.md keeps one row per file under tests/ (#69): what it guards, its runtime and the decision.
// The approved images, the compared screens and the failed job logs are data folders with one row each, so adding a
// screen or a log needs no row.
test('docs/testing.md has exactly one row per file under tests/', () => {
  const folders = ['visual.spec.ts-snapshots/', 'visual-screens/', 'ci-logs/'];
  const tracked = execFileSync('git', ['ls-files', 'tests'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    .map(path => path.slice('tests/'.length))
    .map(path => (/\.(test|spec)\.[^/]+$/.test(path) ? undefined : folders.find(folder => path.startsWith(folder))) ?? path);
  const rows = [...readFileSync('docs/testing.md', 'utf8').matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]);
  assert.deepEqual([...rows].sort(), [...new Set(tracked)].sort());
  assert.equal(new Set(rows).size, rows.length, 'a file has more than one row');
});

// #218: every case of the `functional` project has its decision in "The browser suite, case by case". A case that
// stays is still in its file; a case that moved or was removed is gone from it, and a spec with no case left is deleted.
// The project's spec files are read from playwright.config.ts, so a new spec file with cases and no rows fails here.
const casesOf = source => [...source.matchAll(/\btest\((['`])((?:\\.|(?!\1).)*)\1/g)].map(match => match[2].replaceAll("\\'", "'"));
function decisionProblems(doc, sources) {
  const section = doc.slice(doc.indexOf('## The browser suite, case by case'));
  const rows = [...section.matchAll(/^\| `([\w-]+\.spec\.ts)` "(.+)" \| (stays|moved|removed) \|/gm)]
    .map(([, file, title, decision]) => ({ file, title, decision }));
  const problems = [];
  if (rows.length === 0) problems.push('the case-by-case table has no rows');
  for (const file of new Set([...Object.keys(sources), ...rows.map(row => row.file)])) {
    const cases = casesOf(sources[file] ?? '').sort();
    const decided = rows.filter(row => row.file === file);
    const stays = decided.filter(row => row.decision === 'stays').map(row => row.title).sort();
    const missing = cases.filter(title => !stays.includes(title)), gone = stays.filter(title => !cases.includes(title));
    if (missing.length || gone.length) problems.push(`${file}: the cases still in the file are the ones that stay${missing.length ? `; no "stays" row for: ${missing.join(' | ')}` : ''}${gone.length ? `; "stays" but not in the file: ${gone.join(' | ')}` : ''}`);
    if (new Set(decided.map(row => row.title)).size !== decided.length) problems.push(`${file}: a case has more than one row`);
  }
  return problems;
}
// A Playwright testIgnore pattern as a regular expression: `**/` matches any folders, `*` anything but a slash.
const glob = pattern => new RegExp(`^${pattern.split('**/').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*').replaceAll('[^/]*[^/]*', '.*')).join('(?:.*/)?')}$`);
function functionalSpecs() {
  const config = readFileSync('playwright.config.ts', 'utf8');
  const ignored = [...config.match(/name: 'functional', testIgnore: \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  return execFileSync('git', ['ls-files', 'tests/*.spec.ts'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    .map(path => path.slice('tests/'.length)).filter(file => !ignored.some(pattern => glob(pattern).test(file)));
}

test('a functional spec file with cases and no decision rows fails the check', () => {
  const doc = '## The browser suite, case by case (#218)\n\n| `decided.spec.ts` "one" | stays | why |\n';
  const problems = decisionProblems(doc, { 'decided.spec.ts': "test('one',async()=>{});", 'undecided.spec.ts': "test('two',async()=>{});" });
  assert.deepEqual(problems, ['undecided.spec.ts: the cases still in the file are the ones that stay; no "stays" row for: two']);
});

test('every case of the functional project has its decision, and only kept cases are still in their file', () => {
  const doc = readFileSync('docs/testing.md', 'utf8');
  const sources = Object.fromEntries(functionalSpecs().map(file => [file, readFileSync(`tests/${file}`, 'utf8')]));
  assert.ok(Object.keys(sources).length > 30, 'the functional project lists its spec files');
  for (const file of ['visual.spec.ts', 'first-run.spec.ts', 'navigation.spec.ts', 'proxy/production-shape.spec.ts']) assert.ok(!(file in sources), `${file} is not in the functional project`);
  assert.deepEqual(decisionProblems(doc, sources), []);
});
