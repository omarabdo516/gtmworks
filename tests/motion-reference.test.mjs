import test from 'node:test';
import assert from 'node:assert/strict';
import { cssOf, easing, milliseconds, motionOf, productFiles, productStyles, readSheet, referenceFile, referenceStyles, tokenFile } from './motion-css.mjs';
import { builtToken, motionTable, motionTokens, sharedKeyframes } from './motion-table.mjs';
import { widths } from './visual-screens.mjs';

const reference = referenceStyles();
const product = productStyles(tokenFile);

test('the six motion tokens carry the reference’s values', () => {
  for (const token of motionTokens) {
    assert.ok(reference.tokens.has(token), `${referenceFile} :root defines ${token}`);
    assert.equal(product.tokens.get(builtToken(token)), reference.tokens.get(token), `${tokenFile} .gw ${builtToken(token)}`);
  }
});

// The times and curves a stylesheet writes as numbers, outside the motion tokens' own definitions.
const definitions = new RegExp(`--(?:gw-)?(?:${motionTokens.map(token => token.slice(2)).join('|')})\\s*:[^;}]*`, 'g');
/** @param {string} css */
const writtenNumbers = css => {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(definitions, '');
  return new Set([...[...text.matchAll(/(?<![\w.-])[\d.]+m?s\b/g)].map(([time]) => milliseconds(time)), ...[...text.matchAll(/cubic-bezier\([^)]*\)/g)].map(([curve]) => easing(curve))]);
};

test('a motion value the reference writes only through its token is written only through the token under app/', () => {
  const inReference = writtenNumbers(cssOf(referenceFile));
  const tokenOnly = motionTokens.map(token => reference.tokens.get(token) ?? '').map(value => value.endsWith('s') ? milliseconds(value) : easing(value))
    .filter(value => !inReference.has(value));
  assert.ok(tokenOnly.includes('280ms') && tokenOnly.includes('cubic-bezier(0.4, 0, 1, 1)'), `token-only values: ${tokenOnly.join(', ')}`);
  for (const file of productFiles()) {
    const written = writtenNumbers(cssOf(file));
    for (const value of tokenOnly) assert.ok(!written.has(value), `${file} writes ${value}; use its --gw- token`);
  }
});

test('the reference’s shared keyframes are written once, in app/shell.css, and no stylesheet repeats their frames', () => {
  const shell = readSheet(tokenFile);
  for (const [name, built] of Object.entries(sharedKeyframes)) {
    assert.ok(reference.keyframes.has(name), `${referenceFile} has @keyframes ${name}`);
    assert.equal(shell.keyframes.get(built), reference.keyframes.get(name), `${tokenFile} @keyframes ${built} moves as ${name}`);
  }
  const all = productFiles().flatMap(file => [...cssOf(file).matchAll(/@keyframes\s+([\w-]+)\s*\{/g)]
    .map(([, name]) => ({ file, name, frames: readSheet(file).keyframes.get(name) })));
  for (const [index, keyframe] of all.entries()) for (const other of all.slice(index + 1)) {
    assert.notEqual(other.name, keyframe.name, `@keyframes ${keyframe.name} is written in ${keyframe.file} and ${other.file}`);
    assert.notEqual(other.frames, keyframe.frames, `${other.file} @keyframes ${other.name} repeats ${keyframe.file} @keyframes ${keyframe.name}`);
  }
});

/** @param {import('./motion-css.mjs').Motion} motion */
const moves = motion => motion.animation.frames.length > 0 || motion.transition.durations.some(duration => parseFloat(duration) > 0);

for (const row of motionTable) {
  test(`${row.built} (${row.file}) moves as the reference’s ${row.ref}`, () => {
    const built = productStyles(row.file);
    assert.ok(motionOf(reference, row.ref, widths[0]), `${row.ref} is not in ${referenceFile}`);
    assert.ok(motionOf(built, row.built, widths[0]), `${row.built} is not in ${row.file}`);
    for (const width of widths) assert.deepEqual(motionOf(built, row.built, width), motionOf(reference, row.ref, width), `at ${width}px wide`);
    assert.ok(widths.some(width => moves(/** @type {import('./motion-css.mjs').Motion} */ (motionOf(reference, row.ref, width)))), `${row.ref} moves at some width`);
  });
}
