import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { parseArgs, screens, outputPaths, resolveStaticPath, startStaticServer, anonymousCaptureUrl } from '../scripts/design-compare-lib.mjs';

const valid = ['--screen', 'home', '--width', '1440', '--lang', 'ar', '--theme', 'dark'];

test('a full set of arguments gives the options with per-screen defaults', () => {
  const options = parseArgs(valid);
  assert.equal(options.screen, 'home');
  assert.equal(options.width, 1440);
  assert.equal(options.lang, 'ar');
  assert.equal(options.theme, 'dark');
  assert.equal(options.builtUrl, 'http://127.0.0.1:3000');
  assert.equal(options.builtPath, screens.home.builtPath);
  assert.equal(options.referenceOnly, false);
  const custom = parseArgs([...valid, '--built-path', '/c/x/home', '--built-url', 'http://localhost:4000/', '--sign-in', 'a@b.c', '--out', 'x.png', '--reference-only']);
  assert.deepEqual([custom.builtPath, custom.builtUrl, custom.signIn, custom.out, custom.referenceOnly], ['/c/x/home', 'http://localhost:4000', 'a@b.c', 'x.png', true]);
});

test('the main screen of the reference is named home and maps to the built Home', () => {
  assert.equal(screens.home.builtPath, '/c/rs-learning/home');
  assert.deepEqual(screens.home.reference.steps, [], 'home is the state the prototype opens on');
});

test('every screen says how to reach it in the reference and which built page it matches', () => {
  assert.deepEqual(Object.keys(screens).sort(), ['account', 'agent', 'agent-chat', 'agents', 'board', 'home', 'log', 'numbers', 'settings', 'waiting']);
  for (const [name, screen] of Object.entries(screens)) {
    assert.match(name, /^[a-z]+(-[a-z]+)*$/, name);
    assert.deepEqual(Object.keys(screen).sort(), ['builtPath', 'reference'], name);
    assert.ok(screen.builtPath === null || /^\/c\/rs-learning\/[a-z/]+$/.test(screen.builtPath), `${name} built path`);
    assert.ok(Array.isArray(screen.reference.steps), `${name} steps`);
    for (const step of screen.reference.steps) {
      assert.equal(Object.keys(step).length, 1, `${name}: one action per step`);
      const [[action, selector]] = Object.entries(step);
      assert.ok(['click', 'waitFor', 'scrollTo'].includes(action), `${name}: known action ${action}`);
      assert.ok(typeof selector === 'string' && selector.length > 0, `${name}: selector`);
      assert.doesNotMatch(selector, /viewing|world|persona|view-as/i, `${name}: the demo-world switcher is never touched`);
    }
  }
  // The prototype's sidebar reaches its four views by data-view; the settings overlay opens from the account menu.
  assert.deepEqual(screens.board.reference.steps, [{ click: '#sb-nav [data-view="board"]' }, { waitFor: '#board-cols' }]);
  assert.deepEqual(screens.settings.reference.steps.slice(0, 2), [{ click: '#btn-me' }, { click: '[data-action="sov-open"]' }]);
  assert.equal(screens.board.builtPath, '/c/rs-learning/work/board');
  assert.equal(screens.waiting.builtPath, '/c/rs-learning/approvals');
  assert.equal(screens.settings.builtPath, '/c/rs-learning/settings');
  assert.equal(screens.agents.builtPath, '/c/rs-learning/agents');
  for (const name of ['numbers', 'log', 'agent', 'agent-chat', 'account']) assert.equal(screens[name].builtPath, null, `${name} has no built equivalent yet`);
});

test('a screen with no built equivalent needs --built-path or --reference-only', () => {
  const log = ['--screen', 'log', '--width', '1440', '--lang', 'en', '--theme', 'light'];
  assert.throws(() => parseArgs(log), error => error.exitCode === 2 && /Screen "log" has no built equivalent yet; pass --built-path PATH or --reference-only\./.test(error.message));
  assert.equal(parseArgs([...log, '--reference-only']).builtPath, null);
  assert.equal(parseArgs([...log, '--built-path', '/c/rs-learning/home']).builtPath, '/c/rs-learning/home');
});

test('bad arguments are rejected with a message naming the problem', () => {
  const rejects = (argv, pattern) => assert.throws(() => parseArgs(argv), error => error.exitCode === 2 && pattern.test(error.message));
  rejects(valid.map(v => (v === '1440' ? 'wide' : v)), /--width must be a whole number of pixels/);
  rejects(valid.map(v => (v === '1440' ? '0' : v)), /--width must be a whole number of pixels/);
  rejects(valid.map(v => (v === 'ar' ? 'fr' : v)), /--lang must be ar or en/);
  rejects(valid.map(v => (v === 'dark' ? 'device' : v)), /--theme must be light or dark/);
  rejects(valid.map(v => (v === 'home' ? 'nowhere' : v)), /Unknown screen "nowhere"\. Valid screens: home/);
  rejects(['--width', '1440', '--lang', 'ar', '--theme', 'dark'], /--screen is required/);
  rejects([...valid, '--colour', 'red'], /Unknown option --colour/);
  rejects(['--screen'], /--screen needs a value/);
});

test('the output name is deterministic and the single images sit next to it', () => {
  const options = parseArgs(valid);
  assert.deepEqual(outputPaths(options), {
    sideBySide: 'test-results/design-compare/home-ar-dark-1440.png',
    reference: 'test-results/design-compare/home-ar-dark-1440-reference.png',
    built: 'test-results/design-compare/home-ar-dark-1440-built.png',
  });
  assert.deepEqual(outputPaths(parseArgs([...valid, '--out', 'shots/a.png'])), {
    sideBySide: 'shots/a.png', reference: 'shots/a-reference.png', built: 'shots/a-built.png',
  });
});

test('a visitor who lands on sign-in is captured in the asked language through its ?language= parameter', () => {
  // app/sign-in/page.tsx opens in Arabic for ?language=ar; without it a visitor gets the default English.
  const landed = 'http://127.0.0.1:3000/sign-in?next=%2Fc%2Frs-learning%2Fhome';
  assert.equal(anonymousCaptureUrl(landed, 'ar'), 'http://127.0.0.1:3000/sign-in?next=%2Fc%2Frs-learning%2Fhome&language=ar');
  assert.equal(anonymousCaptureUrl(landed, 'en'), landed);
  assert.equal(anonymousCaptureUrl(`${landed}&language=ar`, 'en'), landed);
  assert.equal(anonymousCaptureUrl(`${landed}&language=ar`, 'ar'), `${landed}&language=ar`);
  // Any other page the visitor reached is captured where it is.
  assert.equal(anonymousCaptureUrl('http://127.0.0.1:3000/first-run', 'ar'), 'http://127.0.0.1:3000/first-run');
});

test('static paths never leave the reference folder', () => {
  assert.equal(resolveStaticPath('/srv/ref', '/app.js'), '/srv/ref/app.js');
  assert.equal(resolveStaticPath('/srv/ref', '/'), '/srv/ref/index.html');
  assert.equal(resolveStaticPath('/srv/ref', '/index.html?lang=ar'), '/srv/ref/index.html');
  assert.equal(resolveStaticPath('/srv/ref', '/../secret'), null);
  assert.equal(resolveStaticPath('/srv/ref', '/%2e%2e/secret'), null);
  assert.equal(resolveStaticPath('/srv/ref', '/a/%2e%2e/%2e%2e/secret'), null);
  assert.equal(resolveStaticPath('/srv/ref', '/..%2fsecret'), null);
  assert.equal(resolveStaticPath('/srv/ref-other/x', '/x'), '/srv/ref-other/x/x');
  assert.equal(resolveStaticPath('/srv/ref', '/%E0%A4%A'), null);
});

function get(port, path) {
  return new Promise((resolve, reject) => {
    // node:http sends the path as written, so `..` reaches the server unnormalised.
    request({ host: '127.0.0.1', port, path }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, type: response.headers['content-type'], body }));
    }).on('error', reject).end();
  });
}

test('the static server serves the reference and answers 404 for traversal', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'design-compare-'));
  const root = join(parent, 'ref');
  mkdirSync(root);
  writeFileSync(join(root, 'index.html'), '<p>reference</p>');
  writeFileSync(join(root, 'app.js'), 'x');
  writeFileSync(join(parent, 'secret.txt'), 'secret');
  const server = await startStaticServer(root);
  try {
    const { port } = server.address();
    const index = await get(port, '/?lang=ar');
    assert.equal(index.status, 200);
    assert.equal(index.body, '<p>reference</p>');
    assert.match(index.type, /text\/html/);
    assert.match((await get(port, '/app.js')).type, /javascript/);
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/missing.js']) {
      const response = await get(port, path);
      assert.equal(response.status, 404, path);
      assert.doesNotMatch(response.body, /secret/, path);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(parent, { recursive: true, force: true });
  }
});
