import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import manifest from '../app/manifest.ts';

// #453: a browser tab and an installed app show the gtmworks mark. A browser asks for the icon, the manifest and the
// icons it names without a session, so the sign-in gate must let them through and the manifest must exist at the
// address a browser asks for.
const require = createRequire(import.meta.url);
const { tryToParsePath } = require('next/dist/lib/try-to-parse-path');

// The middleware's matcher as Next reads it (config.matcher): a constant string in middleware.ts, which the test
// compiles the way Next does rather than restating it.
function matcherSources() {
  const file = ts.createSourceFile('middleware.ts', readFileSync('middleware.ts', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const config = file.statements.filter(ts.isVariableStatement).flatMap(statement => statement.declarationList.declarations)
    .find(declaration => declaration.name.getText() === 'config');
  const property = config.initializer.properties.find(property => property.name.getText() === 'matcher');
  return (property.initializer.elements ?? [property.initializer]).map(element => element.text);
}

// Whether the gate runs on a path: Next compiles each matcher source and tests it against the pathname.
const gated = path => matcherSources().some(source => {
  const parsed = tryToParsePath(source);
  assert.equal(parsed.error, undefined, `middleware matcher parses: ${source}`);
  return new RegExp(`^${parsed.regexStr}$`).test(path);
});

test('the sign-in gate lets the mark and the manifest through without a session, and still holds the app', () => {
  for (const path of ['/favicon.ico', '/manifest.webmanifest', '/apple-icon.png', '/icons/icon-192.png']) {
    assert.equal(gated(path), false, `${path} is served without a session`);
  }
  assert.equal(gated('/c/x/work/board'), true, 'the board still asks for a session');
});

test('the web app manifest names gtmworks and points at its two icons in public/', () => {
  const data = manifest();
  assert.equal(data.name, 'gtmworks');
  assert.equal(data.short_name, 'gtmworks');
  assert.equal(data.start_url, '/');
  assert.equal(data.display, 'standalone');
  assert.equal(data.theme_color, '#1C1C1C');
  assert.equal(data.background_color, '#FCFCFC');
  assert.deepEqual(data.icons, [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
  ]);
  for (const icon of data.icons) assert.ok(existsSync(`public${icon.src}`), `public${icon.src} exists`);
});
