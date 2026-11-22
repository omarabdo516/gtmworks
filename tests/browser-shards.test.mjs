import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measuredTimes, shardFiles, shardSeconds } from '../scripts/browser-shards.mjs';

// The browser shards split the suite by measured time, not by test count (#653): Playwright's own --shard cuts the
// suite into runs of equal test counts in file order, so the slow conversation and Engine files, side by side in that
// order, all fell to shard 3, which ran out its 12 minutes while the others finished in 8.

test('every spec file goes to exactly one shard, and the measured time is shared out evenly', () => {
  const times = { 'a.spec.ts': 600, 'b.spec.ts': 300, 'c.spec.ts': 300, 'd.spec.ts': 200, 'e.spec.ts': 100, 'f.spec.ts': 100 };
  const shards = shardFiles(Object.keys(times), times, 3);
  assert.deepEqual(shards.flat().sort(), Object.keys(times).sort());
  // 1600 s in all: the one 600 s file alone, and the rest in two shards of 500 s.
  assert.deepEqual(shards.map(files => files.reduce((sum, file) => sum + times[file], 0)), [600, 500, 500]);
});

test('the slow files that sit side by side in file order land in different shards', () => {
  const times = { 'conversations.spec.ts': 320, 'engine-conversation.spec.ts': 900, 'frame.spec.ts': 100, 'app.spec.ts': 150, 'board.spec.ts': 200, 'team-work.spec.ts': 130 };
  const shards = shardFiles(Object.keys(times), times, 2);
  const shardOf = file => shards.findIndex(files => files.includes(file));
  assert.notEqual(shardOf('conversations.spec.ts'), shardOf('engine-conversation.spec.ts'));
});

test('a shard runs as Playwright runs it: a file in order holds one worker, a parallel file spreads its tests, and the first-run files come after the rest', () => {
  const times = { 'engine.spec.ts': 800, 'chat.spec.ts': 300, 'first-run.spec.ts': 100 };
  const seconds = spec => times[spec.file];
  const engine = { file: 'engine.spec.ts', tests: 4, parallel: true, last: false };
  const chat = { file: 'chat.spec.ts', tests: 3, parallel: false, last: false };
  const firstRun = { file: 'first-run.spec.ts', tests: 2, parallel: false, last: true };
  // chat's 300 s hold the first worker; engine's four tests of 200 s take the other three, and the fourth the first of
  // them to be free: 400 s, then first run's 100 s.
  assert.equal(shardSeconds([engine, chat, firstRun], seconds, 4), 500);
  // On two shards engine's tests alone take 200 s on four workers: chat's 300 s in order go to the other shard, and
  // first run then lengthens engine's shard least (300 s, against chat's 400 s), though it holds the most seconds.
  assert.deepEqual(shardFiles([engine, chat, firstRun], times, 2, 4), [['engine.spec.ts', 'first-run.spec.ts'], ['chat.spec.ts']]);
});

test('a spec file with no measured time counts as the middle measured one, and the split is the same on every run', () => {
  const times = { 'a.spec.ts': 10, 'b.spec.ts': 50, 'c.spec.ts': 90 };
  const files = ['new.spec.ts', 'a.spec.ts', 'b.spec.ts', 'c.spec.ts'];
  // new counts 50 s, as b does: c (90) and b (50) start the two shards, new joins b (100), and a joins c (100).
  assert.deepEqual(shardFiles(files, times, 2), [['a.spec.ts', 'c.spec.ts'], ['b.spec.ts', 'new.spec.ts']]);
  assert.deepEqual(shardFiles([...files].reverse(), times, 2), shardFiles(files, times, 2));
});

test('the measured times are each file\'s seconds from the shards\' JSON reports, retries included', () => {
  const result = ms => ({ duration: ms });
  const shard1 = { suites: [{ suites: [{ specs: [{ file: 'board.spec.ts', tests: [{ results: [result(20400), result(19600)] }] }] }] }] };
  const shard2 = { suites: [{ specs: [{ file: 'app.spec.ts', tests: [{ results: [result(1200)] }, { results: [result(300)] }] }] }] };
  assert.deepEqual(measuredTimes([shard1, shard2]), { 'app.spec.ts': 2, 'board.spec.ts': 40 });
});

test('the measured times name only spec files the suite has', () => {
  const times = JSON.parse(readFileSync('tests/browser-shard-times.json', 'utf8'));
  for (const [file, seconds] of Object.entries(times)) {
    assert.match(file, /^[a-z0-9-]+\.spec\.ts$/, file);
    assert.doesNotThrow(() => readFileSync(`tests/${file}`), `tests/${file} exists`);
    assert.ok(Number.isInteger(seconds) && seconds > 0, `${file}: whole seconds`);
  }
});

test('ci.sh gives a shard its files from the split in place of Playwright\'s --shard, and shard 1 still runs the proxy suite', () => {
  const ci = readFileSync('ci.sh', 'utf8');
  assert.match(ci, /node scripts\/browser-shards\.mjs "\$shard"/);
  assert.match(ci, /npm run test:e2e -- "\$\{files\[@\]\}" "\$@"/);
  assert.doesNotMatch(ci, /test:e2e -- "\$@"\n/);
  assert.match(ci, /\[\[ \$shard != 1\/\* \]\] && proxy=false/);
});
