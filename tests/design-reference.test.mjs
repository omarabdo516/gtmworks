import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The approved prototype for the #284 build is copied unchanged into design-reference/ with its SHA256SUMS (#285).
const root = 'design-reference';

function listed() {
  return readFileSync(join(root, 'SHA256SUMS'), 'utf8').split('\n').filter(Boolean).map(line => {
    const match = line.match(/^([0-9a-f]{64}) [ *](.+)$/);
    assert.ok(match, `SHA256SUMS line is not "<sha256>  <path>": ${line}`);
    return { sum: match[1], path: match[2].replace(/^\.\//, '') };
  });
}

function files(directory = root, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? files(join(directory, entry.name), path) : [path];
  });
}

test('every file of the design reference matches the approved checksum', () => {
  const entries = listed();
  assert.ok(entries.length > 0, 'SHA256SUMS lists files');
  assert.ok(entries.some(entry => entry.path === 'index.html'), 'the reference has index.html');
  for (const { sum, path } of entries) {
    assert.ok(existsSync(join(root, path)), `listed file is missing: ${path}`);
    assert.equal(createHash('sha256').update(readFileSync(join(root, path))).digest('hex'), sum, `changed: ${path}`);
  }
});

test('the design reference holds no file that SHA256SUMS does not list', () => {
  const known = new Set(listed().map(entry => entry.path));
  assert.deepEqual(files().filter(path => path !== 'SHA256SUMS' && !known.has(path)), []);
});

test('the product never serves the design reference', () => {
  // Next serves only its routes and public/; neither may carry the reference or point to it.
  assert.ok(!existsSync('public/design-reference'), 'public/ does not hold the reference');
  if (existsSync('public')) {
    const exposing = files('public').filter(path => readFileSync(join('public', path)).includes('design-reference'));
    assert.deepEqual(exposing, [], 'no public file points at the reference');
  }
  const config = readFileSync('next.config.mjs', 'utf8');
  assert.doesNotMatch(config, /design-reference/, 'next.config.mjs does not name the reference');
  assert.doesNotMatch(config, /\b(rewrites|redirects)\b/, 'next.config.mjs has no rewrite or redirect');
  assert.ok(!existsSync('app/design-reference'), 'no app route is named for the reference');
  const docker = readFileSync('Dockerfile', 'utf8');
  assert.doesNotMatch(docker, /design-reference/, 'the runtime image does not copy the reference');
});
