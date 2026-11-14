import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayOf, daysBack, describeEntry, groupByDay, logCursor, matchesFilters, parseBefore, parseCard, parseWho } from '../lib/activity-log.mjs';
import { i18n } from '../lib/i18n.mjs';

// One log for the Company (#11): what each kind of row says, the page's filters and its days.
const omar = '20000000-0000-0000-0000-000000000001', writer = '30000000-0000-0000-0000-000000000001', lead = 'a0000000-0000-0000-0000-000000000001';

test('Card, Member and Agent rows say who changed what', () => {
 const moved = describeEntry({ subject: 'card', action: 'card_changed', details: { field: 'stage_id', old_name: 'أفكار', new_name: 'كتابة' } });
 assert.deepEqual([moved.act, moved.from, moved.to], [['logActMoved'], { text: 'أفكار' }, { text: 'كتابة' }]);
 const note = describeEntry({ subject: 'card', action: 'note', body: 'ملاحظة' });
 assert.deepEqual([note.act, note.note], [['logActNote'], 'ملاحظة']);
 const handed = describeEntry({ subject: 'card', action: 'card_changed', details: { field: 'next_actor', old: omar, new: writer } }, { name: id => ({ [omar]: 'عمر', [writer]: 'وكيل المحتوى' })[id] });
 assert.deepEqual([handed.act, handed.from, handed.to], [['logActHandedOver'], { text: 'عمر' }, { text: 'وكيل المحتوى' }]);
 const caption = describeEntry({ subject: 'card', action: 'card_changed', details: { field: 'caption', old: 'a', new: 'b' } });
 assert.deepEqual([caption.act, caption.from, caption.to], [['logActChanged', { key: 'caption' }], undefined, undefined], 'a caption is named, not quoted');
 const role = describeEntry({ subject: 'member', action: 'member_changed', details: { person_name: 'سارة', old_role: 'viewer', new_role: 'manager' } });
 assert.deepEqual([role.act, role.obj, role.from, role.to], [['logActMemberRole'], 'سارة', { key: 'viewer' }, { key: 'manager' }]);
 const added = describeEntry({ subject: 'agent', action: 'agent_added', agent_id: lead, details: {} }, { agentName: id => id === lead ? 'Lead' : undefined });
 assert.deepEqual([added.act, added.obj], [['logActAgentAdded'], 'Lead']);
 const long = describeEntry({ subject: 'card', action: 'card_changed', details: { field: 'title', old: 'x'.repeat(200), new: 'y' } });
 assert.equal(long.from.text.length, 80);
 // Every act and value key is in both catalogues.
 const rows = [moved, note, handed, caption, role, added, describeEntry({ subject: 'card', action: 'unknown' }), describeEntry({ subject: 'member', action: 'agent_granted', details: {} })];
 for (const language of ['en', 'ar']) for (const line of rows) {
  const { t } = i18n(language);
  t(line.act[0], ...line.act.slice(1).map(value => t(value.key)));
  for (const value of [line.from, line.to]) if (value && 'key' in value) t(value.key);
 }
});

test('the filters: everyone, one person, one Agent, gtmworks itself, one Card', () => {
 const rows = [
  { id: 1, actor_kind: 'person', actor_id: omar, card_id: 5, agent_id: null },
  { id: 2, actor_kind: 'agent', actor_id: writer, card_id: 5, agent_id: null },
  { id: 3, actor_kind: 'person', actor_id: omar, card_id: null, agent_id: lead },
  { id: 4, actor_kind: 'system', actor_id: null, card_id: 6, agent_id: null },
 ];
 const ids = (who, card = null) => rows.filter(row => matchesFilters(row, parseWho(who), card)).map(row => row.id);
 assert.deepEqual(ids(undefined), [1, 2, 3, 4]);
 assert.deepEqual(ids(`p:${omar}`), [1, 3]);
 assert.deepEqual(ids(`a:${writer}`), [2]);
 assert.deepEqual(ids(`a:${lead}`), [3], 'an Agent matches the rows about it');
 assert.deepEqual(ids('s'), [4]);
 assert.deepEqual(ids(undefined, 5), [1, 2]);
 assert.deepEqual(ids(`p:${omar}`, 5), [1]);
 assert.deepEqual(parseWho("p:1' or 1=1"), { kind: 'all' }, 'anything but an id is everyone');
 assert.equal(parseCard('12'), 12);
 assert.equal(parseCard('1;drop'), null);
 assert.equal(parseCard('0'), null);
});

test('rows are grouped by the reader’s own day, newest first', () => {
 const rows = [
  { id: 1, created_at: '2026-11-12T21:30:00Z' },
  { id: 2, created_at: '2026-11-12T23:10:00Z' },
  { id: 3, created_at: '2026-11-13T08:00:00Z' },
 ];
 assert.deepEqual(groupByDay(rows, 'UTC').map(group => [group.day, group.items.map(row => row.id)]), [['2026-11-13', [3]], ['2026-11-12', [2, 1]]]);
 // In Cairo (UTC+2) the row at 23:10 UTC already belongs to the 13th; the one at 21:30 UTC (23:30 there) does not.
 assert.deepEqual(groupByDay(rows, 'Africa/Cairo').map(group => [group.day, group.items.map(row => row.id)]), [['2026-11-13', [3, 2]], ['2026-11-12', [1]]]);
 assert.equal(dayOf('2026-11-12T23:10:00Z', 'Africa/Cairo'), '2026-11-13');
 assert.equal(daysBack('2026-11-12', '2026-11-13'), 1);
 assert.equal(daysBack('2026-11-13', '2026-11-13'), 0);
});

test('an older page starts at a cursor of time and id, and anything else is the first page', () => {
 const row = { created_at: '2026-01-01T00:00:00.123456+00:00', id: 302 };
 assert.equal(logCursor(row), '2026-01-01T00:00:00.123456+00:00~302');
 assert.deepEqual(parseBefore(logCursor(row)), { at: '2026-01-01T00:00:00.123456+00:00', id: '302' });
 // A '+' read back from an address as a space is still the same cursor.
 assert.deepEqual(parseBefore('2026-01-01T00:00:00Z~7'), { at: '2026-01-01T00:00:00Z', id: '7' });
 assert.deepEqual(parseBefore('2026-01-01T00:00:00.5 00:00~7'), { at: '2026-01-01T00:00:00.5+00:00', id: '7' });
 for (const bad of [undefined, '', '302', '2026-01-01~1', '2026-13-45T99:99:99Z~1', '2026-01-01T00:00:00Z~0', '2026-01-01T00:00:00Z~1,id.gt.0', '2026-01-01T00:00:00Z"~1']) assert.equal(parseBefore(bad), null, String(bad));
});

test('a Company rename names the old name and the new one, in both languages', () => {
 const renamed = describeEntry({ subject: 'company', action: 'company_renamed', details: { old_name: 'RS Learning', new_name: 'RS Learning Academy' } });
 assert.deepEqual(renamed.act, ['logActCompanyRenamed']);
 assert.deepEqual([renamed.from, renamed.to], [{ text: 'RS Learning' }, { text: 'RS Learning Academy' }]);
 assert.equal(i18n('en').t('logActCompanyRenamed'), 'renamed the company');
 assert.equal(i18n('ar').t('logActCompanyRenamed'), 'غيّر اسم الشركة');
});

test('a day with no zone given follows the runtime zone, also after it changes', () => {
 const before = process.env.TZ;
 try {
  process.env.TZ = 'UTC';
  assert.equal(dayOf('2026-11-12T23:30:00Z'), '2026-11-12');
  process.env.TZ = 'Africa/Cairo';
  assert.equal(dayOf('2026-11-12T23:30:00Z'), '2026-11-13');
 } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
});
