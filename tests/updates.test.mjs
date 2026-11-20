import test from 'node:test';
import assert from 'node:assert/strict';
import { whatsNew, checkUpdate, unseenEntries, updateSource } from '../lib/updates.mjs';

// #442: an install tells its Owners when a newer gtmworks exists on its channel, and what it brings.
const entry = (issue, date = '2026-11-20') => ({ issue, date, en: { title: `T${issue}`, body: `B${issue}.` }, ar: { title: `ع${issue}`, body: `ج${issue}.` } });
const local = [entry(2), entry(1)];
const source = { api: 'https://api.test', raw: 'https://raw.test' };
// A fetch that answers each address from a table; anything else is a 404.
const answering = table => async url => url in table
  ? new Response(JSON.stringify(table[url]), { status: 200 })
  : new Response('not found', { status: 404 });

test('every what\'s-new entry has an issue, a date, and a title and one sentence in English and Arabic', () => {
 assert.ok(whatsNew.length > 0);
 const issues = new Set();
 for (const item of whatsNew) {
  assert.ok(Number.isInteger(item.issue) && item.issue > 0, JSON.stringify(item));
  assert.ok(!issues.has(item.issue), `#${item.issue} has one entry`); issues.add(item.issue);
  assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/);
  for (const language of ['en', 'ar']) {
   assert.ok(item[language]?.title?.trim(), `#${item.issue} ${language} title`);
   assert.ok(item[language]?.body?.trim(), `#${item.issue} ${language} sentence`);
  }
  assert.match(item.ar.title + item.ar.body, /[؀-ۿ]/, `#${item.issue} Arabic is Arabic`);
 }
 const dates = whatsNew.map(item => item.date);
 assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
});

test('a stable install on an older release gets the newest release, its date and the entries it lacks', async () => {
 const fetch = answering({
  // A hotfix of an older line published last, a prerelease and a draft are not the newest.
  'https://api.test/releases?per_page=100': [
   { tag_name: 'v1.2.1', published_at: '2026-11-19T10:00:00Z' },
   { tag_name: 'v1.4.0', published_at: '2026-11-19T11:00:00Z', prerelease: true },
   { tag_name: 'v1.5.0', published_at: '2026-11-19T12:00:00Z', draft: true },
   { tag_name: 'v1.3.0', published_at: '2026-11-18T10:00:00Z' },
  ],
  'https://raw.test/v1.3.0/lib/whats-new.json': [entry(3, '2026-11-18'), ...local],
 });
 assert.deepEqual(await checkUpdate({ installed: '1.2.0', local, source, fetch }),
  { version: 'v1.3.0', date: '2026-11-18T10:00:00Z', entries: [entry(3, '2026-11-18')] });
});

test('a newer release from before what\'s-new existed is still an update, with no lines', async () => {
 const fetch = answering({ 'https://api.test/releases?per_page=100': [{ tag_name: 'v2.0.0', published_at: '2026-11-19T00:00:00Z' }] });
 assert.deepEqual(await checkUpdate({ installed: 'v1.9.9', local, source, fetch }), { version: 'v2.0.0', date: '2026-11-19T00:00:00Z', entries: [] });
});

test('a main install gets what main brings since its build, dated by the newest entry', async () => {
 const fetch = answering({ 'https://raw.test/main/lib/whats-new.json': [entry(4, '2026-11-21'), entry(3, '2026-11-19'), ...local] });
 const update = await checkUpdate({ installed: 'main', local, source, fetch });
 assert.deepEqual(update, { version: 'main', date: '2026-11-21', entries: [entry(4, '2026-11-21'), entry(3, '2026-11-19')] });
});

test('up to date shows nothing: the same or an older release, or main with nothing new', async () => {
 const fetch = answering({
  'https://api.test/releases?per_page=100': [{ tag_name: 'v1.2.0', published_at: '2026-11-01T00:00:00Z' }],
  'https://raw.test/main/lib/whats-new.json': local,
 });
 assert.equal(await checkUpdate({ installed: '1.2.0', local, source, fetch }), null);
 assert.equal(await checkUpdate({ installed: '1.10.0', local, source, fetch }), null);
 assert.equal(await checkUpdate({ installed: 'main', local, source, fetch }), null);
 // No release published yet.
 assert.equal(await checkUpdate({ installed: '1.0.0', local, source, fetch: answering({ 'https://api.test/releases?per_page=100': [] }) }), null);
});

test('a build with no version (a source checkout, a test image) checks nothing', async () => {
 const fetch = () => { throw new Error('must not be called'); };
 for (const installed of [undefined, '', 'gtmworks-local:237']) assert.equal(await checkUpdate({ installed, local, source, fetch }), null);
});

test('offline or a failing check is a failure the caller hides, never an update', async () => {
 const offline = async () => { throw new TypeError('fetch failed'); };
 const failing = async () => new Response('rate limited', { status: 403 });
 const garbage = async () => new Response('{"tag_name":42}', { status: 200 });
 for (const fetch of [offline, failing, garbage]) {
  await assert.rejects(checkUpdate({ installed: '1.0.0', local, source, fetch }));
  await assert.rejects(checkUpdate({ installed: 'main', local, source, fetch }));
 }
});

test('a remote entry without both languages is left out', async () => {
 const half = { issue: 9, date: '2026-11-21', en: { title: 'Only English', body: 'No Arabic.' } };
 const fetch = answering({ 'https://raw.test/main/lib/whats-new.json': [half, entry(5), ...local] });
 assert.deepEqual((await checkUpdate({ installed: 'main', local, source, fetch }))?.entries, [entry(5)]);
});

test('what\'s new after an update: the entries this person has not seen, or, with no record, those since they joined', () => {
 const list = [entry(3, '2026-11-20'), entry(2, '2026-11-10'), entry(1, '2026-11-01')];
 assert.deepEqual(unseenEntries(list, [1, 2], '2026-10-01T00:00:00Z'), [list[0]]);
 assert.deepEqual(unseenEntries(list, [1, 2, 3], '2026-10-01T00:00:00Z'), []);
 assert.deepEqual(unseenEntries(list, null, '2026-11-05T12:00:00Z'), [list[0], list[1]]);
 // Joined the day of the newest entry, as a fresh install's first Owner does: nothing arrived after them.
 assert.deepEqual(unseenEntries(list, null, '2026-11-20T08:00:00Z'), []);
 assert.deepEqual(unseenEntries(list, null, undefined), []);
});

test('the check reads this repository on GitHub unless the install names another source', () => {
 assert.deepEqual(updateSource(undefined), { api: 'https://api.github.com/repos/omarabdo516/gtmworks', raw: 'https://raw.githubusercontent.com/omarabdo516/gtmworks' });
 assert.deepEqual(updateSource('http://127.0.0.120:8643/'), { api: 'http://127.0.0.120:8643', raw: 'http://127.0.0.120:8643' });
});
