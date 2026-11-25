import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// #711: a Company's work sandbox holds its Screen, which its Agents share, so its default memory is set from one measured Screen awake
// with a page open (README, Server size). An install the previous release made may hold a Company whose own limit is
// below that default: the update raises it to the default, once, and never lowers one. A limit an Owner sets after that
// (`company limits`) is the Owner's and is kept. The installer's own functions run here against a folder of Engine files.

const install = readFileSync('scripts/install.sh', 'utf8');
const fn = name => {
  const start = install.indexOf(`\n${name}() {`);
  assert.ok(start >= 0, name);
  if (install.slice(start + 1).match(/^[a-z_]+\(\) \{ [^\n]*\}\n/)) return install.slice(start + 1, install.indexOf('\n', start + 1) + 1);
  return install.slice(start + 1, install.indexOf('\n}\n', start) + 3);
};
const helpers = ['engine_folder', 'sandbox_limit', 'write_limits', 'default_sandbox_memory', 'megabytes', 'raise_sandbox_memory'].map(fn).join('');
const template = readFileSync('scripts/engine-template.yml', 'utf8');
const defaultMemory = template.match(/mem_limit: \$\{SANDBOX_MEMORY:-([0-9]+[mg])\}/)[1];

function engines(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'gtmworks-sandbox-memory-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'scripts'));
  copyFileSync('scripts/engine-template.yml', join(dir, 'scripts/engine-template.yml'));
  for (const [slug, body] of Object.entries(files)) {
    mkdirSync(join(dir, '.engines', slug), { recursive: true });
    writeFileSync(join(dir, '.engines', slug, '.env'), body);
  }
  const run = body => spawnSync('sh', ['-c', `set -eu\nengine_template=scripts/engine-template.yml\n${helpers}${body}`], { cwd: dir, encoding: 'utf8' });
  const env = slug => readFileSync(join(dir, '.engines', slug, '.env'), 'utf8');
  return { run, env };
}

test("the default sandbox memory fits the Company's Screen awake with a page open beside a render", () => {
  // The measurement (README): the Screen awake with an ads page open peaked at 831 MiB of its sandbox's working set, and
  // one short render at 337 MiB. A Company has one awake Screen, shared by its Agents (vault decision 0068).
  const mib = Number(defaultMemory.slice(0, -1)) * (defaultMemory.endsWith('g') ? 1024 : 1);
  assert.equal(defaultMemory, '2g');
  assert.ok(mib > 831 + 337, 'a Screen beside a render');
  const readme = readFileSync('README.md', 'utf8');
  assert.match(readme, /\*\*2 GB of RAM and 2 CPUs\*\* by default/);
  assert.match(readme, /831 MiB/);
});

test('an update raises a Company limit below the default to it, once, and never lowers one', t => {
  const key = `ENGINE_KEY=${'a'.repeat(64)}\n`;
  const install = engines(t, {
    first: key,
    low: `${key}SANDBOX_MEMORY=1536m\nSANDBOX_CPUS=1.5\n`,
    lowgig: `${key}SANDBOX_MEMORY=1g\n`,
    high: `${key}SANDBOX_MEMORY=3g\n`,
  });
  const raised = install.run('for slug in first low lowgig high; do raise_sandbox_memory "$slug"; done');
  assert.equal(raised.status, 0, raised.stderr);
  // A Company with no limit of its own follows the template's default, which the update already raised.
  assert.doesNotMatch(install.env('first'), /^SANDBOX_MEMORY=/m);
  // One below the default gets the default; its CPUs and its key stay as they were.
  assert.match(install.env('low'), new RegExp(`^SANDBOX_MEMORY=${defaultMemory}$`, 'm'));
  assert.match(install.env('low'), /^SANDBOX_CPUS=1\.5$/m);
  assert.match(install.env('low'), /^ENGINE_KEY=a{64}$/m);
  assert.match(install.env('lowgig'), new RegExp(`^SANDBOX_MEMORY=${defaultMemory}$`, 'm'));
  // One above the default keeps its own.
  assert.match(install.env('high'), /^SANDBOX_MEMORY=3g$/m);
  assert.match(raised.stdout, /raised to 2g/);
  // The Owner lowers one again after the update: the next update keeps the Owner's choice.
  const lowered = install.run(`write_limits low 1g 1.5 && raise_sandbox_memory low`);
  assert.equal(lowered.status, 0, lowered.stderr);
  assert.match(install.env('low'), /^SANDBOX_MEMORY=1g$/m);
});
