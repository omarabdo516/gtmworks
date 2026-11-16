import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

// A component test whose imports reach `server-only` (lib/i18n-server.ts imports it) stops Vite's dependency scan on a
// cold cache in CI: nothing is pre-bundled, Vite finds React and the Next and Supabase packages mid-run, reloads, React
// loads twice and every test of the shard fails (#218; #220, #221, #223). Main's component tests reach next/cache and
// @supabase/ssr through server actions and pass, so those packages alone are not the fault.
const serverPackages = ['server-only'];
const extensions = ['', '.tsx', '.ts', '.mjs', '.js', '/index.tsx', '/index.ts'];
const specifiers = source => [...source.matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)].map(match => match[1]);

function resolveImport(root, from, specifier) {
  const base = specifier.startsWith('@/') ? join(root, specifier.slice(2)) : specifier.startsWith('.') ? resolve(dirname(from), specifier) : null;
  return base && extensions.map(extension => base + extension).find(path => existsSync(path) && !readdirSafe(path));
}
const readdirSafe = path => { try { readdirSync(path); return true; } catch { return false; } };

/** The first import chain from `file` that reaches a server module, as a list of paths ending in the module, or null. */
export function serverChain(root, file, seen = new Set()) {
  if (seen.has(file)) return null;
  seen.add(file);
  const source = readFileSync(file, 'utf8');
  for (const specifier of specifiers(source)) {
    if (serverPackages.some(name => specifier === name || specifier.startsWith(`${name}/`))) return [relative(root, file), specifier];
    const next = resolveImport(root, file, specifier);
    const chain = next && serverChain(root, next, seen);
    if (chain) return [relative(root, file), ...chain];
  }
  return null;
}

export const failure = chain => `${chain[0]} reaches the server module ${chain.at(-1)} through ${chain.join(' -> ')}. `
  + 'Vite cannot pre-bundle it on a cold cache and reloads mid-run with a second React. Render the component from a client module of its own that imports no server code.';

test('no component test imports, directly or through another file, a server module', () => {
  const root = process.cwd();
  const tests = readdirSync('tests/components').filter(name => name.endsWith('.test.tsx')).map(name => join(root, 'tests/components', name));
  assert.ok(tests.length > 0);
  assert.deepEqual(tests.map(file => serverChain(root, file)).filter(Boolean).map(failure), []);
});

test('a chain to a server module is named from the test file to the module', () => {
  const root = mkdtempSync(join(tmpdir(), 'component-imports-'));
  try {
    for (const [path, source] of Object.entries({
      'tests/components/menu.test.tsx': "import Menu from '@/app/menu';\nimport type { Shape } from '@/lib/shape';\n",
      'app/menu.tsx': "'use client';\nimport { save } from './actions';\n",
      'app/actions.ts': "import { read } from '../lib/i18n-server';\n",
      'lib/i18n-server.ts': "import 'server-only';\n",
      'lib/shape.ts': "import 'server-only';\n",
    })) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source); }
    const chain = serverChain(root, join(root, 'tests/components/menu.test.tsx'));
    assert.deepEqual(chain, ['tests/components/menu.test.tsx', 'app/menu.tsx', 'app/actions.ts', 'lib/i18n-server.ts', 'server-only']);
    assert.match(failure(chain), /^tests\/components\/menu\.test\.tsx reaches the server module server-only through .* Render the component from a client module/);
    writeFileSync(join(root, 'app/menu.tsx'), "'use client';\nimport { useState } from 'react';\n");
    assert.equal(serverChain(root, join(root, 'tests/components/menu.test.tsx')), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
