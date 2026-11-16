import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Reads the motion of a part from the stylesheets: the reference's one <style> block, and the product's stylesheets
// under app/. A brace-level reader is enough for these files: they nest only inside at-rules and hold no brace in a
// string. Paths are from the repository root, as Playwright compiles this file to CommonJS, where import.meta is missing.

/** @typedef {{ selectors: string[], media: string, declarations: [string, string][] }} Rule */
/** @typedef {{ rules: Rule[], keyframes: Map<string, string> }} Sheet */
/** The rules of one file, read with the keyframes and tokens of the page they load into. @typedef {Sheet & { tokens: Map<string, string> }} Styles */
/** @typedef {{ properties: string[], durations: string[], delays: string[], easings: string[] }} Transition */
/** `frames` holds each named keyframe's frames, so two names that move alike compare equal. @typedef {{ frames: string[], durations: string[], delays: string[], easings: string[], iterations: string[], fills: string[] }} Animation */
/** @typedef {{ transition: Transition, animation: Animation }} Motion */

export const referenceFile = 'design-reference/index.html';
const productFolder = 'app';
export const tokenFile = 'app/shell.css';

/** @type {Map<string, Sheet>} */ const read = new Map();
/** @param {string} file @returns {Sheet} */
export function readSheet(file) {
  if (!read.has(file)) read.set(file, parseSheet(cssOf(file)));
  return /** @type {Sheet} */ (read.get(file));
}

/** A stylesheet's text; for the reference, its <style> blocks. @param {string} file */
export function cssOf(file) {
  const text = readFileSync(file, 'utf8');
  return file.endsWith('.html') ? [...text.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n') : text;
}

export const productFiles = () => readdirSync(productFolder).filter(file => file.endsWith('.css')).map(file => join(productFolder, file)).sort();

/** The reference's rules, keyframes and `:root` tokens. @returns {Styles} */
export function referenceStyles() {
  const sheet = readSheet(referenceFile);
  return { ...sheet, tokens: tokensOf(sheet, ':root') };
}

/** One product file's rules, with the keyframes of every stylesheet under app/ and the `.gw` tokens. @param {string} file @returns {Styles} */
export function productStyles(file) {
  const keyframes = new Map(productFiles().flatMap(each => [...readSheet(each).keyframes]));
  return { rules: readSheet(file).rules, keyframes, tokens: tokensOf(readSheet(tokenFile), '.gw') };
}

/** @param {string} css @returns {Sheet} */
function parseSheet(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  /** @type {Rule[]} */ const rules = [];
  /** @type {Map<string, string>} */ const keyframes = new Map();
  /** @type {string[]} */ const atRules = [];
  let start = 0;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === '}') {
      atRules.pop();
      start = at + 1;
    } else if (char === ';' && text.slice(start, at).trim().startsWith('@')) {
      start = at + 1;
    } else if (char === '{') {
      const prelude = text.slice(start, at).trim().replace(/\s+/g, ' ');
      if (prelude.startsWith('@') && !prelude.startsWith('@keyframes ')) {
        atRules.push(prelude);
        start = at + 1;
        continue;
      }
      const end = closing(text, at);
      const body = text.slice(at + 1, end);
      if (prelude.startsWith('@keyframes ')) keyframes.set(prelude.slice('@keyframes '.length), framesOf(body));
      else rules.push({ selectors: splitTop(prelude, ',').flatMap(expandIs), media: atRules.join(' '), declarations: declarationsOf(body) });
      at = end;
      start = end + 1;
    }
  }
  return { rules, keyframes };
}

/** @param {string} text @param {number} open */
function closing(text, open) {
  let depth = 0;
  for (let at = open; at < text.length; at++) {
    if (text[at] === '{') depth++;
    if (text[at] === '}' && --depth === 0) return at;
  }
  throw new Error(`a block opened at ${open} never closes`);
}

/** Splits at a separator (or at white space for ' ') outside parentheses and quotes. @param {string} text @param {string} separator */
export function splitTop(text, separator) {
  const parts = [];
  let depth = 0, quote = '', start = 0;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (depth === 0 && (separator === ' ' ? /\s/.test(char) : char === separator)) {
      parts.push(text.slice(start, at));
      start = at + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}

// A selector with `:is(a, b)` also names each of its readings, so a row can name `.sb-item` and meet the reference's
// `:is(.btn, …, .sb-item)` rule. The selector as written stays first, so a row can name it as written, too.
/** @param {string} selector @returns {string[]} */
function expandIs(selector) {
  const open = selector.indexOf(':is(');
  if (open < 0) return [selector];
  let depth = 0, end = open + 3;
  for (; end < selector.length; end++) {
    if (selector[end] === '(') depth++;
    if (selector[end] === ')' && --depth === 0) break;
  }
  const readings = splitTop(selector.slice(open + 4, end), ',')
    .flatMap(choice => expandIs(`${selector.slice(0, open)}${choice}${selector.slice(end + 1)}`));
  return [selector, ...readings];
}

/** @param {string} body @returns {[string, string][]} */
function declarationsOf(body) {
  return splitTop(body, ';').flatMap(declaration => {
    const colon = declaration.indexOf(':');
    return colon < 0 ? [] : [[declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim().replace(/\s+/g, ' ')]];
  });
}

// A keyframe whose end holds the property's resting value (opacity 1, no transform) moves exactly as one that leaves
// the end out, so both read the same: `from { opacity: 0 }` and `from { opacity: 0 } to { opacity: 1 }`.
const resting = new Map([['opacity', '1'], ['transform', 'none']]);
const ends = new Set(['0%', '100%']);

/** @param {string} body */
function framesOf(body) {
  /** @type {Map<string, Record<string, string>>} */ const frames = new Map();
  for (const [, offsets, declarations] of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const offset of offsets.split(',').map(offset => ({ from: '0%', to: '100%' })[offset.trim()] ?? offset.trim())) {
      const kept = declarationsOf(declarations).map(([property, value]) => [property, number(value)])
        .filter(([property, value]) => !(ends.has(offset) && resting.get(property) === value));
      frames.set(offset, { ...frames.get(offset), ...Object.fromEntries(kept) });
    }
  }
  return JSON.stringify([...frames].filter(([, declarations]) => Object.keys(declarations).length)
    .sort(([a], [b]) => parseFloat(a) - parseFloat(b)).map(([offset, declarations]) => [offset, Object.entries(declarations).sort()]));
}

/** `.9` reads as `0.9`. @param {string} value */
const number = value => value.replace(/(^|[\s(,])\.(\d)/g, (_, before, digit) => `${before}0.${digit}`);

/** The custom properties a sheet defines on one selector outside any at-rule, such as `:root` or `.gw`. @param {Sheet} sheet @param {string} scope */
function tokensOf(sheet, scope) {
  /** @type {Map<string, string>} */ const tokens = new Map();
  for (const rule of sheet.rules) {
    if (rule.media || !rule.selectors.includes(scope)) continue;
    for (const [property, value] of rule.declarations) if (property.startsWith('--')) tokens.set(property, value);
  }
  return tokens;
}

/** @param {string} value @param {Map<string, string>} tokens @returns {string} */
function resolve(value, tokens) {
  const resolved = value.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (whole, name, fallback) => {
    const token = tokens.get(name) ?? fallback;
    if (token === undefined) throw new Error(`${whole} has no value`);
    return token.trim();
  });
  return resolved === value ? value : resolve(resolved, tokens);
}

const easingWords = new Set(['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'step-start', 'step-end']);
const fillWords = new Set(['forwards', 'backwards', 'both']);
const otherAnimationWords = new Set(['none', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'running', 'paused']);

/** @param {string} word */
const isTime = word => /^-?[\d.]+m?s$/.test(word);
/** @param {string} word */
const isEasing = word => easingWords.has(word) || /^(cubic-bezier|steps|linear)\(/.test(word);
/** @param {string} word */
const isCount = word => /^[\d.]+$|^infinite$/.test(word);
/** A time in milliseconds, as the reference writes it (`150ms`) and as the browser computes it (`0.15s`). @param {string} word */
export const milliseconds = word => isTime(word) ? `${Math.round(parseFloat(word) * (word.endsWith('ms') ? 1 : 1000) * 1000) / 1000}ms` : word;
/** A curve as the browser computes it: `cubic-bezier(.4,0,1,1)` reads `cubic-bezier(0.4, 0, 1, 1)`. @param {string} word */
export const easing = word => number(word.replace(/\s+/g, '').replace(/,/g, ', '));

const fields = {
  transition: { property: 'properties', duration: 'durations', delay: 'delays', 'timing-function': 'easings' },
  animation: { name: 'names', duration: 'durations', delay: 'delays', 'timing-function': 'easings', 'iteration-count': 'iterations', 'fill-mode': 'fills' },
};
const initial = {
  transition: { properties: 'all', durations: '0s', delays: '0s', easings: 'ease' },
  animation: { names: 'none', durations: '0s', delays: '0s', easings: 'ease', iterations: '1', fills: 'none' },
};

/** One `transition` or `animation` shorthand as its lists. @param {string} value @param {'transition' | 'animation'} kind */
function shorthand(value, kind) {
  const items = splitTop(value, ',').map(item => {
    const words = splitTop(item, ' ');
    const times = words.filter(isTime);
    const named = words.filter(word => !isTime(word) && !isEasing(word));
    /** @type {Record<string, string | undefined>} */
    const read = {
      durations: times[0], delays: times[1], easings: words.find(isEasing), properties: named[0],
      names: named.find(word => !fillWords.has(word) && !otherAnimationWords.has(word) && !isCount(word)),
      iterations: named.find(isCount), fills: named.find(word => fillWords.has(word)),
    };
    return Object.fromEntries(Object.entries(initial[kind]).map(([field, value]) => [field, read[field] ?? value]));
  });
  return Object.fromEntries(Object.keys(initial[kind]).map(field => [field, items.map(item => item[field])]));
}

/** The rules that hold at a window width: those of a narrower or wider screen and of reduced motion are left out. @param {string} media @param {number} width */
function holds(media, width) {
  if (media.includes('prefers-reduced-motion')) return false;
  const below = [...media.matchAll(/max-width:\s*(\d+)px/g)].every(([, limit]) => width <= Number(limit));
  const above = [...media.matchAll(/min-width:\s*(\d+)px/g)].every(([, limit]) => width >= Number(limit));
  return below && above;
}

/**
 * The motion of the elements one selector names, at one window width: every rule that names it, in source order, the
 * later declaration winning (the table names no selector a more specific rule overrides). Tokens are resolved and each
 * keyframe name is read as its frames. Undefined when no rule names the selector at any width.
 * @param {Styles} styles @param {string} selector @param {number} width @returns {Motion | undefined}
 */
export function motionOf(styles, selector, width) {
  const named = styles.rules.filter(rule => rule.selectors.includes(selector));
  if (!named.length) return undefined;
  /** @type {Record<'transition' | 'animation', Record<string, string[]>>} */
  const declared = { transition: {}, animation: {} };
  for (const [property, value] of named.filter(rule => holds(rule.media, width)).flatMap(rule => rule.declarations)) {
    const kind = property.startsWith('transition') ? 'transition' : property.startsWith('animation') ? 'animation' : undefined;
    if (!kind) continue;
    const resolved = resolve(value, styles.tokens);
    const field = /** @type {Record<string, string>} */ (fields[kind])[property.slice(kind.length + 1)];
    if (property === kind) Object.assign(declared[kind], shorthand(resolved, kind));
    else if (field) declared[kind][field] = splitTop(resolved, ',');
  }
  const transition = listed('transition', declared.transition, 'properties');
  const animation = listed('animation', declared.animation, 'names');
  return {
    transition: transitionOf({
      properties: transition.properties, durations: transition.durations.map(milliseconds), delays: transition.delays.map(milliseconds),
      easings: transition.easings.map(easing),
    }),
    animation: {
      frames: animation.names.filter(name => name !== 'none').map(name => {
        const frames = styles.keyframes.get(name);
        if (frames === undefined) throw new Error(`${selector}: no @keyframes ${name}`);
        return frames;
      }),
      durations: animation.durations.map(milliseconds), delays: animation.delays.map(milliseconds), easings: animation.easings.map(easing),
      iterations: animation.iterations, fills: animation.fills,
    },
  };
}

// A transition with no duration and no delay never runs, so it reads as none however it is written: the reference's
// `.modal` declares none and `.gw.modal` writes `transition: none` over the copied dialog's.
/** @param {Transition} transition @returns {Transition} */
export function transitionOf(transition) {
  const still = [...transition.durations, ...transition.delays].every(time => parseFloat(time) === 0);
  return still ? { properties: ['none'], durations: ['0ms'], delays: ['0ms'], easings: ['ease'] } : transition;
}

// A shorter list repeats to the length of the property (or name) list, as the browser reads it.
/** @param {'transition' | 'animation'} kind @param {Record<string, string[]>} declared @param {string} lead */
function listed(kind, declared, lead) {
  const lists = Object.fromEntries(Object.entries(initial[kind]).map(([field, value]) => [field, declared[field] ?? [value]]));
  return Object.fromEntries(Object.entries(lists).map(([field, list]) => [field, lists[lead].map((_, index) => list[index % list.length])]));
}
