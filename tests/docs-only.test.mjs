import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { resolve } from 'node:path';

const script = resolve('scripts/docs-only.mjs');
const classify = (...paths) => execFileSync(process.execPath, [script, ...paths], { encoding: 'utf8', input: '' });

test('only design files skip the long stages', () => {
  assert.equal(classify('design/conversation.html', 'design/screenshots/conversation.png'), 'true\n');
});

test('Markdown and docs files skip the long stages', () => {
  assert.equal(classify('README.md'), 'true\n');
  assert.equal(classify('docs/api/openapi.yaml', 'docs/adr/decision.md', 'AGENTS.md'), 'true\n');
});

for (const [name, paths] of [
  ['docs plus app', ['docs/api/openapi.yaml', 'app/page.tsx']],
  ['tests', ['tests/frame.spec.ts']],
  ['workflow', ['.github/workflows/ci.yml']],
  ['a design rename into app', ['design/old.html', 'app/new.html']],
  ['a code rename into docs', ['lib/old.mjs', 'docs/new.mjs']],
]) {
  test(`${name} changes run both long stages`, () => {
    assert.equal(classify(...paths), 'false\n');
  });
}

test('Markdown under public runs both long stages because a browser test reads it', () => {
  assert.equal(classify('public/nested/README.md'), 'false\n');
});

test('stdin accepts NUL-separated git paths without splitting spaces or newlines', () => {
  const input = 'design/a page.html\0docs/a\npage.yaml\0';
  assert.equal(execFileSync(process.execPath, [script], { encoding: 'utf8', input }), 'true\n');
});

test('an empty, malformed or unreadable list runs both long stages', t => {
  for (const paths of [[], [''], ['design/../app/page.tsx'], ['/docs/guide.md'], ['docs//guide.md']]) {
    assert.equal(classify(...paths), 'false\n');
  }
  assert.equal(execFileSync(process.execPath, [script], { encoding: 'utf8', input: 'docs/guide.md\0\0' }), 'false\n');
  const directory = openSync('.', 'r');
  t.after(() => closeSync(directory));
  const unreadable = spawnSync(process.execPath, [script], { encoding: 'utf8', stdio: [directory, 'pipe', 'pipe'] });
  assert.equal(unreadable.status, 0);
  assert.equal(unreadable.stdout, 'false\n');
});
