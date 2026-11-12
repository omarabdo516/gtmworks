import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { screens, languages, widths, baselineFolder, baselineFile } from './visual-screens.mjs';

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('dark comparison includes Home, board, card and sign-in in both languages and widths', () => {
 const dark = screens.filter(screen => screen.dark);
 assert.deepEqual(dark.map(screen => screen.name).sort(), ['board-dark', 'card-dark', 'home-dark', 'sign-in-dark']);
 const images = dark.flatMap(screen => languages.flatMap(language => widths.map(width => baselineFile(screen, language, width))));
 assert.equal(images.length, 16);
 console.log('Dark baselines expected:\n' + images.join('\n'));
});

test('every listed screen has an approved image per language and width, and nothing else is approved', () => {
 const expected = screens.flatMap(screen => languages.flatMap(language => widths.map(width => baselineFile(screen, language, width)))).sort();
 assert.equal(expected.length, screens.length * languages.length * widths.length);
 assert.deepEqual([...languages].sort(), ['ar', 'en']);
 assert.deepEqual([...widths].sort((a, b) => a - b), [390, 1440]);
 assert.deepEqual(readdirSync(baselineFolder).sort(), expected);
});

test('approved images are PNG pictures at the width they are named for', () => {
 for (const screen of screens) for (const language of languages) for (const width of widths) {
  const bytes = readFileSync(`${baselineFolder}/${baselineFile(screen, language, width)}`);
  assert.ok(bytes.subarray(0, 8).equals(pngSignature), `${screen.name} ${language} ${width} is not a PNG`);
  assert.equal(bytes.readUInt32BE(16), width, `${screen.name} ${language} ${width} has another width`);
  assert.ok(bytes.readUInt32BE(20) >= 600, `${screen.name} ${language} ${width} is too short to be a screen`);
 }
});
