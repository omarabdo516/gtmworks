import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs, screens, outputPaths, resolveStaticPath, startStaticServer, anonymousCaptureUrl, fixture } from '../scripts/design-compare-lib.mjs';

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

test('the main screen of the reference is named home and maps to the built Conversation with the main Agent', () => {
  assert.equal(screens.home.builtPath, '/c/rs-learning/chat');
  assert.deepEqual(screens.home.reference.steps, [], 'home is the state the prototype opens on');
  assert.deepEqual(Object.entries(screens).filter(([, screen]) => screen.reference.hold).map(([name]) => name), ['chat-loading', 'numbers-loading'], 'only the loading placeholders hold the prototype on screen');
});

test('the optional compare fixture holds the reference agent grid, Lead as the main Agent and a populated Conversation', () => {
  const sql = readFileSync(fixture.file, 'utf8');
  // It refuses any database but the seeded local one before it writes anything, and the tool never applies it.
  const guard = sql.indexOf("raise exception 'design-compare fixture: only for the seeded local database");
  assert.ok(guard > 0, 'the fixture has its guard');
  assert.ok(guard < sql.indexOf('insert into'), 'the guard runs before the first insert');
  assert.ok(sql.trimStart().startsWith('--') && sql.includes('begin;') && sql.trimEnd().endsWith('commit;'), 'one transaction');
  assert.doesNotMatch(readFileSync('scripts/design-compare.mjs', 'utf8'), /design-compare-fixture|supabase|execFile/, 'the compare tool never writes to a database');
  // Only an explicit manual run of the comparison workflow loads it, into that run's own fresh database.
  const workflow = readFileSync('.github/workflows/design-compare.yml', 'utf8');
  assert.match(workflow, /fixture:\n\s+description: [^\n]+\n\s+type: boolean\n\s+default: false/);
  assert.match(workflow, /- run: bash scripts\/local-db\.sh\n(\s+#[^\n]*\n)?\s+- name: load the comparison fixture\n\s+if: \$\{\{ inputs\.fixture == true \}\}\n/);
  assert.equal(workflow.match(/design-compare-fixture\.sql/g).length, 2, 'named once in the input, once in the guarded step');
  assert.equal(fixture.file, 'scripts/design-compare-fixture.sql');
  for (const name of ['Lead', 'Ads', 'SEO & Content', 'Analyst', 'Critic']) assert.ok(sql.includes(`'${name}'`), name);
  assert.ok(sql.includes("x.n=1 and not exists(select 1 from public.hermes_agents where company_id='10000000-0000-0000-0000-000000000001' and is_default)"), 'Lead is the main Agent');
  assert.equal(fixture.mainAgent, '61000000-0000-0000-0000-000000000001');
  assert.equal(fixture.agent, '61000000-0000-0000-0000-000000000002');
  assert.equal(fixture.conversation, '62000000-0000-0000-0000-000000000001');
  assert.ok(sql.includes(`('${fixture.conversation}','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','${fixture.mainAgent}','Lead')`), 'Omar’s Conversation with Lead');
  assert.ok(sql.includes("(1,'person',") && sql.includes("(2,'agent',"), 'a message and its reply');
  assert.doesNotMatch(sql, /\b(delete|update|truncate|drop)\b/i, 'the fixture only adds');
});

// Runs the workflow's own fixture step under bash -e (as Actions does) with fake docker and npx on PATH.
function runFixtureStep(dockerExit) {
  const workflow = readFileSync('.github/workflows/design-compare.yml', 'utf8');
  const step = workflow.match(/- name: load the comparison fixture\n\s+if: [^\n]+\n\s+run: ([^\n]+)\n/)[1];
  const bin = mkdtempSync(join(tmpdir(), 'design-compare-step-'));
  // The pinned CLI sends the whole file as one prepared statement, which Postgres refuses for several commands.
  writeFileSync(join(bin, 'npx'), "#!/bin/sh\necho 'ERROR: cannot insert multiple commands into a prepared statement (SQLSTATE 42601)' >&2\nexit 1\n", { mode: 0o755 });
  writeFileSync(join(bin, 'docker'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${bin}/args"\ncat > "${bin}/stdin"\nexit ${dockerExit}\n`, { mode: 0o755 });
  const result = spawnSync('bash', ['-e', '-c', step], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  const read = name => { try { return readFileSync(join(bin, name), 'utf8'); } catch { return null; } };
  const out = { status: result.status, stderr: result.stderr, args: read('args')?.trimEnd().split('\n'), stdin: read('stdin') };
  rmSync(bin, { recursive: true, force: true });
  return out;
}

test('the fixture step streams the file unchanged to psql in the local database container, which runs several commands', () => {
  const { status, stderr, args, stdin } = runFixtureStep(0);
  assert.equal(status, 0, stderr);
  const project = readFileSync('supabase/config.toml', 'utf8').match(/^project_id = "(.*)"/m)[1];
  assert.deepEqual(args, ['exec', '-i', `supabase_db_${project}`, 'psql', '-X', '-h', '/var/run/postgresql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']);
  // The file's own begin/commit is the transaction, so psql gets no --single-transaction on top of it.
  assert.equal(stdin, readFileSync(fixture.file, 'utf8'));
});

test('a loading screen\'s own setup goes to the same local database as the fixture, refusing any other, only for that screen', () => {
  const workflow = readFileSync('.github/workflows/design-compare.yml', 'utf8');
  const step = workflow.match(/- name: slow the loading screen's read\n\s+env:\n\s+SCREEN: [^\n]+\n\s+run: \|\n((?:\s{10}[^\n]+\n)+)/)[1];
  const fixtureStep = workflow.match(/- name: load the comparison fixture\n\s+if: [^\n]+\n\s+run: ([^\n]+)\n/)[1];
  assert.ok(step.includes(fixtureStep.slice(0, fixtureStep.indexOf(' < '))), 'the fixture step\'s docker exec and psql');
  for (const screen of ['chat-loading', 'numbers-loading']) {
    const sql = readFileSync(`scripts/design-compare-${screen}.sql`, 'utf8');
    const guard = sql.indexOf('raise exception');
    assert.ok(guard > 0 && guard < sql.indexOf('insert into') && guard < sql.indexOf('create policy'), `${screen}: refused before it writes`);
    assert.ok(sql.includes('begin;') && sql.trimEnd().endsWith('commit;'), `${screen}: one transaction`);
    assert.ok(Object.hasOwn(screens, screen), `${screen} is a screen`);
  }
  assert.match(step, /chat-loading\|numbers-loading\)/, 'only the loading screens');
});

test('a refused or failed fixture fails the step, so no capture runs on a half-loaded database', () => {
  const { status, stdin } = runFixtureStep(3);
  assert.notEqual(status, 0);
  assert.equal(stdin, readFileSync(fixture.file, 'utf8'));
});

test('every screen says how to reach it in the reference and which built page it matches', () => {
  // A floor, not the full list: a screen removed from the map fails here, and adding one never edits this line (#113).
  for (const name of ['account', 'agent', 'agent-chat', 'agents', 'board', 'channel', 'home', 'home-alone', 'knowledge', 'learning', 'log', 'made-agent', 'made-card', 'new-agent', 'numbers', 'ready-roles', 'rule-saved', 'settings', 'settings-alone', 'waiting']) {
    assert.ok(Object.hasOwn(screens, name), `${name} is still a comparison screen`);
  }
  for (const [name, screen] of Object.entries(screens)) {
    assert.match(name, /^[a-z]+(-[a-z]+)*$/, name);
    assert.deepEqual(Object.keys(screen).filter(key => !['builtSteps', 'builtSettle'].includes(key)).sort(), ['builtPath', 'reference'], name);
    if (screen.builtSettle !== undefined) assert.equal(screen.builtSettle, false, `${name}: builtSettle is only ever false`);
    assert.ok(screen.builtPath === null || /^\/c\/rs-(learning|consultations)\/[a-z/]+(\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\/[1-9][0-9]*)?(\?[a-z]+=[a-z0-9-]+)?$/.test(screen.builtPath), `${name} built path`);
    assert.ok(Array.isArray(screen.reference.steps), `${name} steps`);
    // The alone screens (#10) start by viewing the prototype as Omar working alone, and a Member's request screens (#17)
    // view it as Youssef in the team; the lock on another Member's Card chat (#145) has Youssef start the chat, then views
    // it as Omar in the team again. Every other screen never touches it.
    const youssef = '[data-action="set-as"][data-person="youssef"][data-world="team"]';
    const omarInTeam = '[data-action="set-as"][data-person="omar"][data-world="team"]';
    const asYoussef = ['ask-agent', 'request-sent', 'request-made', 'card-chat-locked'].includes(name);
    if (asYoussef) assert.ok(screen.reference.steps.some(step => step.click === youssef), `${name} views as Youssef`);
    const switches = name === 'card-chat-locked' ? [youssef, omarInTeam] : [youssef];
    const steps = [...(name.endsWith('-alone') ? screen.reference.steps.slice(3) : asYoussef ? screen.reference.steps.filter(step => !switches.includes(step.click)) : screen.reference.steps), ...(screen.builtSteps ?? [])];
    for (const step of steps) {
      assert.equal(Object.keys(step).length, 1, `${name}: one action per step`);
      const [[action, value]] = Object.entries(step);
      assert.ok(['click', 'waitFor', 'waitGone', 'scrollTo', 'fill', 'press', 'goto', 'finish'].includes(action), `${name}: known action ${action}`);
      if (action === 'goto') { assert.match(value, /^\/c\/rs-(learning|consultations)\/[a-z/]+(\/[0-9a-f-]{36})?$/, `${name}: a built page`); continue; }
      // A press names one key as Playwright does (a letter, or a name such as ArrowDown or KeyN), not a selector.
      if (action === 'press') { assert.match(value, /^([a-z]|[A-Z][A-Za-z]+)$/, `${name}: a key`); continue; }
      const selector = action === 'fill' ? value[0] : value;
      if (action === 'fill') assert.ok(typeof value[1] === 'string' && value[1].length > 0, `${name}: fill text`);
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
  // The settings overlay is route-backed (#26): one address per state.
  assert.equal(screens.agents.builtPath, '/c/rs-learning/settings?section=agents');
  assert.equal(screens.agent.builtPath, `/c/rs-learning/settings?agent=${fixture.mainAgent}`);
  assert.equal(screens.account.builtPath, '/c/rs-learning/settings?section=account');
  // Numbers and the Activity log are built pages (#35, #11).
  assert.equal(screens.numbers.builtPath, '/c/rs-learning/numbers');
  assert.equal(screens.log.builtPath, '/c/rs-learning/log');
  assert.equal(screens['agent-chat'].builtPath, null, 'agent-chat has no built equivalent yet');
  // Alone (#10): the prototype viewed as Omar working alone, beside R&S Consultations, whose one Member is Omar.
  const alone = [{ click: '#btn-me' }, { click: '[data-action="set-as"][data-person="omar"][data-world="solo"]' }, { waitFor: '#sb-recent' }];
  assert.deepEqual(screens['home-alone'].reference.steps, alone);
  assert.deepEqual(screens['settings-alone'].reference.steps, [...alone, ...screens.settings.reference.steps]);
  assert.equal(screens['home-alone'].builtPath, '/c/rs-consultations/chat');
  assert.equal(screens['settings-alone'].builtPath, '/c/rs-consultations/settings');
  // Lead makes an Agent (#13): the hint, the card in the Conversation and the Agent's page, beside the reference's Ads.
  assert.equal(screens['new-agent'].builtPath, '/c/rs-learning/chat?new=agent');
  assert.equal(screens['made-card'].builtPath, null, 'the Conversation has a uuid path: pass the fixture\'s madeConversation');
  // An Agent's reply carries a draft card (#136): the reference reaches it by choosing an angle in the Meta campaign chat.
  assert.equal(screens['draft-card'].builtPath, null, 'the Conversation has a uuid path: pass the draft-shown state\'s');
  // An Agent's reply carries a review card (#137): the reference shows it in the team chat.
  assert.equal(screens['review-card'].builtPath, null, 'the Conversation has a uuid path: pass the review-shown state\'s');
  // An Agent's question (#138): the reference shows it open in the Meta campaign chat.
  assert.equal(screens['question-card'].builtPath, null, 'the Conversation has a uuid path: pass the fixture\'s questionConversation');
  assert.equal(fixture.questionConversation, '62000000-0000-0000-0000-000000000005');
  assert.ok(readFileSync(fixture.file, 'utf8').includes(`'${fixture.questionConversation}','design-compare-fixture-question','design-compare-prompt@1','question'`), 'its open question');
  assert.equal(screens['made-agent'].builtPath, `/c/rs-learning/settings?agent=${fixture.agent}`);
  // A lasting rule told to Ads (#18): the saved line in the Conversation; Ads's page above lists the rule.
  assert.equal(screens['rule-saved'].builtPath, null, 'the Conversation has a uuid path: pass the fixture\'s ruleConversation');
  // The keyboard (#173): Arrow Down in the open account menu, and "N" on the board, pressed where the focus is.
  assert.deepEqual(screens['account-menu-keys'].builtSteps.at(-1), { press: 'ArrowDown' });
  assert.deepEqual(screens['account-menu-keys'].reference.steps.at(-1), { press: 'ArrowDown' });
  assert.deepEqual(screens['new-chat-key'].reference.steps, [...screens.board.reference.steps, { press: 'n' }, { waitFor: '#ta-main:focus' }]);
  assert.deepEqual(screens['new-chat-key'].builtSteps, [{ press: 'KeyN' }, { waitFor: '.composer__input:focus' }]);
  // #172. The built placeholders: the workflow's setup file adds the page's rows and slows its one waiting table, then
  // the page is opened, its hold ended, and it is captured without waiting for the slowed read.
  for (const [name, table, page, placeholder] of [
    ['chat-loading', 'conversation_usage', '/c/rs-learning/conversations/6f000000-0000-0000-0000-000000000003', '.chat .transcript[aria-busy="true"]'],
    ['numbers-loading', 'company_log', '/c/rs-learning/numbers', '.numbers-page [aria-busy="true"]'],
  ]) {
    const screen = screens[name];
    assert.equal(screen.builtPath, '/c/rs-learning/home', name);
    const sql = readFileSync(`scripts/design-compare-${name}.sql`, 'utf8');
    assert.match(sql, new RegExp(`create policy test_slow_read on public\\.${table} as restrictive for select to authenticated using \\(\\(select pg_sleep\\([1-7]\\)\\) is not null\\);`), `${name}: slows ${table} under the 8s statement timeout`);
    assert.deepEqual(screen.builtSteps, [{ goto: page }, { finish: placeholder }, { waitFor: placeholder }], name);
    assert.equal(screen.builtSettle, false, name);
  }
});

test('a screen with no built equivalent needs --built-path or --reference-only', () => {
  const log = ['--screen', 'agent-chat', '--width', '1440', '--lang', 'en', '--theme', 'light'];
  assert.throws(() => parseArgs(log), error => error.exitCode === 2 && /Screen "agent-chat" has no built equivalent yet; pass --built-path PATH or --reference-only\./.test(error.message));
  assert.equal(parseArgs([...log, '--reference-only']).builtPath, null);
  const held = ['--screen', 'numbers-loading', '--width', '1440', '--lang', 'en', '--theme', 'light'];
  assert.deepEqual([parseArgs(held).referenceOnly, parseArgs(held).builtPath], [false, '/c/rs-learning/home'], 'a held loading state is captured on both sides');
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
