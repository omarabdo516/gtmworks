import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { imageFolder, laneImages, laneImageProblems, loadLaneScreens, parseLaneScreens } from './visual-lane.mjs';

// The one inventory of compared screens (#257): the visual lane's twelve key screens in tests/visual-lane/screens.json,
// each owning exactly its four approved images in tests/visual-lane/images/: Arabic, at 1440 and 390, light and dark.
const keyScreens = ['sign-in', 'first-run', 'home', 'board', 'card', 'chat', 'channel', 'agents', 'agent-details', 'members', 'numbers', 'approvals'];
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const list = count => JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, n) => [`screen-${n + 1}`, { path: `/s/${n + 1}` }])));
const listing = () => (existsSync(imageFolder) ? readdirSync(imageFolder) : []);

test('the lane lists exactly the twelve key screens', () => {
  assert.deepEqual(loadLaneScreens().map(screen => screen.name), keyScreens);
});

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

test('every key screen has its four images, and nothing else is approved', () => {
  assert.deepEqual(laneImageProblems(listing(), loadLaneScreens()), { missing: [], stray: [] });
});

test('each approved image is a PNG of the width it names', () => {
  for (const file of loadLaneScreens().flatMap(laneImages).filter(file => listing().includes(file))) {
    const bytes = readFileSync(`${imageFolder}/${file}`);
    assert.ok(bytes.subarray(0, 8).equals(pngSignature), `${file} is not a PNG`);
    assert.equal(bytes.readUInt32BE(16), Number(file.match(/-(\d+)-(light|dark)\.png$/)[1]), `${file} has another width`);
    assert.ok(bytes.readUInt32BE(20) >= 600, `${file} is too short to be a screen`);
  }
});
