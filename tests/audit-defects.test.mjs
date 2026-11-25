import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { i18n } from '../lib/i18n.mjs';
import { pageAlert, pageAlerts } from '../lib/page-alert.mjs';
import { clientErrorResponse, senderLimiter } from '../lib/diagnostics.mjs';
import { cappedBody, cappedForm } from '../lib/request-body.mjs';

// #778 (spec #760): junk requests cannot silence the error log or fill memory, and the alert shows only the product's words.

test('one sender at the limit does not stop another sender\'s client-error line, and a ceiling holds above them all', async () => {
 let now = 0; const allowed = senderLimiter({ perSender: 3, ceiling: 5, windowMs: 1000, clock: () => now });
 assert.deepEqual([1, 2, 3, 4].map(() => allowed('noisy')), [true, true, true, false]);
 assert.equal(allowed('person'), true, 'another sender still gets through');
 assert.equal(allowed('third'), true);
 assert.equal(allowed('fourth'), false, 'the ceiling holds over every sender together');
 now = 1500; assert.equal(allowed('noisy'), true, 'a new minute starts every count again');
 const lines = [];
 const send = sender => clientErrorResponse(new Request('http://localhost/api/client-errors', { method: 'POST', body: JSON.stringify({ source: 'page', message: 'x' }) }), { sender, write: line => lines.push(line), allowed: senderLimiter({ perSender: 1, ceiling: 10 }) });
 const shared = senderLimiter({ perSender: 1, ceiling: 10 });
 const post = sender => clientErrorResponse(new Request('http://localhost/api/client-errors', { method: 'POST', body: JSON.stringify({ source: 'page', message: 'x' }) }), { sender, write: line => lines.push(line), allowed: shared });
 assert.equal((await send('a')).status, 204);
 assert.deepEqual([(await post('junk')).status, (await post('junk')).status, (await post('real')).status], [204, 429, 204]);
 assert.equal(lines.length, 3);
});

test('a body over the limit is refused before it is read, whether it says its length or not', async () => {
 let pulled = 0;
 const stream = () => new ReadableStream({ pull(controller) { pulled++; controller.enqueue(new Uint8Array(1024)); if (pulled > 100) controller.close(); } });
 const declared = new Request('http://localhost/x', { method: 'POST', body: 'x'.repeat(10), headers: { 'content-length': '999999' } });
 assert.equal(await cappedBody(declared, 8000), null, 'a declared length over the limit is refused');
 assert.equal(declared.bodyUsed, false, 'and its body is never read');
 pulled = 0;
 assert.equal(await cappedBody(new Request('http://localhost/x', { method: 'POST', body: stream(), duplex: 'half' }), 8000), null);
 assert.ok(pulled <= 10, `reading stops at the limit (${pulled} chunks read)`);
 assert.equal(new TextDecoder().decode(await cappedBody(new Request('http://localhost/x', { method: 'POST', body: 'small' }), 8000)), 'small');
 const form = new FormData(); form.set('code', 'abc');
 assert.equal((await cappedForm(new Request('http://localhost/x', { method: 'POST', body: form }), 16000)).get('code'), 'abc');
 assert.equal(await cappedForm(new Request('http://localhost/x', { method: 'POST', body: form, headers: { 'content-length': '20000' } }), 16000), null);
 assert.equal((await clientErrorResponse(new Request('http://localhost/api/client-errors', { method: 'POST', body: 'x'.repeat(9000) }), { sender: 'a', write: () => {} })).status, 413);
});

test('the routes that need no sign-in read their body only through the size check', () => {
 for (const file of ['app/first-run/submit/route.ts', 'app/first-owner/submit/route.ts']) {
  const source = readFileSync(file, 'utf8');
  assert.match(source, /cappedForm\(request,/, file);
  assert.doesNotMatch(source, /request\.(formData|text|json|arrayBuffer)\(/, file);
 }
});

test('the alert shows only the product\'s own messages, in the reader\'s language', () => {
 const en = i18n('en').t, ar = i18n('ar').t;
 assert.equal(pageAlert('changeSaved', en), 'Change saved.');
 assert.notEqual(pageAlert('changeSaved', ar), pageAlert('changeSaved', en));
 for (const key of pageAlerts) { assert.ok(pageAlert(key, en) && pageAlert(key, en) !== key, key); assert.ok(pageAlert(key, ar) && pageAlert(key, ar) !== key, key); }
 assert.equal(pageAlert('Your account is locked. Send your password to the address below', en), undefined, 'a crafted text shows nothing');
 assert.equal(pageAlert('settingsInviteSent', en), undefined, 'nor does another catalogue key');
 assert.equal(pageAlert(undefined, en), undefined);
 assert.equal(pageAlert(['changeSaved'], en), undefined);
});

test('every action that comes back to a Company page names its alert by a key the page shows', () => {
 const base = 'app/c/[slug]/[[...section]]/';
 for (const file of ['actions.ts', 'agent-actions.ts', 'project-actions.ts', 'work-actions.ts']) {
  const source = readFileSync(base + file, 'utf8');
  assert.doesNotMatch(source, /message=\$\{encodeURIComponent/, file);
  for (const [, key] of source.matchAll(/[?&]message=([A-Za-z]+)/g)) assert.ok(pageAlerts.includes(key), `${file}: ${key}`);
 }
});

test('the threat model names every service-role client in the code, and none that is gone', () => {
 const files = ['app', 'lib', 'worker'].flatMap(dir => readdirSync(dir, { recursive: true }).map(file => `${dir}/${file}`)).filter(file => /\.(ts|tsx|mjs)$/.test(file) && !/\.d\.mts$/.test(file));
 const clients = files.filter(file => /createClient\([^)]*SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY[\s\S]{0,200}createClient\(/.test(readFileSync(file, 'utf8')));
 const model = readFileSync('docs/threat-model.md', 'utf8');
 const bullet = model.slice(model.indexOf('- **The service role.**'), model.indexOf('Elevated functions are granted'));
 for (const file of clients) assert.ok(bullet.includes(`\`${file}\``), `${file} makes a service-role client and is not in the threat model`);
 for (const [, named] of bullet.matchAll(/`((?:app|lib|worker)\/[^`]+)`/g)) assert.ok(existsSync(named), `${named} is named but gone`);
 for (const [, named] of bullet.matchAll(/`((?:app|lib|worker)\/[^`]+)`/g)) assert.ok(clients.includes(named) || /\b(setupAdmin|serviceDb)\(/.test(readFileSync(named, 'utf8')), `${named} is named but holds no service-role client`);
});

// #779: the home charts count a day by the Company's day (Cairo where none is set).
test('work recorded at 00:30 Cairo is on that Cairo day in the home charts', async () => {
 const { homeCharts } = await import('../lib/home-data.mjs');
 // A delivery is an Approval with its move out of review at the same moment (#676, #684).
 const delivered = (id, created_at) => [{ id, card_id: id, created_at, action: 'approval_approved', details: {} }, { id: id + 100, card_id: id, created_at, action: 'card_changed', details: { field: 'status', old_status: 'waiting', new_status: 'planned' } }];
 // 2030-01-14 22:30 UTC is 00:30 on the 15th in Cairo (UTC+2); now is 10:00 on the 15th in Cairo.
 const now = Date.parse('2030-01-15T08:00:00Z');
 const charts = homeCharts([{ id: 9, status: 'progress', created_at: '2030-01-01T22:30:00Z' }], [...delivered(1, '2030-01-14T22:30:00Z'), ...delivered(2, '2030-01-14T21:30:00Z')], now);
 assert.equal(charts.delivered.at(-1).label, '2030-01-15');
 assert.deepEqual(charts.delivered.slice(-2).map(day => day.value), [1, 1], 'one on the 14th at 23:30 and one on the 15th at 00:30');
 assert.equal(charts.delivered[0].label, '2030-01-02');
 assert.equal(charts.statuses.find(row => row.label === 'progress').value, 1, 'a Card made at 00:30 Cairo on the 2nd is inside the fourteen days');
 const riyadh = homeCharts([], delivered(1, '2030-01-14T21:30:00Z'), now, 'Asia/Riyadh');
 assert.equal(riyadh.delivered.at(-1).value, 1, 'a Company in another zone counts by its own day');
});

// #779: a Routine's time zone is checked when it is saved, and none saved can throw when its next time is worked out.
test('a Routine with a time zone the server does not know is refused when saved, and an old one does not throw', async () => {
 const { routineZone } = await import('../lib/agent-routines.mjs');
 assert.equal(routineZone('Africa/Cairo'), 'Africa/Cairo');
 assert.equal(routineZone(undefined), null);
 assert.equal(routineZone(''), null);
 assert.equal(routineZone('Mars/Phobos'), false);
 assert.equal(routineZone('Not a zone'), false);
 const { changeAgentRoutine } = await import('../lib/agent-routines.mjs');
 const answer = await changeAgentRoutine({ rpc: () => { throw new Error('the database is not asked'); } }, { company: '10000000-0000-4000-8000-000000000001', agent: '10000000-0000-4000-8000-000000000002', action: 'create', prompt: 'Send me the cost per lead', schedule: '0 9 * * *', timezone: 'Mars/Phobos', hermes: null });
 assert.deepEqual(answer, { state: 'zoneUnknown' });
 const { whenOf } = await import('../lib/routine-schedule.mjs');
 const t = i18n('en').t;
 assert.doesNotThrow(() => whenOf(t, 'en', '2030-01-15T09:00:00Z', 'Mars/Phobos', new Date('2030-01-15T08:00:00Z')));
 for (const language of ['en', 'ar']) assert.notEqual(i18n(language).t('routineZoneUnknown'), 'routineZoneUnknown');
});

// #777: a file route answers an error status on a failed read, and 404 only for a file that is not there or not theirs.
test('a Company file route tells a failed read from a file that is not there', async () => {
 const { companyFileResponse } = await import('../lib/attachment-file.ts');
 const failure = { code: 'XX000', message: 'boom' };
 const db = ({ company = { data: { id: 'c1' }, error: null }, row = { data: { name: 'a.png', content_type: 'image/png', path: 'c1/a.png' }, error: null }, file = { data: new Blob(['png']), error: null } } = {}) => ({
  from: table => { const query = { select: () => query, eq: () => query, maybeSingle: async () => table === 'companies' ? company : row }; return query; },
  storage: { from: () => ({ download: async () => file }) },
 });
 const answer = async (options, permission = 'allowed', id = '7') => (await companyFileResponse(db(options), 'rs-learning', id, async () => permission, { from: 'card' })).status;
 assert.equal(await answer({}), 200);
 assert.equal(await answer({ company: { data: null, error: failure } }), 503, 'the Company read failed');
 assert.equal(await answer({}, 'failed'), 503, 'the membership read failed');
 assert.equal(await answer({ row: { data: null, error: failure } }), 503, 'the file row read failed');
 assert.equal(await answer({ file: { data: null, error: { status: 500, message: 'storage down' } } }), 503, 'the stored file could not be read');
 assert.equal(await answer({ company: { data: null, error: null } }), 404, 'no such Company for this person');
 assert.equal(await answer({}, 'refused'), 404, 'not a Member: the same answer, nothing tells them the Company exists');
 assert.equal(await answer({ row: { data: null, error: null } }), 404, 'no such file');
 assert.equal(await answer({ file: { data: null, error: { statusCode: '404', message: 'Object not found' } } }), 404, 'the stored file is gone');
 assert.equal(await answer({}, 'allowed', 'x'), 404);
});
