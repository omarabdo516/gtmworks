import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('LICENSE holds the standard MIT text with the owner copyright', () => {
  const licence = read('LICENSE');
  assert.ok(licence.startsWith('MIT License'));
  assert.ok(licence.includes('Copyright (c) 2026 Omar Abdelrahman'));
  const permission = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:`;
  assert.ok(licence.includes(permission));
});

test('package.json declares MIT and stays private', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.private, true);
});

test('README has a Licence section naming MIT with a working link', () => {
  const readme = read('README.md');
  const section = readme.match(/^## Licence\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  assert.ok(section, 'README has a "## Licence" section');
  assert.match(section[1], /\bMIT\b/);
  const link = section[1].match(/\]\(([^)]+)\)/);
  assert.ok(link, 'the Licence section links somewhere');
  assert.equal(link[1], 'LICENSE');
  assert.ok(existsSync(resolve(root, link[1])));
});

test('no tracked file links to removed issues 1 to 22', () => {
  const removed = /issues\/([1-9]|1[0-9]|2[0-2])\b/;
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file && file !== 'tests/license.test.mjs');
  assert.ok(files.length > 0);
  const hits = files.filter((file) => {
    const path = resolve(root, file);
    return existsSync(path) && removed.test(readFileSync(path, 'utf8'));
  });
  assert.deepEqual(hits, []);
});
