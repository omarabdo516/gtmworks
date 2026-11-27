import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';

// The design system's values, held as values (Omar, 2026-11-25, #805, #808): DESIGN.md's front matter is the one source
// of them, the custom properties in app/tokens.css carry exactly those values in light and dark, the Paperclip tokens
// the front matter names carry its values too, and no stylesheet under app/ writes a colour, a shadow, a radius or a
// font with a raw value instead of a token. The raw values that match no token are listed at the end of this file
// (rawValueExceptions); that list only shrinks.

/** @param {string} text */
const uncomment = text => text.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
const space = (/** @type {string} */ value) => String(value).replace(/\s+/g, ' ').trim();
/** The index of the parenthesis that closes the one at index, past nested ones and quoted text. @param {string} css @param {number} index */
const closing = (css, index) => {
  let depth = 0, quote = '';
  for (; index < css.length; index++) {
    const char = css[index];
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth++;
    else if (char === ')' && --depth === 0) return index;
  }
  return index;
};

/** The front matter of a DESIGN.md text. @param {string} text */
export const frontMatter = text => {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error('DESIGN.md has no front matter');
  return /** @type {Record<string, Record<string, any>>} */ (load(match[1]));
};

/**
 * Every flat block of custom properties in a stylesheet, as { selector, at, properties }, where at is the at-rule the
 * block sits in ('' at the top) and properties maps each custom property's name, without its dashes, to its value.
 * @param {string} text
 */
export const tokenBlocks = text => {
  const css = uncomment(text);
  /** @type {{ selector: string, at: string, properties: Map<string, string> }[]} */
  const blocks = [];
  /** @type {{ selector: string, properties: Map<string, string> }[]} */
  const stack = [];
  let start = 0;
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (char === '(') { index = closing(css, index); continue; }
    if (char === '{') { stack.push({ selector: space(css.slice(start, index)), properties: new Map() }); start = index + 1; continue; }
    if (char !== ';' && char !== '}') continue;
    const declaration = css.slice(start, index).match(/^\s*--([\w-]+)\s*:\s*([\s\S]+?)\s*$/);
    if (declaration && stack.length) stack[stack.length - 1].properties.set(declaration[1], space(declaration[2]));
    if (char === '}') {
      const block = stack.pop();
      if (block?.properties.size && !/^@(?:media|supports|container|layer)\b/.test(block.selector)) {
        blocks.push({ selector: block.selector, at: stack.map(open => open.selector).filter(selector => selector.startsWith('@')).join(' '), properties: block.properties });
      }
    }
    start = index + 1;
  }
  return blocks;
};

/** The two halves of a light-dark() value, or the value twice. @param {string} value */
const lightDark = value => {
  const match = value.match(/^light-dark\((.*)\)$/);
  if (!match) return [value, value];
  let depth = 0;
  for (let index = 0; index < match[1].length; index++) {
    const char = match[1][index];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) return [space(match[1].slice(0, index)), space(match[1].slice(index + 1))];
  }
  throw new Error(`light-dark() with one value: ${value}`);
};

// app/tokens.css: the theme-free scales on :root, the reference's light values on .gw, its dark values under a dark
// theme and again under a device theme in a dark device. The motion tokens are held against the design sidecar by
// tests/motion-tokens.test.mjs, and an Agent face's four light factors are numbers DESIGN.md's Colors section names.
const heldElsewhere = new Set(['gw-dur-fast', 'gw-dur', 'gw-dur-slow', 'gw-ease-out', 'gw-ease-in', 'gw-ease-spring', 'gw-glow-k', 'gw-rim-k', 'gw-sh-l', 'gw-sh-d']);
const darkSelector = ':root[data-theme="dark"] .gw';
const deviceSelector = ':root[data-theme="device"] .gw';

/**
 * The tokens app/tokens.css sets, as name → { light, dark }, dark only where a dark block sets it.
 * @param {string} text
 */
export const cssTokens = text => {
  const blocks = tokenBlocks(text);
  const one = (/** @type {string} */ selector) => {
    const found = blocks.filter(block => block.selector === selector);
    if (found.length !== 1) throw new Error(`app/tokens.css has ${found.length} blocks for ${selector}`);
    return found[0].properties;
  };
  const dark = one(darkSelector), device = one(deviceSelector);
  for (const [name, value] of dark) if (device.get(name) !== value) throw new Error(`app/tokens.css: --${name} is ${value} under a dark theme and ${device.get(name) ?? 'not set'} under a dark device`);
  for (const name of device.keys()) if (!dark.has(name)) throw new Error(`app/tokens.css: --${name} is set under a dark device and not under a dark theme`);
  /** @type {Map<string, { light: string, dark?: string }>} */
  const tokens = new Map();
  for (const selector of [':root', '.gw']) for (const [name, value] of one(selector)) {
    if (tokens.has(name)) throw new Error(`app/tokens.css sets --${name} twice`);
    tokens.set(name, { light: value });
  }
  for (const [name, value] of dark) {
    const token = tokens.get(name);
    if (!token) throw new Error(`app/tokens.css sets --${name} for dark only`);
    token.dark = value;
  }
  for (const name of heldElsewhere) tokens.delete(name);
  return tokens;
};

// Where each front-matter section names a gw- token: a colour or a shadow is its value, a dark one the same name with
// -dark; a typography entry names one property; a radius or a spacing step is its value.
const sections = /** @type {const} */ (['colors', 'shadows', 'rounded', 'spacing', 'typography']);
const typographyProperty = (/** @type {string} */ name) => name === 'gw-font' ? 'fontFamily' : name.startsWith('gw-fs-') ? 'fontSize' : name.startsWith('gw-fw-') ? 'fontWeight' : null;

/**
 * The gw- tokens the front matter names, as name → { light, dark }.
 * @param {Record<string, Record<string, any>>} design
 */
export const designTokens = design => {
  /** @type {Map<string, { light?: string, dark?: string, section: string }>} */
  const tokens = new Map();
  for (const section of sections) for (const [key, entry] of Object.entries(design[section] ?? {})) {
    if (!key.startsWith('gw-')) continue;
    const dark = key.endsWith('-dark');
    const name = dark ? key.slice(0, -'-dark'.length) : key;
    let value = entry;
    if (section === 'typography') {
      const property = typographyProperty(name);
      if (!property) throw new Error(`DESIGN.md typography.${key} is no gw- size, weight or font`);
      value = entry?.[property];
    }
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`DESIGN.md ${section}.${key} has no value`);
    const token = tokens.get(name) ?? { section };
    if (token.section !== section) throw new Error(`DESIGN.md names ${name} in ${token.section} and ${section}`);
    token[dark ? 'dark' : 'light'] = space(String(value).replace(/\{colors\.([\w-]+)\}/g, 'var(--$1)'));
    tokens.set(name, token);
  }
  return tokens;
};

/**
 * Every difference between the front matter's gw- tokens and app/tokens.css's, one sentence each, naming the token.
 * @param {ReturnType<typeof designTokens>} design @param {ReturnType<typeof cssTokens>} css
 */
export const tokenDifferences = (design, css) => {
  /** @type {string[]} */
  const problems = [];
  for (const [name, token] of css) {
    const named = design.get(name);
    if (!named?.light) { problems.push(`--${name} is in app/tokens.css and not in DESIGN.md`); continue; }
    if (named.light !== token.light) problems.push(`--${name} is ${token.light} in app/tokens.css and ${named.light} in DESIGN.md`);
    if (token.dark !== named.dark) problems.push(`--${name} is ${token.dark ?? 'not set'} in app/tokens.css's dark theme and ${named.dark ?? 'not set'} as ${name}-dark in DESIGN.md`);
  }
  for (const name of design.keys()) if (!css.has(name)) problems.push(`${name} is in DESIGN.md and not in app/tokens.css`);
  return problems;
};

// The Paperclip tokens the front matter names, where the copied stylesheet keeps them: the shell's scope
// (.app-layout), the portal scope (:root), the radius ladder and the font stacks (components/paperclip/theme.css, or
// the reference's --gw-font for a role the shell draws), the
// copied components' shadows and the board's stage tones (Tailwind's own theme), and an Agent face's colours, each the
// second of its four stops (lib/agent-look.ts).
const shell = (/** @type {string} */ name) => ({ scope: '.app-layout', name });
const portal = (/** @type {string} */ name) => ({ scope: ':root', name });
const paperclipColours = {
  canvas: shell('background'), ink: shell('foreground'), surface: shell('card'), 'sidebar-grey': shell('sidebar'),
  'sidebar-hover': shell('sidebar-accent'), 'sidebar-hover-ink': shell('sidebar-accent-foreground'), hairline: shell('border'),
  'muted-fill': shell('muted'), 'muted-ink': shell('muted-foreground'), 'hover-fill': shell('accent'),
  primary: portal('primary'), 'primary-foreground': portal('primary-foreground'), 'portal-surface': portal('background'),
  'portal-ink': portal('foreground'), 'portal-muted-ink': portal('muted-foreground'), 'portal-muted-fill': portal('muted'),
  'portal-hairline': portal('border'), 'focus-ring': portal('ring'), destructive: portal('destructive'), 'scrollbar-thumb': portal('scrollbar-thumb'),
};
const stageTones = { 'stage-amber': 'amber', 'stage-blue': 'blue', 'stage-violet': 'violet', 'stage-green': 'green' };
const tailwindShadows = { hint: 'shadow-xs', 'card-hover': 'shadow-sm', lift: 'shadow-md', overlay: 'shadow-lg' };
const radiusLadder = { sm: 0.6, md: 0.8, lg: 1, xl: 1.4, '2xl': 1.8, '3xl': 2.2, '4xl': 2.6 };

/**
 * Every difference between the front matter's Paperclip values and the stylesheets that paint them.
 * @param {Record<string, Record<string, any>>} design
 * @param {{ theme: string, tailwind: string, agentLook: string, tokens: string }} sources
 */
export const paperclipDifferences = (design, sources) => {
  /** @type {string[]} */
  const problems = [];
  const theme = tokenBlocks(sources.theme).filter(block => !block.at);
  const read = (/** @type {string} */ scope, /** @type {string} */ name) => {
    for (const block of theme.filter(found => found.selector === scope).reverse()) if (block.properties.has(name)) return block.properties.get(name);
    return undefined;
  };
  for (const [key, { scope, name }] of Object.entries(paperclipColours)) {
    const value = read(scope, name);
    if (!value) { problems.push(`colors.${key}: components/paperclip/theme.css sets no --${name} on ${scope}`); continue; }
    const [light, dark] = lightDark(value);
    if (space(design.colors?.[key]) !== light) problems.push(`colors.${key} is ${design.colors?.[key]} in DESIGN.md and ${light} as --${name} on ${scope}`);
    if (space(design.colors?.[`${key}-dark`]) !== dark) problems.push(`colors.${key}-dark is ${design.colors?.[`${key}-dark`]} in DESIGN.md and ${dark} as --${name} on ${scope} in the dark theme`);
  }
  const tailwind = new Map(tokenBlocks(sources.tailwind).flatMap(block => [...block.properties]));
  for (const [key, hue] of Object.entries(stageTones)) {
    const value = tailwind.get(`color-${hue}-700`);
    if (space(design.colors?.[key]) !== value) problems.push(`colors.${key} is ${design.colors?.[key]} in DESIGN.md and ${value} as Tailwind's --color-${hue}-700`);
  }
  for (const [key, name] of Object.entries(tailwindShadows)) {
    const value = tailwind.get(name);
    if (space(design.shadows?.[key]) !== value) problems.push(`shadows.${key} is ${design.shadows?.[key]} in DESIGN.md and ${value} as Tailwind's --${name}`);
  }
  const agentStops = [...sources.agentLook.matchAll(/^\s*(\w+):\['#[0-9A-Fa-f]{6}','(#[0-9A-Fa-f]{6})'/gm)];
  if (!agentStops.length) problems.push('lib/agent-look.ts names no face colour');
  for (const [, colour, second] of agentStops) {
    if (String(design.colors?.[`agent-${colour}`]).toLowerCase() !== second.toLowerCase()) problems.push(`colors.agent-${colour} is ${design.colors?.[`agent-${colour}`]} in DESIGN.md and ${second} as its second stop in lib/agent-look.ts`);
  }
  for (const key of Object.keys(design.colors ?? {})) if (/^agent-/.test(key) && !agentStops.some(([, colour]) => `agent-${colour}` === key)) problems.push(`colors.${key} is in DESIGN.md and not in lib/agent-look.ts`);
  const radius = read(':root', 'radius');
  const knob = Number(radius?.match(/^([\d.]+)rem$/)?.[1]) * 16;
  for (const [step, factor] of Object.entries(radiusLadder)) {
    const value = `${Math.round(knob * factor * 100) / 100}px`;
    if (design.rounded?.[step] !== value) problems.push(`rounded.${step} is ${design.rounded?.[step]} in DESIGN.md and ${value} from --radius ${radius} times ${factor}`);
  }
  const sans = tokenBlocks(sources.theme).find(block => block.selector === '@theme inline')?.properties.get('font-sans');
  const mono = read(':root', 'font-paper-mono');
  const gwFont = cssTokens(sources.tokens).get('gw-font')?.light;
  for (const [key, entry] of Object.entries(design.typography ?? {})) {
    if (key.startsWith('gw-')) continue;
    const family = space(entry.fontFamily);
    if (family !== sans && family !== mono && family !== gwFont) problems.push(`typography.${key} is set in ${family}, which is none of --font-sans (${sans}), --font-paper-mono (${mono}) and --gw-font (${gwFont})`);
  }
  return problems;
};

// ---- raw values in the stylesheets under app/ ----

const colourLiteral = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![\w-])(?:aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgr[ae]y|darkgreen|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategr[ae]y|darkturquoise|darkviolet|deeppink|deepskyblue|dimgr[ae]y|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gr[ae]y|green|greenyellow|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgr[ae]y|lightgreen|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategr[ae]y|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategr[ae]y|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen)(?![\w-])/i;
const kinds = /** @type {const} */ ([
  ['shadow', /^(?:-webkit-)?box-shadow$|^text-shadow$/],
  ['radius', /^border(?:-[a-z]+)*-radius$/],
  ['font size', /^font-size$/],
  ['font family', /^font-family$/],
  ['font weight', /^font-weight$/],
  ['font', /^font$/],
  ['colour', /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|fill|stroke|filter|backdrop-filter|caret-color|accent-color|text-decoration(?:-color)?|column-rule(?:-color)?|scrollbar-color|-webkit-text-fill-color|-webkit-tap-highlight-color|--[\w-]+)$/],
]);
/**
 * Whether one declaration writes a raw value of its kind. A token reference with no fallback (`var(--x)`) is never
 * raw, nor are the CSS-wide keywords, `none` and `0`. A circle's 50% radius is a shape, not a step of the scale.
 * @param {string} kind @param {string} value
 */
const isRaw = (kind, value) => {
  const plain = space(value.replace(/!\s*important\s*$/, '').replace(/var\(--[\w-]+\)/g, 'V'));
  if (/^(?:inherit|initial|unset|revert|revert-layer|none|0|V)$/i.test(plain)) return false;
  if (kind === 'colour') return colourLiteral.test(plain.replace(/url\([^)]*\)/g, 'U'));
  if (kind === 'shadow') return !/^V(?: ?, ?V)*$/.test(plain);
  if (kind === 'radius') return /\d/.test(plain.replace(/(?<![\d.])(?:0|50%)(?![\d.%\w])/g, ''));
  if (kind === 'font size') return /\d|(?<![\w-])(?:xx?-small|small|medium|large|xx?x?-large|smaller|larger)(?![\w-])/.test(plain);
  if (kind === 'font family') return true;
  if (kind === 'font weight') return /\d|bold|normal|lighter/i.test(plain);
  return /\d|"|'/.test(plain);
};

/**
 * Every declaration in one stylesheet that writes a raw value, as { file, line, selector, property, value }. The
 * selector is the rule's own, after the at-rules it sits in. A custom property counts as a colour when it holds one.
 * @param {string} file @param {string} text
 */
export const rawValues = (file, text) => {
  const css = uncomment(text);
  /** @type {{ file: string, line: number, selector: string, property: string, value: string }[]} */
  const found = [];
  /** @type {string[]} */
  const stack = [];
  let start = 0;
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (char === '(') { index = closing(css, index); continue; }
    if (char === '{') { stack.push(space(css.slice(start, index))); start = index + 1; continue; }
    if (char !== ';' && char !== '}') continue;
    const declaration = css.slice(start, index);
    const match = declaration.match(/^\s*([\w-]+)\s*:\s*([\s\S]+?)\s*$/);
    if (match && stack.length && !stack.at(-1)?.startsWith('@font-face')) {
      const kind = kinds.find(([, pattern]) => pattern.test(match[1]))?.[0];
      if (kind && isRaw(kind, match[2])) {
        const offset = start + declaration.search(/\S/);
        found.push({ file, line: css.slice(0, offset).split('\n').length, selector: stack.join(' '), property: match[1], value: space(match[2]) });
      }
    }
    if (char === '}') stack.pop();
    start = index + 1;
  }
  return found;
};

/**
 * The raw values that are not in the exceptions list, and the exceptions no stylesheet writes any more.
 * @param {ReturnType<typeof rawValues>} found @param {readonly (readonly [string, string, string, string])[]} allowed
 */
export const unlisted = (found, allowed) => {
  const key = (/** @type {readonly string[]} */ parts) => parts.join(' | ');
  /** @type {Map<string, number>} */
  const left = new Map();
  for (const entry of allowed) left.set(key(entry), (left.get(key(entry)) ?? 0) + 1);
  const fresh = found.filter(raw => {
    const id = key([raw.file, raw.selector, raw.property, raw.value]);
    const count = left.get(id) ?? 0;
    if (count) left.set(id, count - 1);
    return !count;
  });
  return { fresh, stale: [...left].flatMap(([id, count]) => Array(count).fill(id)) };
};

const read = (/** @type {string} */ file) => readFileSync(file, 'utf8');
/** @param {string} dir @returns {string[]} */
const cssUnder = dir => readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => (entry.isDirectory() ? cssUnder(join(dir, entry.name)) : entry.name.endsWith('.css') ? [join(dir, entry.name)] : []));

test('the guard reads a token change on either side and names the token', () => {
  const css = ':root { --gw-fs-xs: 12px; }\n.gw { --gw-text-1: #1C1C1C; --gw-dur: 200ms; }\n:root[data-theme="dark"] .gw { --gw-text-1: #F5F5F5; }\n@media (prefers-color-scheme: dark) { :root[data-theme="device"] .gw { --gw-text-1: #F5F5F5; } }';
  const design = { colors: { 'gw-text-1': '#1C1C1C', 'gw-text-1-dark': '#F5F5F5' }, typography: { 'gw-fs-xs': { fontSize: '12px' } } };
  assert.deepEqual(tokenDifferences(designTokens(design), cssTokens(css)), []);
  assert.deepEqual(tokenDifferences(designTokens(design), cssTokens(css.replace('--gw-fs-xs: 12px', '--gw-fs-xs: 13px'))), ['--gw-fs-xs is 13px in app/tokens.css and 12px in DESIGN.md']);
  assert.deepEqual(tokenDifferences(designTokens({ ...design, colors: { ...design.colors, 'gw-text-1-dark': '#FFFFFF' } }), cssTokens(css)),
    ['--gw-text-1 is #F5F5F5 in app/tokens.css\'s dark theme and #FFFFFF as gw-text-1-dark in DESIGN.md']);
  assert.deepEqual(tokenDifferences(designTokens({ colors: design.colors }), cssTokens(css)), ['--gw-fs-xs is in app/tokens.css and not in DESIGN.md']);
  assert.deepEqual(tokenDifferences(designTokens({ ...design, rounded: { 'gw-r-xs': '6px' } }), cssTokens(css)), ['gw-r-xs is in DESIGN.md and not in app/tokens.css']);
  assert.throws(() => cssTokens(css.replace('"device"] .gw { --gw-text-1: #F5F5F5', '"device"] .gw { --gw-text-1: #FFFFFF')), /--gw-text-1 is #F5F5F5 under a dark theme and #FFFFFF under a dark device/);
});

test('the guard finds a raw colour, shadow, radius or font and names the file and selector', () => {
  const sheet = '.gw .a { color: var(--gw-text-1); box-shadow: var(--gw-shadow-card); border-radius: 50%; font-weight: var(--gw-fw-medium); }\n'
    + '.gw .b { color: #fff; }\n.gw .c { box-shadow: 0 1px 3px var(--gw-border-2); }\n@media (max-width: 767px) { .gw .d { border-radius: 4px; font-size: 11px; } }\n'
    + '.gw .e { font-weight: 600 !important; font-family: system-ui; background: url("x.svg"); --local: rgba(0, 0, 0, .1); transition: color 1s; }';
  assert.deepEqual(rawValues('app/x.css', sheet).map(raw => `${raw.file}:${raw.line} ${raw.selector} ${raw.property}`), [
    'app/x.css:2 .gw .b color', 'app/x.css:3 .gw .c box-shadow', 'app/x.css:4 @media (max-width: 767px) .gw .d border-radius',
    'app/x.css:4 @media (max-width: 767px) .gw .d font-size', 'app/x.css:5 .gw .e font-weight', 'app/x.css:5 .gw .e font-family', 'app/x.css:5 .gw .e --local',
  ]);
  assert.deepEqual(rawValues('app/x.css', '.a { color: whitesmoke; font-size: larger; border-width: 2px; border-style: solid; fill: url(#fade); background-image: linear-gradient(#fff, transparent); }')
    .map(raw => raw.property), ['color', 'font-size', 'background-image']);
  const found = rawValues('app/x.css', '.a { color: #fff; }\n.b { color: #000; }');
  assert.deepEqual(unlisted(found, [['app/x.css', '.a', 'color', '#fff'], ['app/x.css', '.z', 'color', '#fff']]),
    { fresh: [found[1]], stale: ['app/x.css | .z | color | #fff'] });
});

test('DESIGN.md names every token app/tokens.css carries, with its value in light and dark, and no other', () => {
  assert.deepEqual(tokenDifferences(designTokens(frontMatter(read('DESIGN.md'))), cssTokens(read('app/tokens.css'))), []);
});

// HTML the server writes outside the app's stylesheets (the Owner's Engine dashboard's refusal page and its way back,
// #869, #871) takes its values from lib/design-tokens.mjs, which is DESIGN.md's front matter as written by
// `node scripts/design-tokens.mjs write`, never from a value of its own.
test('lib/design-tokens.mjs is DESIGN.md\'s front matter, and the server\'s own pages write no raw colour', async () => {
  const { designTokens: written } = await import('../lib/design-tokens.mjs');
  const design = frontMatter(read('DESIGN.md'));
  assert.deepEqual(written, { colors: design.colors, rounded: design.rounded, spacing: design.spacing, shadows: design.shadows, typography: design.typography },
    'lib/design-tokens.mjs is out of date: run node scripts/design-tokens.mjs write');
  for (const file of ['lib/engine-dashboard.mjs', 'lib/engine-dashboard-refusals.mjs'])
    assert.deepEqual(read(file).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '').match(/#[0-9a-f]{3,8}\b|\b(?:oklch|rgba?|hsla?)\(/gi) ?? [], [], `${file} writes a raw colour: take it from lib/design-tokens.mjs`);
});

test('the Paperclip values DESIGN.md names are the ones its stylesheet, Tailwind and the Agent faces carry', () => {
  assert.deepEqual(paperclipDifferences(frontMatter(read('DESIGN.md')), {
    theme: read('components/paperclip/theme.css'), tailwind: read('node_modules/tailwindcss/theme.css'), agentLook: read('lib/agent-look.ts'), tokens: read('app/tokens.css'),
  }), []);
});

test('every component DESIGN.md names refers only to values it names', () => {
  const design = frontMatter(read('DESIGN.md'));
  for (const [name, component] of Object.entries(design.components ?? {})) for (const [property, value] of Object.entries(component)) {
    for (const [, section, key] of String(value).matchAll(/\{(\w+)\.([\w-]+)\}/g)) assert.ok(design[section]?.[key] !== undefined, `components.${name}.${property} names ${section}.${key}, which DESIGN.md does not have`);
  }
});

test('no stylesheet under app/ writes a colour, shadow, radius or font that is not a token, past the listed exceptions', () => {
  const found = cssUnder('app').sort().filter(file => file !== join('app', 'tokens.css')).flatMap(file => rawValues(file.split('\\').join('/'), read(file)));
  const { fresh, stale } = unlisted(found, rawValueExceptions());
  assert.deepEqual(fresh.map(raw => `${raw.file}:${raw.line} ${raw.selector} sets ${raw.property} to the raw value ${raw.value}: use a token from app/tokens.css`), []);
  assert.deepEqual(stale.map(id => `${id} is no longer written: remove it from rawValueExceptions in tests/design-values.test.mjs`), []);
});

// The raw values under app/ that match no token, each as [file, selector, property, value] (#808). A screen's look is
// not changed to empty it: an entry goes when its value becomes a token, never by adding one. A new raw value fails the
// test above; write a token instead, in app/tokens.css and DESIGN.md.
/** @returns {(readonly [string, string, string, string])[]} */
function rawValueExceptions() {
  return [
    ['app/agent-look.css', '.gw .lk-tile', 'box-shadow', 'var(--gw-border-2) 0 0 0 .5px inset'],
    ['app/agent-look.css', '.gw .lk-tile:has(input:checked)', 'box-shadow', 'var(--gw-primary) 0 0 0 1.5px inset'],
    ['app/agent-look.css', '.gw .lk-sw:has(input:checked) .lk-sw__o', 'box-shadow', '0 0 0 2.5px var(--gw-bg-chrome), 0 0 0 4.5px var(--gw-text-1)'],
    ['app/agent-look.css', '.gw .lk-pen', 'box-shadow', '0 0 0 2.5px var(--ring, var(--gw-bg-chrome)), var(--gw-border-1) 0 0 0 .5px inset'],
    ['app/all-conversations.css', '.gw .all-convos .cv-seg', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/all-conversations.css', '.gw .all-convos .sel-box > span', 'box-shadow', 'var(--gw-border-1) 0 0 0 1.5px inset'],
    ['app/apps.css', '.gw :is(.sov-apps, .apps-sheet) .app-card', 'box-shadow', 'var(--gw-border-3) 0 0 0 0.5px inset, var(--gw-border-3) 0 0 0 0.5px'],
    ['app/apps.css', '.gw :is(.sov-apps, .apps-sheet) .app-off', 'box-shadow', 'var(--gw-border-1) 0 0 0 1px inset'],
    ['app/apps.css', '.gw :is(.sov-apps, .apps-sheet) .tm-check', 'box-shadow', 'var(--gw-border-1) 0 0 0 1px inset'],
    ['app/apps.css', '.gw .apps-sheet .switch::after', 'background', '#FFFFFF'],
    ['app/apps.css', '.gw .apps-sheet .switch::after', 'box-shadow', '#1C1C1C1F 0 1px 3px'],
    ['app/board.css', '.gw .board-view', '--b-bg-elevated', '#FFFFFF'],
    ['app/board.css', ':root[data-theme="dark"] .gw .board-view', '--b-bg-elevated', '#1F1F1F'],
    ['app/board.css', '@media (prefers-color-scheme: dark) :root[data-theme="device"] .gw .board-view', '--b-bg-elevated', '#1F1F1F'],
    ['app/board.css', '.gw .board-view .work-toolbar .tabs', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/board.css', '.gw .board-view .btn--secondary', 'box-shadow', 'var(--b-btn-secondary-ring) 0 0 0 1px inset'],
    ['app/board.css', '.gw .board-view .kind-seg', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/board.css', '.gw .board-view .chip', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/board.css', '.gw .board-view .work-filters select', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/board.css', '.gw .board-view .board-nav .circle-btn:disabled', 'box-shadow', 'var(--gw-border-3) 0 0 0 0.5px inset'],
    ['app/board.css', '.gw .board-view .col.is-over', 'box-shadow', 'inset 0 0 0 1.5px var(--gw-text-1)'],
    ['app/board.css', '.gw .board-view .col.is-blocked', 'box-shadow', 'inset 0 0 0 1.5px var(--gw-border-1)'],
    ['app/board.css', '.gw .board-view .kcard, .gw .kcard--ghost', 'box-shadow', 'var(--b-shadow-card, #1C1C1C1F 0 0 0 0.5px, #1C1C1C09 0 2px 8px)'],
    ['app/board.css', '@media (hover: hover) .gw .board-view .kcard:hover', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px, var(--gw-shadow-popover)'],
    ['app/board.css', '.gw .board-view .kcard.is-drag-src', 'box-shadow', 'inset 0 0 0 1px var(--gw-border-1)'],
    ['app/board.css', '.gw .kcard--ghost', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px, var(--gw-shadow-modal)'],
    ['app/board.css', '@keyframes kcard-flash 0%, 40%', 'box-shadow', '0 0 0 2px var(--gw-text-1)'],
    ['app/board.css', '.gw .kcard__agent .avatar', 'font-size', '10px'],
    ['app/board.css', '.gw .kcard.is-landing', 'box-shadow', '0 0 0 2px var(--gw-text-1)'],
    ['app/board.css', '@media (hover: hover) .gw .board-view .mcard:hover', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px, var(--gw-shadow-popover)'],
    ['app/board.css', '.gw .board-view .mcard__top .mcard__av', 'font-size', '10px'],
    ['app/board.css', '.gw .card-detail .lg-edit__t:focus', 'box-shadow', '0 0 0 3px var(--gw-bg-active)'],
    ['app/board.css', '.gw .card-detail .lg-edit .btn--secondary', 'box-shadow', 'var(--gw-btn2-ring) 0 0 0 1px inset'],
    ['app/board.css', '.gw .bt-search input:focus', 'box-shadow', '0 0 0 3px var(--gw-bg-active)'],
    ['app/board.css', '.gw .board-view .arch-none', 'box-shadow', 'var(--gw-border-2) 0 0 0 1px inset'],
    ['app/board.css', '.gw .board-view .kcard[class] > .kt-check', 'box-shadow', 'var(--gw-border-1) 0 0 0 1.5px inset'],
    ['app/board.css', '.gw .board-view .kcard:has(.kcard__pick[aria-pressed="true"])', 'box-shadow', '0 0 0 2px var(--gw-text-1)'],
    ['app/board.css', '.gw .board-view .bsel', 'box-shadow', 'var(--b-shadow-card, #1C1C1C1F 0 0 0 0.5px, #1C1C1C09 0 2px 8px)'],
    ['app/board.css', '.gw .board-view .sel-box > span', 'box-shadow', 'var(--gw-border-1) 0 0 0 1.5px inset'],
    ['app/channel.css', '.gw .ch-intro', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/channel.css', '@keyframes channel-spot 0%, 45%', 'box-shadow', '0 0 0 2px var(--gw-text-1)'],
    ['app/channel.css', '@keyframes channel-spot 100%', 'box-shadow', '0 0 0 2px transparent'],
    ['app/channel.css', '@media (prefers-reduced-motion: reduce) .gw .transcript .is-spot', 'box-shadow', '0 0 0 2px var(--gw-text-1)'],
    ['app/channel.css', '.gw .details .btn--secondary', 'box-shadow', 'var(--gw-btn2-ring) 0 0 0 1px inset'],
    ['app/face.css', '.gw .face', '--veilc', '#2B2E3A'],
    ['app/face.css', '.gw .f-shadow::before', 'background', 'radial-gradient(closest-side, color-mix(in srgb, var(--c4) 55%, #000) 0%, color-mix(in srgb, var(--c4) 20%, transparent) 60%, transparent 100%)'],
    ['app/face.css', '.gw .f-flows', 'background', 'radial-gradient(30% 30% at 24% 20%, color-mix(in srgb, var(--c1) 86%, #fff) 0%, color-mix(in srgb, var(--c1) 60%, transparent) 45%, transparent 100%), radial-gradient(34% 34% at 76% 80%, var(--c4) 0%, color-mix(in srgb, var(--c4) 55%, transparent) 45%, transparent 100%), radial-gradient(26% 26% at 82% 30%, color-mix(in srgb, var(--c2) 80%, var(--c1)) 0%, transparent 100%)'],
    ['app/face.css', '.gw .f-core', 'background', 'radial-gradient(62% 34% at 50% 98%, color-mix(in srgb, var(--c1) 55%, #fff) 0%, color-mix(in srgb, var(--c1) 70%, transparent) 38%, transparent 100%), radial-gradient(46% 40% at 50% 62%, color-mix(in srgb, var(--c1) 50%, transparent) 0%, transparent 100%)'],
    ['app/face.css', '.gw .f-swirl', 'background', 'conic-gradient(from 0deg, transparent 0 8%, color-mix(in srgb, var(--c1) 70%, #fff) 24%, transparent 40% 58%, var(--c1) 76%, transparent 92%)'],
    ['app/face.css', '.gw .f-spec', 'background', 'radial-gradient(closest-side, rgba(255,255,255,.34), rgba(255,255,255,.1) 60%, rgba(255,255,255,0))'],
    ['app/face.css', '.gw .f-spec2', 'background', 'radial-gradient(closest-side, rgba(255,255,255,.95), rgba(255,255,255,0))'],
    ['app/face.css', '.gw .e-open', 'border-radius', 'var(--eR, 999px)'],
    ['app/face.css', '.gw .e-open', 'background', '#FFFFFF'],
    ['app/face.css', '.gw .e-open', 'box-shadow', '0 0 calc(var(--s) * .05) color-mix(in srgb, var(--c4) 45%, transparent)'],
    ['app/face.css', '.gw .e-arc path', 'stroke', '#FFFFFF'],
    ['app/face.css', '.gw .f-gather', 'background', 'radial-gradient(closest-side, transparent 50%, color-mix(in srgb, var(--c1) 70%, #fff) 63%, color-mix(in srgb, var(--c2) 40%, transparent) 72%, transparent 86%)'],
    ['app/face.css', '.gw .f-spark i', 'background', 'linear-gradient(135deg, #FFFFFF 10%, var(--c1) 90%)'],
    ['app/face.css', '.gw .face[data-state="stuck"]', '--veilc', '#2B2E3A'],
    ['app/face.css', '.gw .face[data-state="asleep"]', '--veilc', '#8E93A8'],
    ['app/face.css', '.gw .dot--stuck', 'box-shadow', 'inset 0 0 0 2px var(--gw-text-1)'],
    ['app/face.css', '.gw .dot--asleep', 'box-shadow', 'inset 0 0 0 2px var(--gw-idle-dot)'],
    ['app/face.css', '.gw .fw > .dot', 'box-shadow', '0 0 0 2.5px var(--ring, var(--gw-bg-chrome))'],
    ['app/face.css', '.gw .fw > .dot--stuck', 'box-shadow', 'inset 0 0 0 2px var(--gw-text-1), 0 0 0 2.5px var(--ring, var(--gw-bg-chrome))'],
    ['app/face.css', '.gw .fw > .dot--asleep', 'box-shadow', 'inset 0 0 0 2px var(--gw-idle-dot), 0 0 0 2.5px var(--ring, var(--gw-bg-chrome))'],
    ['app/face.css', '.gw .fw--lg > .dot', 'box-shadow', '0 0 0 3px var(--ring, var(--gw-bg-chrome))'],
    ['app/face.css', '.gw .fw--lg > .dot--stuck', 'box-shadow', 'inset 0 0 0 2.5px var(--gw-text-1), 0 0 0 3px var(--ring, var(--gw-bg-chrome))'],
    ['app/face.css', '.gw .fw--lg > .dot--asleep', 'box-shadow', 'inset 0 0 0 2.5px var(--gw-idle-dot), 0 0 0 3px var(--ring, var(--gw-bg-chrome))'],
    ['app/first-run-choice.css', '.gw .cr-kind', 'box-shadow', 'var(--gw-border-2) 0 0 0 1px inset'],
    ['app/first-run-choice.css', '.gw .cr-kind:has(input:checked)', 'box-shadow', 'var(--gw-text-1) 0 0 0 1px inset'],
    ['app/first-run-choice.css', '.gw .fr-ppl > .me__av', 'box-shadow', '0 0 0 2px var(--gw-bg-pane)'],
    ['app/first-run-choice.css', '.gw .fr .btn--secondary', 'box-shadow', 'var(--gw-btn2-ring) 0 0 0 1px inset'],
    ['app/first-run-choice.css', '.gw .fr .set-input:focus', 'box-shadow', '0 0 0 3px var(--gw-bg-active)'],
    ['app/globals.css', '@layer components h1', 'font-size', '24px'],
    ['app/globals.css', '@layer components h2', 'font-size', '16px'],
    ['app/globals.css', '@layer components .brand', 'font-size', '20px'],
    ['app/globals.css', '@layer components .card:hover', 'box-shadow', '0 1px 3px #0002'],
    ['app/globals.css', '@layer components .card .card-id', 'font', '12px/16px var(--font-paper-mono)'],
    ['app/globals.css', '@layer components .bars i', 'border-radius', '999px'],
    ['app/globals.css', '@layer components .modal h2', 'font-size', '24px'],
    ['app/globals.css', '@layer components .mode-chip i', 'border-radius', '999px'],
    ['app/globals.css', '@layer components .author-chip', 'font-size', '11px'],
    ['app/globals.css', '@layer components .author-chip i', 'border-radius', '999px'],
    ['app/globals.css', '@layer components .stat strong', 'font-size', '30px'],
    ['app/globals.css', '@layer components .stat strong.unavailable', 'font-size', '20px'],
    ['app/globals.css', '@layer components @media(max-width:767px) h1', 'font-size', '20px'],
    ['app/globals.css', '@layer components @media(max-width:767px) .stat strong', 'font-size', '24px'],
    ['app/globals.css', '@layer components @media(max-width:767px) .stat strong.unavailable', 'font-size', '18px'],
    ['app/globals.css', '@layer components @media(max-width:767px) .modal h2', 'font-size', '20px'],
    ['app/log.css', '.gw :is(.log-page, .numbers-page, .sheet) .btn--secondary', 'box-shadow', 'var(--p-btn-secondary-ring) 0 0 0 1px inset'],
    ['app/log.css', '.gw :is(.log-page, .numbers-page, .sheet) .set-input:focus', 'box-shadow', '0 0 0 3px var(--gw-bg-active)'],
    ['app/log.css', '.gw :is(.log-page, .numbers-page, .details, .sheet, .cw) .lg-av', 'box-shadow', 'var(--gw-border-3) 0 0 0 0.5px inset'],
    ['app/log.css', '.gw :is(.log-page, .details, .sheet, .cw) .lg-val--old', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/log.css', '@media (max-width: 767px) .gw .log-page .lgp-field .set-input', 'border-radius', '8px / 13px'],
    ['app/log.css', '@media (max-width: 767px) .gw .log-page .lgp-field .set-input', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/log.css', '@media (max-width: 767px) .gw .log-page .lgp-field .set-input:focus', 'box-shadow', 'var(--gw-border-1) 0 0 0 1px inset'],
    ['app/new-channel.css', '.gw .cr .set-input:focus', 'box-shadow', '0 0 0 3px var(--gw-bg-active)'],
    ['app/new-channel.css', '.gw .tm-check', 'box-shadow', 'var(--gw-border-1) 0 0 0 1px inset'],
    ['app/numbers.css', '.gw .numbers-page .kpi__val', 'font-size', 'clamp(24px, 2.1vw, var(--p-fs-2xl))'],
    ['app/settings.css', '.gw :is(.sov, .modal.team-dlg) .circle-btn', 'box-shadow', 'var(--gw-border-3) 0 0 0 0.5px inset, var(--gw-border-3) 0 0 0 0.5px'],
    ['app/settings.css', '.gw :is(.sov, .apps-sheet, .modal.team-dlg) .btn--secondary', 'box-shadow', 'var(--sov-btn2-ring) 0 0 0 1px inset'],
    ['app/settings.css', '.gw .sov .segmented--field', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/settings.css', '.gw .sov .kpi__val', 'font-size', 'clamp(24px, 2.1vw, var(--sov-fs-2xl))'],
    ['app/settings.css', '.gw .sov .chip', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/settings.css', '.gw .sov .know-meta .me__av', 'font-size', '10px'],
    ['app/settings.css', '.gw .sov .sov-password input:focus', 'box-shadow', '0 0 0 3px var(--gw-bg-active)'],
    ['app/settings.css', '.gw .sov .cr-kind', 'box-shadow', 'var(--gw-border-2) 0 0 0 1px inset'],
    ['app/settings.css', '.gw .sov .cr-kind[aria-checked="true"]', 'box-shadow', 'var(--gw-text-1) 0 0 0 1px inset'],
    ['app/settings.css', '.gw .sov .sk-col.is-cur', 'box-shadow', 'var(--gw-text-1) 0 0 0 1px inset'],
    ['app/settings.css', '@media (max-width: 767px) .gw :is(.sov, .modal.team-dlg) .inv .set-input', 'border-radius', '8px / 13px'],
    ['app/settings.css', '@media (max-width: 767px) .gw :is(.sov, .modal.team-dlg) .inv .set-input', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/settings.css', '@media (max-width: 767px) .gw :is(.sov, .modal.team-dlg) .inv .set-input:focus', 'box-shadow', 'var(--gw-border-1) 0 0 0 1px inset'],
    ['app/settings.css', '.gw .sov .sub-code', 'font-family', 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'],
    ['app/settings.css', '.gw .sov .pv-code', 'font-family', 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'],
    ['app/settings.css', '.gw .sov :is(.set-group__h, .set-advanced__h)', 'font-size', '16px'],
    ['app/shell.css', '@keyframes gw-ring-flash 0%, 40%', 'box-shadow', 'inset 0 0 0 2px var(--text-1)'],
    ['app/shell.css', '@keyframes gw-ring-flash 100%', 'box-shadow', 'inset 0 0 0 0 transparent'],
    ['app/shell.css', '.gw :hover::-webkit-scrollbar-thumb', 'background-color', '#1C1C1C2E'],
    ['app/shell.css', '.gw ::-webkit-scrollbar-thumb:hover', 'background-color', '#1C1C1C52'],
    ['app/shell.css', ':root[data-theme="dark"] .gw :hover::-webkit-scrollbar-thumb', 'background-color', '#F5F5F52E'],
    ['app/shell.css', ':root[data-theme="dark"] .gw ::-webkit-scrollbar-thumb:hover', 'background-color', '#F5F5F552'],
    ['app/shell.css', '@media (prefers-color-scheme: dark) :root[data-theme="device"] .gw :hover::-webkit-scrollbar-thumb', 'background-color', '#F5F5F52E'],
    ['app/shell.css', '@media (prefers-color-scheme: dark) :root[data-theme="device"] .gw ::-webkit-scrollbar-thumb:hover', 'background-color', '#F5F5F552'],
    ['app/shell.css', '.gw .sb-search input:focus', 'box-shadow', '0 0 0 3px var(--gw-bg-active)'],
    ['app/shell.css', '.gw .circle-btn', 'box-shadow', 'var(--gw-border-3) 0 0 0 0.5px inset, var(--gw-border-3) 0 0 0 0.5px'],
    ['app/shell.css', '.gw .agent-tile__plus', 'box-shadow', 'var(--gw-border-3) 0 0 0 0.5px inset'],
    ['app/shell.css', '.gw .me__av', 'box-shadow', 'var(--gw-border-3) 0 0 0 0.5px inset'],
    ['app/shell.css', '.gw .head-pill', 'box-shadow', 'var(--gw-border-3) 0 0 0 0.5px inset, var(--gw-shadow-pill)'],
    ['app/shell.css', '.gw .corner-pill', 'box-shadow', 'var(--gw-border-3) 0 0 0 1px inset'],
    ['app/shell.css', '.gw .file-chip', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/shell.css', '.gw .file-thumb img', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/shell.css', '.gw .try-one__btn', 'box-shadow', 'var(--gw-border-3) 0 0 0 1px inset'],
    ['app/shell.css', '.gw .suggest button', 'box-shadow', 'var(--gw-border-3) 0 0 0 1px inset'],
    ['app/shell.css', '.gw .empty-chat .chip', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/shell.css', '.gw .composer__btn', 'box-shadow', 'var(--gw-border-3) 0 0 0 0.5px inset'],
    ['app/shell.css', '.gw .menu__code', 'font-family', 'ui-monospace, Menlo, Consolas, monospace'],
    ['app/shell.css', '.gw .dp-tabs', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/shell.css', '.gw .pv-img', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px'],
    ['app/shell.css', '.gw .details .mem-search input:focus', 'box-shadow', '0 0 0 3px var(--gw-bg-active)'],
    ['app/shell.css', '.gw :is(.sov, .modal.team-dlg, .details) .switch::after', 'background', '#FFFFFF'],
    ['app/shell.css', '.gw :is(.sov, .modal.team-dlg, .details) .switch::after', 'box-shadow', '#1C1C1C1F 0 1px 3px'],
    ['app/shell.css', '.gw :is(.sov, .modal.team-dlg, .details) .set-input:focus', 'box-shadow', '0 0 0 3px var(--gw-bg-active)'],
    ['app/shell.css', '.gw .details .rt-add input:focus', 'box-shadow', '0 0 0 3px var(--gw-bg-active)'],
    ['app/shell.css', '.gw .details .btn--secondary', 'box-shadow', 'var(--gw-btn2-ring) 0 0 0 1px inset'],
    ['app/shell.css', '.gw .details .scr', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/shell.css', '.gw .details .scr__off', 'font-size', 'max(2.6cqw, var(--gw-fs-xs))'],
    ['app/shell.css', '.gw .vw-foot__acts .btn--secondary', 'box-shadow', 'var(--gw-btn2-ring) 0 0 0 1px inset'],
    ['app/shell.css', '.gw .details .scr.is-control', 'box-shadow', 'var(--gw-text-1) 0 0 0 2px inset'],
    ['app/shell.css', '.gw .tpl-search input:focus', 'box-shadow', '0 0 0 3px var(--gw-bg-active)'],
    ['app/shell.css', '.gw .tpl-cats .chip', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/shell.css', '.gw .tpl', 'box-shadow', 'var(--gw-border-3) 0 0 0 0.5px inset, var(--gw-border-3) 0 0 0 0.5px'],
    ['app/shell.css', '.gw .tool-tile', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/shell.css', '.gw .tool-tile', 'font-size', '10px'],
    ['app/shell.css', '.gw .tool-tile', 'font-family', 'system-ui, sans-serif'],
    ['app/shell.css', ':root[data-theme="dark"] .gw .tool-tile:has(.tool-logo)', 'background', '#fff'],
    ['app/shell.css', '@media (prefers-color-scheme: dark) :root[data-theme="device"] .gw .tool-tile:has(.tool-logo)', 'background', '#fff'],
    ['app/shell.css', ':is(.gw.modal, .gw .reply-card) .btn--secondary', 'box-shadow', 'var(--gw-btn2-ring) 0 0 0 1px inset'],
    ['app/shell.css', '.gw .badge--req', 'box-shadow', 'var(--gw-border-1) 0 0 0 1px inset'],
    ['app/shell.css', '.gw .ac-card .set-input:focus', 'box-shadow', '0 0 0 3px var(--gw-bg-active)'],
    ['app/shell.css', '.gw .ck-list .ck-av', 'font-size', '11px'],
    ['app/shell.css', '.gw .reply-card .rv-badge.is-fix', 'box-shadow', 'var(--gw-border-1) 0 0 0 0.5px inset'],
    ['app/shell.css', '.gw .reply-card--question', 'box-shadow', 'var(--gw-border-3) 0 0 0 1px inset'],
    ['app/shell.css', '.gw .opt__key', 'box-shadow', 'var(--gw-border-3) 0 0 0 0.5px inset'],
    ['app/shell.css', '.gw .opt--static:hover .opt__key', 'box-shadow', 'var(--gw-border-3) 0 0 0 0.5px inset'],
    ['app/shell.css', '.gw .reply-card .chip', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/shell.css', '.gw .step__dot', 'box-shadow', '0 0 0 2px var(--gw-bg-chrome)'],
    ['app/shell.css', '.gw .step--skipped .step__dot', 'box-shadow', 'inset 0 0 0 1.5px var(--gw-text-3), 0 0 0 2px var(--gw-bg-chrome)'],
    ['app/shell.css', '.gw .handed', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/shell.css', '.gw .chg-card .btn--secondary', 'box-shadow', 'var(--gw-btn2-ring) 0 0 0 1px inset'],
    ['app/shell.css', '.gw .chg-card .segmented--field', 'box-shadow', 'var(--gw-border-2) 0 0 0 0.5px inset'],
    ['app/shell.css', '.gw .chg-card .switch::after', 'background', '#FFFFFF'],
    ['app/shell.css', '.gw .chg-card .switch::after', 'box-shadow', '#1C1C1C1F 0 1px 3px'],
    ['app/update-ready.css', '.gw .upd-cmd', 'font-family', 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'],
  ];
}
