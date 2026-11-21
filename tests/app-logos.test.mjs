import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { logoOf } from '../components/logos.ts';
import { apps, customApp, knownApp } from '../lib/app-catalogue.mjs';
import { markOf } from '../lib/app-mark.mjs';
import en from '../lib/messages/apps.en.json' with { type: 'json' };

// #577: every connectable app shows its company's own logo, a file of this install. The catalogue's apps are the
// `use.<key>` entries of its messages; `command`, `custom` and `own` name no company and keep their letter.
const noCompany = new Set(['command', 'custom', 'own']);
// DeepWiki's site refuses every request from outside a browser, so its official mark is still to be taken (#580).
const waiting = new Set(['deepwiki']);
const keys = Object.keys(en).filter(key => key.startsWith('use.')).map(key => key.slice(4)).filter(key => !noCompany.has(key) && !waiting.has(key));

test('every app of the catalogue maps to a logo file in public/', () => {
  assert.ok(keys.length >= 84, `${keys.length} apps`);
  for (const key of keys) {
    const file = logoOf(key);
    assert.ok(file, `${key} has a logo`);
    assert.ok(existsSync(`public${file}`), `${key}: public${file} exists`);
  }
  for (const app of apps.filter(app => !noCompany.has(app.key) && !waiting.has(app.key))) assert.ok(logoOf(app.key), `${app.key} has a logo`);
  // A ready-made role's app with no drawn mark of its own (#424) takes its file too.
  assert.equal(logoOf('github'), '/logos/simple/github.svg');
  for (const key of waiting) assert.equal(logoOf(key), null, `${key} is still waiting: take it off the list once its file is in`);
});

// Each mark is the company the app is: these keys name a company another product shares a name with.
test('a shared name takes the right company\'s mark', () => {
  assert.equal(logoOf('apollo'), '/logos/brand/apollo.svg', 'Apollo.io, not Apollo GraphQL');
  assert.equal(logoOf('close'), '/logos/brand/close.svg', 'Close CRM');
  assert.equal(logoOf('make'), '/logos/simple/make.svg', 'Make.com');
  assert.match(readFileSync('public/logos/simple/make.svg', 'utf8'), /<title>Make<\/title>/);
  assert.match(logoOf('kiwi') ?? '', /^\/logos\/brand\/kiwi\.(svg|png)$/, 'Kiwi.com');
});

// A logo ships inside the install and draws nothing from outside: no script, no handler, no address of another site.
test('every logo file is a static image of the install', () => {
  for (const set of ['simple', 'lobe', 'brand']) for (const name of readdirSync(`public/logos/${set}`).filter(name => /\.svg$/.test(name))) {
    const svg = readFileSync(`public/logos/${set}/${name}`, 'utf8');
    assert.match(svg, /^<svg[\s>]/, `${set}/${name} is an SVG`);
    assert.match(svg, /viewBox=/, `${set}/${name} scales`);
    assert.doesNotMatch(svg, /<script|<foreignObject|<image|\son[a-z]+=|(?:xlink:)?href="(?!#)/i, `${set}/${name} is static`);
  }
});

// Each brand file names the official page it came from; the two icon sets keep their licences beside their files.
test('public/logos/brand/SOURCES.md names the official page of every brand file', () => {
  const sources = readFileSync('public/logos/brand/SOURCES.md', 'utf8');
  const files = readdirSync('public/logos/brand').filter(name => /\.(svg|png)$/.test(name));
  assert.ok(files.length > 0);
  for (const name of files) assert.match(sources, new RegExp(`\`${name.replace('.', '\\.')}\`[^\\n]*https://`), `${name} has its source page`);
  assert.ok(existsSync('public/logos/simple/LICENSE.md'));
  assert.ok(existsSync('public/logos/lobe/LICENSE'));
});

// A letter mark has one rule: the first letter of the name, uppercase.
test('a letter mark is the first letter of the name, uppercase', () => {
  assert.equal(markOf('Better Stack'), 'B');
  assert.equal(markOf(' n8n'), 'N');
  assert.equal(markOf('كانفا'), 'ك');
  assert.equal(markOf(''), '·');
  for (const app of apps) assert.equal(app.mark, markOf(app.name), app.key);
  assert.equal(customApp('my-crm').mark, 'M');
  assert.equal(knownApp('Google Analytics')?.mark, 'G');
});
