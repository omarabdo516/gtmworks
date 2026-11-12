import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function sandbox(t) {
 const output = resolve('test-results');
 mkdirSync(output, { recursive: true });
 const dir = mkdtempSync(join(output, 'discovery-'));
 t.after(() => rmSync(dir, { recursive: true, force: true }));
 copyFileSync('package.json', join(dir, 'package.json'));
 return dir;
}

function ciSandbox(t) {
 const dir = sandbox(t);
 for (const path of ['tests', 'scripts']) mkdirSync(join(dir, path));
 for (const path of ['ci.sh', 'tests/db.sh', 'scripts/check-test-discovery.mjs']) copyFileSync(path, join(dir, path));
 symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
 writeFileSync(join(dir, 'playwright.config.mjs'), "export default { testDir: './tests', testMatch: '*.spec.ts', testIgnore: '**/ignored.spec.ts' };\n");
 return dir;
}

const command = (dir, executable, args) => spawnSync(executable, args, {
 cwd: dir, encoding: 'utf8', timeout: 30000,
 // Nested node --test needs its own runner context, including on Node 22.
 env: { ...process.env, CI: '', NODE_TEST_CONTEXT: undefined },
});

test('npm test discovers a new nested unit file and reports its failing assertion', t => {
 const dir = sandbox(t);
 mkdirSync(join(dir, 'tests/nested'), { recursive: true });
 writeFileSync(join(dir, 'tests/nested/new.test.mjs'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('new unit discovery probe', () => assert.fail('discovered failing assertion'));
`);
 const result = command(dir, 'npm', ['test']);
 assert.notEqual(result.status, 0);
 assert.match(result.stdout + result.stderr, /discovered failing assertion/);
 writeFileSync(join(dir, 'tests/nested/new.test.mjs'), "import { test } from 'node:test'; test('passing discovered unit', () => {});\n");
 const passing = command(dir, 'npm', ['test']);
 assert.equal(passing.status, 0, passing.stdout + passing.stderr);
 assert.match(passing.stdout, /passing discovered unit/);
});

test('ci.sh check rejects an orphan test by name before starting other checks', t => {
 const dir = ciSandbox(t);
 writeFileSync(join(dir, 'tests/orphan.spec.mjs'), 'throw new Error("must never execute the orphan");\n');
 writeFileSync(join(dir, 'tests/ignored.spec.ts'), 'throw new Error("must never execute the orphan");\n');
 mkdirSync(join(dir, 'lib'));
 writeFileSync(join(dir, 'lib/forgotten.test.mjs'), 'throw new Error("must never execute the orphan");\n');
 const result = command(dir, 'bash', ['ci.sh', 'check']);
 assert.equal(result.status, 1, result.stderr);
 assert.match(result.stdout + result.stderr, /No runner discovers: tests\/orphan\.spec\.mjs/);
 assert.match(result.stdout + result.stderr, /No runner discovers: tests\/ignored\.spec\.ts/);
 assert.match(result.stdout + result.stderr, /No runner discovers: lib\/forgotten\.test\.mjs/);
 assert.doesNotMatch(result.stdout + result.stderr, /must never execute the orphan/);
});

test('discovery accepts unit, browser, recursive database tests and the existing database scripts and helpers', t => {
 const dir = ciSandbox(t);
 mkdirSync(join(dir, 'supabase/tests/nested'), { recursive: true });
 mkdirSync(join(dir, 'tests/new.spec.ts-snapshots'));
 for (const path of ['tests/new.spec.ts-snapshots/home-visual-linux.png', 'supabase/tests/nested/new.sql', 'supabase/tests/nested/new.pg', 'tests/new.test.mjs',
  'tests/function-grants-migration.mjs', 'tests/agent-role-backfill.mjs', 'tests/bootstrap-db.mjs',
  'tests/sign-in.ts', 'tests/navigation-measure.ts']) writeFileSync(join(dir, path), '');
 writeFileSync(join(dir, 'tests/new.spec.ts'), "import { test } from '@playwright/test'; test('collected browser test', () => {});\n");
 const result = command(dir, 'node', ['scripts/check-test-discovery.mjs']);
 assert.equal(result.status, 0, result.stdout + result.stderr);
 assert.match(result.stdout, /Test discovery: 0 orphan\(s\)/);
});
