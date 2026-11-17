import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { maxLanes } from './lane.mjs';

// The services a generated stack configuration starts: each top-level section whose own `enabled` line is true.
function services(config) {
 const started = new Set();
 let section = '';
 for (const line of config.split('\n')) {
  section = line.match(/^\[([^\]]+)\]$/)?.[1] ?? section;
  if (!section.includes('.') && line === 'enabled = true') started.add(section);
 }
 return [...started].sort();
}

// The configuration scripts/local-db.sh writes for a lane, without starting anything.
function generated(t, lane) {
 const dir = mkdtempSync(join(tmpdir(), `gtmworks-lane-${lane}-`));
 t.after(() => rmSync(dir, { recursive: true, force: true }));
 const run = spawnSync('bash', ['scripts/local-db.sh', '--config-only', dir], { env: { ...process.env, LANE: String(lane) }, encoding: 'utf8' });
 assert.equal(run.status, 0, run.stderr);
 return readFileSync(join(dir, 'supabase/config.toml'), 'utf8');
}

test('lane 0 starts the same services as every other lane (#259)', t => {
 const first = services(generated(t, 0));
 assert.ok(first.includes('auth') && first.includes('storage'), `lane 0 starts ${first.join(', ')}`);
 for (let n = 1; n < maxLanes; n++) assert.deepEqual(services(generated(t, n)), first, `lane ${n}`);
});

test('no lane starts Studio, the log services or the edge runtime, which no test uses (#259)', t => {
 for (let n = 0; n < maxLanes; n++) {
  const started = services(generated(t, n));
  for (const unused of ['studio', 'analytics', 'edge_runtime']) assert.ok(!started.includes(unused), `lane ${n} starts ${unused}`);
 }
});
