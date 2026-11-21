import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The approved prototype for the #284 build stays in design-reference/ for the comparison tool (design/COMPARE.md),
// which checks its SHA256SUMS before each capture (#271). The product never serves it.
function files(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? files(join(directory, entry.name), path) : [path];
  });
}

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
