import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { screens, languages, widths, screenFolder, loadScreens, baselineFolder, baselineFile, baselineProblems } from './visual-screens.mjs';

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function temporaryFolder(t) {
 const folder = mkdtempSync(join(tmpdir(), 'gtmworks-visual-screens-'));
 t.after(() => rmSync(folder, { recursive: true, force: true }));
 return folder;
}

test('every listed screen has an approved image per language and width, and nothing else is approved', () => {
 assert.deepEqual([...languages].sort(), ['ar', 'en']);
 assert.deepEqual([...widths].sort((a, b) => a - b), [390, 1440]);
 assert.deepEqual(baselineProblems(readdirSync(baselineFolder), screens), { missing: [], stray: [] });
});

test('an approved image taken away is missing, and an image no screen owns is stray', () => {
 const listing = readdirSync(baselineFolder);
 const [taken] = listing;
 assert.deepEqual(baselineProblems(listing.filter(file => file !== taken), screens), { missing: [taken], stray: [] });
 const stray = 'retired-screen-en-1440-visual-linux.png';
 assert.deepEqual(baselineProblems([...listing, stray], screens), { missing: [], stray: [stray] });
});

test('approved images are PNG pictures at the width they are named for', () => {
 for (const screen of screens) for (const language of languages) for (const width of widths) {
  const bytes = readFileSync(`${baselineFolder}/${baselineFile(screen, language, width)}`);
  assert.ok(bytes.subarray(0, 8).equals(pngSignature), `${screen.name} ${language} ${width} is not a PNG`);
  assert.equal(bytes.readUInt32BE(16), width, `${screen.name} ${language} ${width} has another width`);
  assert.ok(bytes.readUInt32BE(20) >= 600, `${screen.name} ${language} ${width} is too short to be a screen`);
 }
});

test('every dark screen is its light twin in the dark theme', () => {
 const dark = screens.filter(screen => screen.dark);
 assert.ok(dark.length > 0, 'some screen is compared dark');
 for (const screen of dark) {
  const twin = screens.find(light => !light.dark && `${light.name}-dark` === screen.name);
  assert.ok(twin, `${screen.name} has a light twin`);
  assert.deepEqual({ ...screen, name: twin.name, dark: false }, twin, `${screen.name} shows what its light twin shows`);
 }
});

test('a screen file that is not a screen is refused, naming the file', async t => {
 const refused = [
  ['typo.json', '{"path": "/x", "dark": false, "redy": ".x"}', /typo\.json: unknown field "redy"/],
  ['flag.json', '{"path": "/x", "dark": "yes"}', /flag\.json: "dark" has the wrong type/],
  ['visitor.json', '{"path": "/x", "dark": false, "anonymous": false}', /visitor\.json: "anonymous" has the wrong type/],
  ['nowhere.json', '{"dark": false}', /nowhere\.json: "path" is required/],
  ['undecided.json', '{"path": "/x"}', /undecided\.json: "dark" is required/],
  ['broken.json', '{"path": "/x",', /broken\.json: /],
  ['list.json', '[]', /list\.json: a screen is a JSON object/],
  ['home-dark.json', '{"path": "/x", "dark": false}', /home-dark\.json: a dark screen is made by "dark": true/],
  ['Home.json', '{"path": "/x", "dark": false}', /Home\.json: a screen file is named <kebab-case-name>\.json/],
  ['notes.md', 'a note', /notes\.md: a screen file is named <kebab-case-name>\.json/],
 ];
 for (const [file, text, message] of refused) {
  await t.test(file, t => {
   const folder = temporaryFolder(t);
   writeFileSync(join(folder, 'home.json'), '{"path": "/c/rs-learning/home", "dark": true}');
   writeFileSync(join(folder, file), text);
   assert.throws(() => loadScreens(folder), message);
  });
 }
});

// The conflict this layout removes: two pull requests that each add a screen, merged as GitHub merges them.
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
 cwd, encoding: 'utf8',
 env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' },
});

for (const [first, second] of [['aa-first', 'zz-last'], ['zz-a', 'zz-b']]) {
 test(`two branches that add ${first} and ${second} merge without a conflict`, t => {
  const repository = temporaryFolder(t);
  const folder = join(repository, screenFolder);
  mkdirSync(folder, { recursive: true });
  cpSync(screenFolder, folder, { recursive: true });
  git(repository, 'init', '-q', '-b', 'main');
  git(repository, 'add', '.');
  git(repository, 'commit', '-q', '-m', 'main');
  for (const name of [first, second]) {
   git(repository, 'switch', '-q', '-c', name, 'main');
   writeFileSync(join(folder, `${name}.json`), `${JSON.stringify({ path: `/c/rs-learning/${name}`, dark: true }, null, 2)}\n`);
   git(repository, 'add', '.');
   git(repository, 'commit', '-q', '-m', name);
  }
  const tree = git(repository, 'merge-tree', '--write-tree', first, second).trim();
  assert.match(tree, /^[0-9a-f]{40,64}$/, 'merge-tree reports a clean merge as only the merged tree');
  const merged = git(repository, 'ls-tree', '--name-only', tree, `${screenFolder}/`).split('\n').filter(Boolean);
  assert.ok(merged.includes(`${screenFolder}/${first}.json`) && merged.includes(`${screenFolder}/${second}.json`), 'both new screens are in the merge');
  git(repository, 'read-tree', '-u', '--reset', tree);
  const names = loadScreens(folder).map(screen => screen.name);
  for (const name of [first, second, `${first}-dark`, `${second}-dark`]) assert.ok(names.includes(name), `${name} is compared after the merge`);
  assert.equal(names.length, screens.length + 4);
 });
}
