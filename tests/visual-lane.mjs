import { readFileSync } from 'node:fs';

// The visual lane's screens (#257): one reviewed list, each screen compared in Arabic at both widths in both themes.
// Paths are from the repository root: Playwright compiles this file to CommonJS, where import.meta does not exist.
export const screenList = 'tests/visual-lane/screens.json';
export const imageFolder = 'tests/visual-lane/images';
const cap = 15;
export const widths = [1440, 390];
export const themes = /** @type {const} */ (['light', 'dark']);

// A screen is the view of the seeded Owner unless it is `anonymous`, or names another seeded person by email (`as`).
const fields = {
  path: value => typeof value === 'string', // the address it opens
  ready: value => typeof value === 'string', // the element that shows the page has loaded
  state: value => typeof value === 'string', // a set-up the seed does not hold
  anonymous: value => value === true, // shown to a visitor who has not signed in
  as: value => typeof value === 'string' && /^[a-z]+@example\.com$/.test(value), // a seeded person other than the Owner (#167)
};

/** @typedef {{ name: string, path: string, ready?: string, state?: string, anonymous?: true, as?: string }} LaneScreen */

/** @returns {LaneScreen[]} */
export function parseLaneScreens(text) {
  let list;
  try {
    list = JSON.parse(text);
  } catch (error) {
    throw new Error(`the screen list: ${error.message}`);
  }
  if (typeof list !== 'object' || list === null || Array.isArray(list)) throw new Error('the screen list is a JSON object of screens by name');
  const entries = Object.entries(list);
  if (entries.length > cap) throw new Error(`${entries.length} screens: the visual lane holds at most ${cap}`);
  return entries.map(([name, entry]) => {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error(`${name}: a screen is named in kebab-case`);
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error(`${name}: a screen is a JSON object`);
    for (const [key, value] of Object.entries(entry)) {
      if (!Object.hasOwn(fields, key)) throw new Error(`${name}: unknown field "${key}"`);
      if (!fields[key](value)) throw new Error(`${name}: "${key}" has the wrong type`);
    }
    if (!('path' in entry)) throw new Error(`${name}: "path" is required`);
    return { name, ...entry };
  });
}

export const loadLaneScreens = (file = screenList) => parseLaneScreens(readFileSync(file, 'utf8'));

/** @param {LaneScreen} screen @param {number} width @param {'light' | 'dark'} theme */
export const laneImage = (screen, width, theme) => `${screen.name}-ar-${width}-${theme}.png`;
export const laneImages = screen => widths.flatMap(width => themes.map(theme => laneImage(screen, width, theme)));

// What a listing of the image folder lacks and what it holds that no screen owns.
export function laneImageProblems(listing, screens) {
  const expected = screens.flatMap(laneImages);
  const listed = new Set(listing);
  const owned = new Set(expected);
  return { missing: expected.filter(file => !listed.has(file)).sort(), stray: listing.filter(file => !owned.has(file)).sort() };
}
