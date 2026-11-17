import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { findProviderHosts } from '../scripts/provider-hosts.mjs';

// No test reaches a real model provider (#266): no tracked file under tests/ names a provider host. The product's own
// scripts may name one (an install step), so they are not read. The hosts in
// this file are built from parts, so the check does not read them.
const host = (...parts) => parts.join('.');

test('no test or helper names a real model provider host', () => {
  // git lists the tracked text files itself, so the approved images are never read.
  const files = execFileSync('git', ['grep', '-I', '--name-only', '-e', '', '--', 'tests'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    .map(path => ({ path, text: readFileSync(path, 'utf8') }));
  assert.ok(files.some(file => file.path === 'tests/fake-hermes.mjs'), 'the scan reads the helpers');
  assert.deepEqual(findProviderHosts(files), []);
});

test('a provider host or one under it is reported with its file, line and host; a lookalike or a bare word is not', () => {
  const text = [
    `const link = 'https://${host('auth', 'openai', 'com')}/codex/device';`,
    `fetch('https://${host('OpenRouter', 'ai')}/api/v1', { body: 'openrouter' });`,
    `const fine = ['${host('notopenai', 'com')}', '${host('openai', 'com', 'example')}', 'openrouter', '${host('auth', 'provider', 'test')}'];`,
    `ws://${host('api', 'x', 'ai')}:443 and ${host('generativelanguage', 'googleapis', 'com')}`,
    `${host('us-central1-aiplatform', 'googleapis', 'com')} ${host('team', 'openai', 'azure', 'com')} ${host('bedrock-runtime', 'us-east-1', 'amazonaws', 'com')} ${host('s3', 'amazonaws', 'com')}`,
  ].join('\n');
  assert.deepEqual(findProviderHosts([{ path: 'tests/fixture.mjs', text }]), [
    { path: 'tests/fixture.mjs', line: 1, host: host('auth', 'openai', 'com') },
    { path: 'tests/fixture.mjs', line: 2, host: host('openrouter', 'ai') },
    { path: 'tests/fixture.mjs', line: 4, host: host('api', 'x', 'ai') },
    { path: 'tests/fixture.mjs', line: 4, host: host('generativelanguage', 'googleapis', 'com') },
    { path: 'tests/fixture.mjs', line: 5, host: host('us-central1-aiplatform', 'googleapis', 'com') },
    { path: 'tests/fixture.mjs', line: 5, host: host('team', 'openai', 'azure', 'com') },
    { path: 'tests/fixture.mjs', line: 5, host: host('bedrock-runtime', 'us-east-1', 'amazonaws', 'com') },
  ]);
});
