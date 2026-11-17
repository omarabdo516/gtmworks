import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { choose, outputLine, run, steps } from '../scripts/ci-fast.mjs';

// The fast job (#258, spec #255 D1): static, unit and component tests run as parallel steps of one command, and each
// step reports its own result, so a red lint leaves the rest green and readable.
function quiet() {
  const written = [];
  return { written, write: text => written.push(text) };
}

test('the steps run at the same time: each waits for the other to have started', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-fast-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const meetsOther = (mine, other) => `touch ${dir}/${mine}; for i in $(seq 100); do [ -e ${dir}/${other} ] && exit 0; sleep 0.05; done; exit 1`;
  const { write } = quiet();
  const results = await run([{ name: 'a', command: meetsOther('a', 'b') }, { name: 'b', command: meetsOther('b', 'a') }], { write, env: {} });
  assert.deepEqual(results.map(({ name, result }) => [name, result]), [['a', 'success'], ['b', 'success']]);
});

test('a failing step is red, the others still finish green, and its own output is shown', async () => {
  const { written, write } = quiet();
  const results = await run([
    { name: 'lint', command: 'echo "app/page.tsx: no-unused-vars" >&2; exit 1' },
    { name: 'typecheck', command: 'echo types fine' },
    { name: 'node', command: 'sleep 0.2; echo node fine' },
  ], { write, env: {} });
  assert.deepEqual(results.map(({ name, result }) => [name, result]), [['lint', 'failure'], ['typecheck', 'success'], ['node', 'success']]);
  const text = written.join('');
  assert.match(text, /app\/page\.tsx: no-unused-vars/);
  assert.match(text, /node fine/);
  assert.match(text, /^fast lint: failure$/m);
  assert.match(text, /^fast typecheck: success$/m);
  assert.equal(outputLine(results), 'steps=lint=failure typecheck=success node=success');
});

test('on GitHub a green step folds into a group and a red one stays open with an error on the run', async () => {
  const { written, write } = quiet();
  await run([{ name: 'lint', command: 'echo broken; exit 2' }, { name: 'knip', command: 'echo clean' }], { write, env: { GITHUB_ACTIONS: 'true' } });
  const text = written.join('');
  assert.match(text, /^::group::fast knip: success \([\d.]+ s\)\nclean\n::endgroup::$/m);
  assert.doesNotMatch(text, /::group::fast lint/);
  assert.match(text, /^::error title=fast lint::lint failed \(exit 2\); its output is in the log below$/m);
});

test('a step that runs tests waits for the gate, and does not start when it fails; the others run beside the gate', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-fast-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { write } = quiet();
  // The gate finishes only once lint has started, so lint must start beside it; node must not have started yet.
  const gate = code => `for i in $(seq 100); do [ -e ${dir}/lint ] && break; sleep 0.05; done; [ -e ${dir}/lint ] && [ ! -e ${dir}/node ] && exit ${code}; exit 9`;
  const list = [
    { name: 'discovery', command: gate(3), gate: true },
    { name: 'lint', command: `touch ${dir}/lint` },
    { name: 'node', command: `touch ${dir}/node`, gated: true },
  ];
  const red = await run(list, { write, env: {} });
  assert.deepEqual(red.map(({ name, result }) => [name, result]), [['discovery', 'failure'], ['lint', 'success'], ['node', 'skipped']]);
  assert.throws(() => readFileSync(join(dir, 'node')));
  rmSync(join(dir, 'lint'));
  list[0].command = gate(0);
  const green = await run(list, { write, env: {} });
  assert.deepEqual(green.map(({ name, result }) => [name, result]), [['discovery', 'success'], ['lint', 'success'], ['node', 'success']]);
});

test('a step that yields runs at a lower CPU priority than the rest', async () => {
  const { written, write } = quiet();
  await run([{ name: 'lint', command: 'echo "lint nice=$(ps -o ni= -p $$ | tr -d " ")"' }, { name: 'node', command: 'echo "node nice=$(ps -o ni= -p $$ | tr -d " ")"', yields: true }], { write, env: {} });
  const nice = name => Number(written.join('').match(new RegExp(`${name} nice=(\\d+)`))[1]);
  assert.ok(nice('node') > nice('lint'), written.join(''));
});

test('a step\'s output reaches its log in the ledger folder while it runs, so a hung step leaves its log behind', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-fast-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { write } = quiet();
  // The step waits until its first line is in its log; held in memory, it would never see it and would fail.
  const command = `echo early; for i in $(seq 100); do grep -q early "$LEDGER/components.log" 2>/dev/null && exit 0; sleep 0.05; done; exit 1`;
  const [result] = await run([{ name: 'components', command }], { write, env: { LEDGER: dir } });
  assert.equal(result.result, 'success');
  assert.equal(readFileSync(join(dir, 'components.log'), 'utf8'), 'early\n');
});

test('a failed step\'s output comes last, after the summary, so the job ends where the failure is', async () => {
  const { written, write } = quiet();
  await run([
    { name: 'openapi', command: 'echo "npm error code E429"; exit 1' },
    { name: 'lint', command: 'sleep 0.3; seq 40' },
  ], { write, env: {} });
  const lines = written.join('').trimEnd().split('\n');
  assert.equal(lines.at(-1), 'npm error code E429');
  assert.ok(lines.indexOf('fast lint: success') < lines.indexOf('npm error code E429'));
});

test('a ledger folder that cannot be written loses the logs, not the run', async () => {
  const { written, write } = quiet();
  const results = await run([{ name: 'lint', command: 'echo linted' }], { write, env: { LEDGER: join(tmpdir(), `ci-fast-missing-${process.pid}`, 'deeper') } });
  assert.deepEqual(results, [{ name: 'lint', result: 'success' }]);
  assert.match(written.join(''), /linted/);
});

test('a skipped step does not run and is listed as skipped', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-fast-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { write } = quiet();
  const results = await run([{ name: 'components', command: `touch ${dir}/ran` }, { name: 'lint', command: 'true' }], { write, env: {}, skip: ['components'] });
  assert.deepEqual(results.map(({ name, result }) => [name, result]), [['components', 'skipped'], ['lint', 'success']]);
  assert.throws(() => readFileSync(join(dir, 'ran')));
});

test('a step sees the ledger folder it writes its test records to', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-fast-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { write } = quiet();
  await run([{ name: 'node', command: 'echo "{}" > "$LEDGER/node.jsonl"' }], { write, env: { LEDGER: dir } });
  assert.equal(readFileSync(join(dir, 'node.jsonl'), 'utf8'), '{}\n');
});

test('the fast layer is the static checks, the node tests and the component tests, each writing its ledger records', () => {
  assert.deepEqual(steps.map(step => step.name), ['discovery', 'docs', 'i18n', 'openapi', 'lint', 'typecheck', 'knip', 'node', 'components']);
  const command = name => steps.find(step => step.name === name).command;
  assert.match(command('node'), /--test-reporter-destination="\$LEDGER\/node\.jsonl" 'tests\/\*\*\/\*\.test\.mjs'$/);
  assert.match(command('components'), /npm run test:components -- .*--outputFile\.json="\$LEDGER\/vitest\.json"/);
  assert.doesNotMatch(command('components'), /shard/i);
  // In CI the workflow restores or installs the browser; elsewhere the step installs it, behind the discovery gate.
  assert.match(command('components'), /^\{ \[ "\$\{CI:-\}" = true \] \|\| npx playwright install chromium; \} && npm run test:components /);
  assert.doesNotMatch(readFileSync('ci.sh', 'utf8'), /install_chromium; fi\n  node scripts\/ci-fast/);
  // A restored npx folder is used with no registry request; a missing one is filled once.
  assert.match(command('openapi'), /^npx --prefer-offline --yes @redocly\/cli@[\d.]+ /);
  assert.deepEqual(steps.filter(step => step.gate).map(step => step.name), ['discovery']);
  assert.deepEqual(steps.filter(step => step.gated).map(step => step.name), ['node', 'components']);
  // The one-thread checks keep their priority; the test runners, which use every core, take what is left.
  assert.deepEqual(steps.filter(step => step.yields).map(step => step.name), ['node', 'components']);
  assert.match(readFileSync('ci.sh', 'utf8'), /^ {2}node scripts\/ci-fast\.mjs "\$dir"/m);
});

test('typecheck reads no file that the tests running beside it write and delete', async t => {
  const { execFileSync } = await import('node:child_process');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const probes = ['test-results', 'playwright-report', 'ci-ledger'].map(folder => join(folder, `typecheck-probe-${process.pid}.ts`));
  for (const probe of probes) {
    mkdirSync(join(probe, '..'), { recursive: true });
    writeFileSync(probe, 'export const probe: number = "not a number";\n');
    t.after(() => rmSync(probe, { force: true }));
  }
  const { files } = JSON.parse(execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--showConfig'], { encoding: 'utf8' }));
  assert.ok(files.some(file => file.startsWith('./app/')), 'the program still holds the app');
  for (const probe of probes) assert.ok(!files.includes(`./${probe}`), probe);
});

test('a chosen step that runs tests keeps the discovery gate; a choice of checks alone does not add it', () => {
  const names = only => choose(steps, only).map(step => step.name);
  assert.deepEqual(names(['components']), ['discovery', 'components']);
  assert.deepEqual(names(['node', 'lint']), ['discovery', 'lint', 'node']);
  assert.deepEqual(names(['lint']), ['lint']);
  assert.deepEqual(names(undefined), steps.map(step => step.name));
});
