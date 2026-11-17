import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { imageFolder, laneImages, laneImageProblems, loadLaneScreens, parseLaneScreens } from './visual-lane.mjs';

// The visual lane's screens are one reviewed list (tests/visual-lane/screens.json, #257), kept small, and each screen
// owns exactly its four approved images: Arabic, at 1440 and 390, light and dark.
const list = count => JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, n) => [`screen-${n + 1}`, { path: `/s/${n + 1}` }])));

test('the list holds at most 15 screens', () => {
  assert.equal(parseLaneScreens(list(15)).length, 15);
  assert.throws(() => parseLaneScreens(list(16)), /16 screens: the visual lane holds at most 15/);
});

test('each screen owns its four images, Arabic at both widths in both themes', () => {
  const [screen] = parseLaneScreens('{"home": {"path": "/c/rs-learning/home", "ready": ".content"}}');
  assert.deepEqual(laneImages(screen), ['home-ar-1440-light.png', 'home-ar-1440-dark.png', 'home-ar-390-light.png', 'home-ar-390-dark.png']);
});

test('an image a screen lacks is missing, and an image no screen owns is stray', () => {
  const screens = parseLaneScreens('{"home": {"path": "/h"}, "board": {"path": "/b"}}');
  const all = screens.flatMap(laneImages);
  assert.deepEqual(laneImageProblems(all, screens), { missing: [], stray: [] });
  assert.deepEqual(laneImageProblems(all.filter(file => file !== 'board-ar-390-dark.png'), screens), { missing: ['board-ar-390-dark.png'], stray: [] });
  assert.deepEqual(laneImageProblems([...all, 'chat-ar-1440-light.png', 'home-en-1440-light.png'], screens), { missing: [], stray: ['chat-ar-1440-light.png', 'home-en-1440-light.png'] });
});

test('a screen that is not a screen is refused, naming it', () => {
  for (const [text, message] of [
    ['{"home": {"path": "/h", "redy": ".x"}}', /home: unknown field "redy"/],
    ['{"home": {"path": "/h", "toString": ".x"}}', /home: unknown field "toString"/],
    ['{"home": {"path": "/h", "anonymous": false}}', /home: "anonymous" has the wrong type/],
    ['{"home": {"path": 3}}', /home: "path" has the wrong type/],
    ['{"home": {"ready": ".x"}}', /home: "path" is required/],
    ['{"home": []}', /home: a screen is a JSON object/],
    ['{"Home": {"path": "/h"}}', /Home: a screen is named in kebab-case/],
    ['[]', /the screen list is a JSON object/],
    ['{"home":', /the screen list: /],
  ]) assert.throws(() => parseLaneScreens(text), message, text);
});

test('every listed screen has its images, and nothing else is approved', () => {
  const listing = existsSync(imageFolder) ? readdirSync(imageFolder) : [];
  assert.deepEqual(laneImageProblems(listing, loadLaneScreens()), { missing: [], stray: [] });
});
