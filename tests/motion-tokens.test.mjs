import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The product's own motion, read from its stylesheets (#127, kept by #271 when the comparison with the frozen design
// reference retired): the six motion tokens on `.gw` are the ones the design sidecar names, and each keyframe is written
// once under app/.
const tokenFile = 'app/tokens.css';
const tokens = ['gw-dur-fast', 'gw-dur', 'gw-dur-slow', 'gw-ease-out', 'gw-ease-in', 'gw-ease-spring'];
/** @param {string} dir @returns {string[]} every stylesheet under dir, its folders included */
const cssUnder = dir => readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => (entry.isDirectory() ? cssUnder(join(dir, entry.name)) : entry.name.endsWith('.css') ? [join(dir, entry.name)] : []));
const stylesheets = cssUnder('app').sort();
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

// No part names `transition: all` (#566). A stylesheet under app/ lists the properties each transition moves: a
// `transition` shorthand whose item names no property, or names `all`, would fade whatever a later rule changes (size,
// place, colour) on every part it reaches under `.gw`. `none` is allowed. The same holds for Tailwind's `transition-all`
// in our own components; the scoped Paperclip copies in components/paperclip/ keep their upstream classes.
// A property name is never a function, so every function (var(), calc(), min(), clamp(), cubic-bezier(), steps()) is a
// time, a curve or a value, never the property.
const timing = /^(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|normal|allow-discrete|[+-]?[\d.]+m?s|[\w-]+\(.*)$/;
/** @param {string} value @param {RegExp} separator */
const topLevel = (value, separator) => {
  /** @type {string[]} */
  const parts = [];
  let depth = 0, start = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (depth === 0 && separator.test(char)) { parts.push(value.slice(start, index)); start = index + 1; }
  }
  parts.push(value.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
};
/**
 * The problems in one stylesheet's transitions, each as `line <n>: reason`.
 * @param {string} text the stylesheet, comments removed and lower-cased
 */
const unlistedTransitions = text => {
  /** @type {string[]} */
  const problems = [];
  for (const match of text.matchAll(/(?<![\w-])(?:-webkit-)?transition(-property)?\s*:\s*([^;}]+)/g)) {
    const line = text.slice(0, match.index).split('\n').length;
    const value = match[2].replace(/!\s*important\s*$/, '').trim();
    if (match[1]) {
      if (topLevel(value, /,/).some(name => name === 'all')) problems.push(`line ${line}: transition-property: ${value} names all`);
      continue;
    }
    if (value === 'none') continue;
    for (const item of topLevel(value, /,/)) {
      // The property may stand anywhere in the item (`200ms ease opacity` is valid CSS): every token that is not a time,
      // a curve, a keyword or a var() names it.
      const properties = topLevel(item, /\s/).filter(token => !timing.test(token));
      if (properties.includes('all')) problems.push(`line ${line}: transition: ${item} moves all`);
      else if (properties.length === 0) problems.push(`line ${line}: transition: ${item} names no property`);
    }
  }
  return problems;
};

test('the guard catches transition: all, a shorthand with no property and transition-property: all', () => {
  assert.deepEqual(unlistedTransitions('.gw .a { transition: background-color 150ms ease-out, transform 200ms; }'), []);
  assert.deepEqual(unlistedTransitions('.gw .a { transition: none; }'), []);
  assert.deepEqual(unlistedTransitions('.gw .a { transition: 200ms ease opacity; }'), []);
  assert.equal(unlistedTransitions('.gw .a { transition: 200ms ease all; }').length, 1);
  assert.deepEqual(unlistedTransitions('.gw .a { transition: color var(--d, 160ms) var(--e); }'), []);
  assert.equal(unlistedTransitions('.gw .a { transition: all 150ms; }').length, 1);
  assert.equal(unlistedTransitions('.gw .a { transition: 150ms ease-out; }').length, 1);
  assert.equal(unlistedTransitions('.gw .a { transition: var(--gw-dur) var(--gw-ease-out); }').length, 1);
  assert.equal(unlistedTransitions('.gw .a { transition: color 1s, all 1s; }').length, 1);
  assert.equal(unlistedTransitions('.gw .a {\n  -webkit-transition: all 1s; }').length, 1);
  assert.equal(unlistedTransitions('.gw .a { transition-property: opacity, all; }').length, 1);
  assert.equal(unlistedTransitions('.gw .a { transition-property: all ! important; }').length, 1);
  assert.equal(unlistedTransitions('.gw .a { transition: 200ms ease ! important; }').length, 1);
  assert.deepEqual(unlistedTransitions('.gw .a { transition: opacity 200ms ! important; }'), []);
  assert.equal(unlistedTransitions('.gw .a { transition: min(150ms, 200ms) ease; }').length, 1);
  assert.deepEqual(unlistedTransitions('.gw .a { transition: min(150ms, 200ms) ease opacity; }'), []);
});

test('no stylesheet under app/ gives a part transition: all or a transition with no property', () => {
  for (const file of stylesheets) assert.deepEqual(unlistedTransitions(css(file).toLowerCase()), [], file);
});

test('no component of ours outside the Paperclip copies uses Tailwind transition-all', () => {
  /** @param {string} dir @returns {string[]} */
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return path === join('components', 'paperclip') || entry.name === 'node_modules' ? [] : walk(path);
    return /\.(?:tsx|ts|jsx|js)$/.test(entry.name) ? [path] : [];
  });
  for (const file of [...walk('app'), ...walk('components'), ...walk('lib')]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /(?<![\w-])transition-(?:all|\[all)(?![\w-])/, file);
  }
});
