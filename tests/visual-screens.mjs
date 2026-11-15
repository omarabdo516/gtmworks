import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The screens that are compared with approved images, shared by the browser tests and the baseline-folder check.
// Each screen is compared once per language and width, so it owns languages x widths approved images.
export const languages = ['en', 'ar'];
export const widths = [1440, 390];

// One file per screen, named for the screen, so two branches that each add a screen never touch the same file. The path
// is from the repository root, as the baseline folder's is: Playwright compiles this file to CommonJS, where
// import.meta does not exist.
export const screenFolder = 'tests/visual-screens';

// The fields of a screen file. A screen is the view of the seeded Owner of every company unless it names a `person` or
// is `anonymous`.
const fields = {
  path: value => typeof value === 'string', // the address it opens
  dark: value => typeof value === 'boolean', // true: also compared in the dark theme, as `<name>-dark`
  anonymous: value => value === true, // shown to a visitor who has not signed in
  person: value => typeof value === 'string', // shown to this Member, in their own window
  state: value => typeof value === 'string', // a set-up the seed does not hold (`screenStates` in tests/visual.spec.ts)
  ready: value => typeof value === 'string', // the element that shows the page has loaded; `.content` when absent
  about: value => typeof value === 'string', // what the picture shows
};

/** @typedef {{ name: string, path: string, dark: boolean, about?: string, state?: string, person?: string, anonymous?: true, ready?: string }} Screen */

/** @returns {Screen} */
function parseScreen(file, text) {
  const name = file.replace(/\.json$/, '');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*\.json$/.test(file)) throw new Error(`${file}: a screen file is named <kebab-case-name>.json`);
  if (name.endsWith('-dark')) throw new Error(`${file}: a dark screen is made by "dark": true on its light screen`);
  let entry;
  try {
    entry = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error(`${file}: a screen is a JSON object`);
  for (const [key, value] of Object.entries(entry)) {
    if (!Object.hasOwn(fields, key)) throw new Error(`${file}: unknown field "${key}"`);
    if (!fields[key](value)) throw new Error(`${file}: "${key}" has the wrong type`);
  }
  for (const key of ['path', 'dark']) if (!(key in entry)) throw new Error(`${file}: "${key}" is required`);
  return { name, ...entry };
}

/** @param {string} folder @returns {Screen[]} */
export function loadScreens(folder) {
  const light = readdirSync(folder).map(file => parseScreen(file, readFileSync(join(folder, file), 'utf8')))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  return [
    ...light.map(screen => ({ ...screen, dark: false })),
    ...light.filter(screen => screen.dark).map(screen => ({ ...screen, name: `${screen.name}-dark`, dark: true })),
  ];
}

export const screens = loadScreens(screenFolder);

export const snapshotName = (screen, language, width) => `${screen.name}-${language}-${width}`;

// Playwright names a baseline `<name>-<project>-<platform>.png`. CI renders on Linux, so only Linux baselines count.
export const baselineFolder = 'tests/visual.spec.ts-snapshots';
export const baselineFile = (screen, language, width) => `${snapshotName(screen, language, width)}-visual-linux.png`;


// What a listing of the approved-image folder lacks and what it holds that no screen owns.
export function baselineProblems(listing, screens) {
  const expected = screens.flatMap(screen => languages.flatMap(language => widths.map(width => baselineFile(screen, language, width))));
  const listed = new Set(listing);
  const owned = new Set(expected);
  return { missing: expected.filter(file => !listed.has(file)).sort(), stray: listing.filter(file => !owned.has(file)).sort() };
}
