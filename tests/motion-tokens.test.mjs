import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The product's own motion, read from its stylesheets (#127, kept by #271 when the comparison with the frozen design
// reference retired): the six motion tokens on `.gw` are the ones the design sidecar names, and each keyframe is written
// once under app/.
const tokenFile = 'app/tokens.css';
const tokens = ['gw-dur-fast', 'gw-dur', 'gw-dur-slow', 'gw-ease-out', 'gw-ease-in', 'gw-ease-spring'];
const stylesheets = readdirSync('app').filter(file => file.endsWith('.css')).map(file => join('app', file)).sort();
/** @param {string} file */
const css = file => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('the design sidecar names the six motion tokens with the values app/tokens.css carries', () => {
  const sidecar = JSON.parse(readFileSync('.impeccable/design.json', 'utf8')).extensions.motion;
  const sheet = css(tokenFile);
  for (const name of tokens) {
    const value = sheet.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`))?.[1].trim();
    assert.ok(value, `${tokenFile} defines --${name}`);
    assert.equal(sidecar.find((/** @type {{ name: string }} */ entry) => entry.name === name)?.value, value, `.impeccable/design.json motion ${name}`);
  }
});

test('every keyframe under app/ is written once, under one name, and no two names hold the same frames', () => {
  /** @type {{ file: string, name: string, frames: string }[]} */
  const all = [];
  for (const file of stylesheets) {
    const text = css(file);
    for (const match of text.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
      let depth = 0, end = match.index + match[0].length - 1;
      for (; end < text.length; end++) {
        if (text[end] === '{') depth++;
        if (text[end] === '}' && --depth === 0) break;
      }
      all.push({ file, name: match[1], frames: text.slice(match.index + match[0].length, end).replace(/\s+/g, '') });
    }
  }
  assert.ok(all.some(keyframe => keyframe.name === 'gw-fade-in'), 'app/shell.css writes gw-fade-in');
  for (const [index, keyframe] of all.entries()) for (const other of all.slice(index + 1)) {
    assert.notEqual(other.name, keyframe.name, `@keyframes ${keyframe.name} is written in ${keyframe.file} and ${other.file}`);
    assert.notEqual(other.frames, keyframe.frames, `${other.file} @keyframes ${other.name} repeats ${keyframe.file} @keyframes ${keyframe.name}`);
  }
});
