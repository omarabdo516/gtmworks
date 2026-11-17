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

test('every lane starts the services lane 0 starts, and none starts Studio, the log services or the edge runtime (#259)', t => {
 const [first, ...others] = Array.from({ length: maxLanes }, (_, lane) => services(generated(t, lane)));
 assert.ok(first.includes('auth') && first.includes('storage'), `lane 0 starts ${first.join(', ')}`);
 for (const unused of ['studio', 'analytics', 'edge_runtime']) assert.ok(!first.includes(unused), `lane 0 starts ${unused}`);
 for (const [index, started] of others.entries()) assert.deepEqual(started, first, `lane ${index + 1}`);
});
