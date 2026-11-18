import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentNoteText, dayOf, daysBack, describeEntry, groupByDay, logCursor, logEmptyNote, matchesFilters, parseBefore, parseCard, parseWho } from '../lib/activity-log.mjs';
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
 const requested = describeEntry({ subject: 'agent', action: 'agent_requested', details: { agent_name: 'Meta Ads', job: 'Runs the Meta ads.' } });
 assert.deepEqual([requested.act, requested.obj, requested.to], [['logActAgentRequested'], 'Meta Ads', { text: 'Runs the Meta ads.' }]);
 const rule = 'من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها';
 const saved = describeEntry({ subject: 'agent', action: 'agent_rule_saved', agent_id: lead, details: { agent_name: 'Ads', rule } });
 assert.deepEqual([saved.act, saved.obj, saved.to], [['logActRuleSaved', { text: 'Ads' }], rule, { key: 'logRuleInEffect' }], 'the rule is the object, said in the chat and in effect now');
 const removed = describeEntry({ subject: 'agent', action: 'agent_rule_removed', agent_id: lead, details: { rule: 'x'.repeat(200) } }, { agentName: id => id === lead ? 'Ads' : undefined });
 assert.deepEqual([removed.act, removed.obj.length, removed.to], [['logActRuleRemoved', { text: 'Ads' }], 80, undefined]);
 // A skill written into an Agent's profile, or switched for it: the skill is the object, the Agent named in the act.
 const skills = ['skill_written', 'skill_enabled', 'skill_disabled'].map(action => describeEntry({ subject: 'agent', action, agent_id: lead, details: { agent_name: 'Ads', skill: 'weekly-recap' } }));
 assert.deepEqual(skills.map(entry => [entry.act, entry.obj]), [[['logActSkillWritten', { text: 'Ads' }], 'weekly-recap'], [['logActSkillEnabled', { text: 'Ads' }], 'weekly-recap'], [['logActSkillDisabled', { text: 'Ads' }], 'weekly-recap']]);
 assert.equal(i18n('en').t('logActSkillDisabled', 'Ads'), 'switched off a skill for Ads');
 // A Contributor's rule suggested for the team, then approved or refused, naming who taught it (#25).
 const [suggested, approved, rejected] = ['agent_rule_suggested', 'agent_rule_approved', 'agent_rule_rejected'].map(action => describeEntry({ subject: 'agent', action, agent_id: lead, details: { agent_name: 'Ads', rule, ...(action === 'agent_rule_suggested' ? {} : { taught_by: 'يوسف' }) } }));
 assert.deepEqual([suggested.act, suggested.obj, suggested.to], [['logActRuleSuggested', { text: 'Ads' }, { text: '' }], rule, { key: 'logRuleWaiting' }]);
 assert.deepEqual([approved.act, approved.obj, approved.to], [['logActRuleApproved', { text: 'Ads' }, { text: 'يوسف' }], rule, { key: 'logRuleTeamWide' }]);
 assert.deepEqual([rejected.act, rejected.obj, rejected.to], [['logActRuleRejected', { text: 'Ads' }, { text: 'يوسف' }], rule, { key: 'logRuleOwnWork' }]);
 assert.equal(i18n('en').t('logActRuleApproved', 'Ads', 'Youssef'), 'approved what Youssef taught Ads');
 // An invitation names the email and "{Role} · Invite sent" (#185).
 const invited = describeEntry({ subject: 'member', action: 'member_invited', details: { email: 'nour@rslearning.com', role: 'contributor', private: 'managers' } });
 assert.deepEqual([invited.act, invited.obj, invited.to], [['logActMemberInvited'], 'nour@rslearning.com', { key: 'logInvitedContributor' }]);
 assert.deepEqual(['en', 'ar'].map(language => [i18n(language).t('logActMemberInvited'), i18n(language).t('logInvitedContributor')]), [['invited a member', 'Contributor · Invite sent'], ['عزم عضو', 'مساهم · اتبعتله دعوة']]);
 const long = describeEntry({ subject: 'card', action: 'card_changed', details: { field: 'title', old: 'x'.repeat(200), new: 'y' } });
 assert.equal(long.from.text.length, 80);
 // Every act and value key is in both catalogues.
 const rows = [moved, note, handed, caption, role, added, requested, saved, removed, suggested, approved, rejected, describeEntry({ subject: 'card', action: 'unknown' }), describeEntry({ subject: 'member', action: 'agent_granted', details: {} }), invited, ...['manager', 'viewer'].map(role => describeEntry({ subject: 'member', action: 'member_invited', details: { email: 'a@b.co', role } }))];
 for (const language of ['en', 'ar']) for (const line of rows) {
  const { t } = i18n(language);
  t(line.act[0], ...line.act.slice(1).map(value => 'key' in value ? t(value.key) : value.text));
  for (const value of [line.from, line.to]) if (value && 'key' in value) t(value.key);
 }
});

test('an Agent delivered the draft, named by its title, in both languages; a card kind with no words reads as a change (#136)', () => {
 const shown = describeEntry({ subject: 'agent', action: 'agent_card_shown', agent_id: lead, details: { card: { kind: 'draft', title: 'خطة الحملة' }, private: true } });
 assert.deepEqual([shown.act, shown.obj, shown.from, shown.to], [['logActDraftShown'], 'خطة الحملة', undefined, undefined]);
 assert.deepEqual(['en', 'ar'].map(language => i18n(language).t('logActDraftShown')), ['delivered the draft', 'سلّم المسودة']);
 const later = describeEntry({ subject: 'agent', action: 'agent_card_shown', agent_id: lead, details: { card: { kind: 'question', title: 'Which angle?' } } }, { agentName: () => 'Ads' });
 assert.deepEqual([later.act, later.obj], [['logActAgentChanged'], 'Ads']);
});

test('an Agent reviewed, named by the review\'s title, with how many texts are fine and how many need an edit, in both languages; a row with no counts still reads (#137)', () => {
 const reviewed = describeEntry({ subject: 'agent', action: 'agent_card_shown', agent_id: lead, details: { card: { kind: 'review', title: 'مراجعة نصوص إعلانات ديسمبر', fine: 2, edits: 1 }, private: true } });
 assert.deepEqual([reviewed.act, reviewed.obj, reviewed.from, reviewed.to], [['logActReviewShown'], 'مراجعة نصوص إعلانات ديسمبر', undefined, { key: 'logReviewCounts', values: ['2', '1'] }]);
 assert.deepEqual(['en', 'ar'].map(language => { const { t } = i18n(language); return [t('logActReviewShown'), t('logReviewCounts', '2', '1')]; }),
  [['reviewed', 'Fine: 2 · To edit: 1'], ['راجع', 'تمام: 2 · يتعدّل: 1']]);
 for (const card of [{ kind: 'review', title: 'Hooks review' }, { kind: 'review', title: 'Hooks review', fine: '2', edits: 1 }, { kind: 'review', title: 'Hooks review', fine: -1, edits: 1 }]) {
  const line = describeEntry({ subject: 'agent', action: 'agent_card_shown', agent_id: lead, details: { card } });
  assert.deepEqual([line.act, line.obj, line.to], [['logActReviewShown'], 'Hooks review', undefined], JSON.stringify(card));
 }
});

// #138: the person who answered is the row's actor; the row keeps the question and the answer, privately.
test('a person answered an Agent\'s question: the Agent is named, the question is the object and the answer what it went to, in both languages', () => {
 const answered = describeEntry({ subject: 'agent', action: 'agent_question_answered', agent_id: lead, details: { question: { text: 'اختار زاوية الإعلان', answer: 'من خريج لمحاسب شغال' }, private: true } }, { agentName: () => 'Ads' });
 assert.deepEqual([answered.act, answered.obj, answered.from, answered.to], [['logActQuestionAnswered', { text: 'Ads' }], 'اختار زاوية الإعلان', undefined, { text: 'من خريج لمحاسب شغال' }]);
 assert.deepEqual(['en', 'ar'].map(language => i18n(language).t('logActQuestionAnswered', 'Ads')), ['answered Ads’s question', 'جاوب سؤال Ads']);
 const bare = describeEntry({ subject: 'agent', action: 'agent_question_answered', agent_id: lead, details: { question: { text: 7 } } }, { agentName: () => 'Ads' });
 assert.deepEqual([bare.act, bare.obj, bare.to], [['logActQuestionAnswered', { text: 'Ads' }], undefined, undefined]);
});

// #139: a handed step has one log row, its person's "Done it", with the step's title, from "Handed to you" to "Done it"
// (design-reference: handDone's log line).
test('a person did a step an Agent handed them, named by the step\'s title, in both languages', () => {
 const done = describeEntry({ subject: 'agent', action: 'agent_hand_done', agent_id: lead, details: { hand: { title: 'انشر المقال' }, private: true } }, { agentName: () => 'SEO' });
 assert.deepEqual([done.act, done.obj, done.from, done.to], [['logActHandDone'], 'انشر المقال', { key: 'logHandOpen' }, { key: 'logHandDone' }]);
 assert.deepEqual(['en', 'ar'].map(language => { const { t } = i18n(language); return [t('logActHandDone'), t('logHandOpen'), t('logHandDone')]; }),
  [['did it', 'Handed to you', 'Done it'], ['عملها', 'اتسلّمتلك', 'عملتها']]);
 const bare = describeEntry({ subject: 'agent', action: 'agent_hand_done', agent_id: lead, details: { hand: { title: 7 } } });
 assert.deepEqual([bare.act, bare.obj], [['logActHandDone'], undefined]);
});

// #163: the person who decided is the row's actor; what the Agent's Run asked is the object, from "Waiting for OK" to the
// outcome (design-reference: decide's log line).
test('a person decided what an Agent asked to do: allowed or refused, what was asked, from Waiting for OK to the outcome, in both languages', () => {
 const lines = ['once', 'always', 'deny'].map(choice => describeEntry({ subject: 'agent', action: 'agent_permission_decided', agent_id: lead, details: { permission: { text: 'delete the old exports', choice }, private: true } }, { agentName: () => 'Ads' }));
 assert.deepEqual(lines.map(line => [line.act, line.obj, line.from, line.to]), [
  [['logActPermissionAllowed', { text: 'Ads' }], 'delete the old exports', { key: 'logPermissionWaiting' }, { key: 'permissionAllowedOnce' }],
  [['logActPermissionAllowed', { text: 'Ads' }], 'delete the old exports', { key: 'logPermissionWaiting' }, { key: 'permissionAlwaysAllowed' }],
  [['logActPermissionRefused', { text: 'Ads' }], 'delete the old exports', { key: 'logPermissionWaiting' }, { key: 'permissionNotAllowed' }]]);
 assert.deepEqual(['en', 'ar'].map(language => { const { t } = i18n(language); return [t('logActPermissionAllowed', 'Ads'), t('logActPermissionRefused', 'Ads'), t('logPermissionWaiting'), t('permissionAllowedOnce'), t('permissionAlwaysAllowed'), t('permissionNotAllowed')]; }),
  [['approved Ads’s request', 'refused Ads’s request', 'Waiting for OK', 'Allowed once', 'Always allowed', 'Not allowed'], ['وافق على طلب Ads', 'رفض طلب Ads', 'مستني موافقة', 'سمحت مرة واحدة', 'سمحت دايماً', 'مسمحتش']]);
 const bare = describeEntry({ subject: 'agent', action: 'agent_permission_decided', agent_id: lead, details: { permission: { text: 7, choice: 'deny' } } }, { agentName: () => 'Ads' });
 assert.deepEqual([bare.act, bare.obj], [['logActPermissionRefused', { text: 'Ads' }], undefined]);
 const unknown = describeEntry({ subject: 'agent', action: 'agent_permission_decided', agent_id: lead, details: { permission: { text: 'delete', choice: 'session' } } }, { agentName: () => 'Ads' });
 assert.deepEqual([unknown.act, unknown.obj, unknown.to], [['logActAgentChanged'], 'Ads', undefined], 'a choice with no words is never read as allowed');
});

// #146: a chat with a Card writes these rows on the Card, with no teller; each reads as its row on the Agent does.
test('a draft, a review, an answer and a Done it written on the chat\'s Card read as they do on its Agent', () => {
 const names = { agentName: () => 'Ads' };
 for (const [action, details] of [['agent_card_shown', { card: { kind: 'draft', title: 'خطة الحملة' } }], ['agent_card_shown', { card: { kind: 'review', title: 'مراجعة', fine: 2, edits: 1 } }],
  ['agent_question_answered', { question: { text: 'اختار زاوية الإعلان', answer: 'من خريج لمحاسب شغال' } }], ['agent_hand_done', { hand: { title: 'انشر المقال' } }]]) {
  const onCard = describeEntry({ subject: 'card', action, agent_id: lead, details }, names);
  assert.notDeepEqual(onCard.act, ['logActCardOther'], action);
  assert.deepEqual(onCard, describeEntry({ subject: 'agent', action, agent_id: lead, details: { ...details, private: true } }, names), action);
 }
 assert.deepEqual(describeEntry({ subject: 'card', action: 'agent_card_shown', agent_id: lead, details: { card: { kind: 'question', title: 'Which angle?' } } }).act, ['logActCardOther']);
});

// #147: a job Lead handed another Agent is on the Card: the Agent it went to, and the job it went to.
test('a job Lead handed to another Agent names the Agent and the job, in both languages', () => {
 const line = describeEntry({ subject: 'card', action: 'agent_handed_to', agent_id: lead, details: { agent_name: 'Lead', to_name: 'Ads', goal: 'Plan the March intake' } });
 assert.deepEqual([line.act, line.obj, line.from, line.to], [['logActHandedTo', { text: 'Ads' }], undefined, undefined, { text: 'Plan the March intake' }]);
 assert.deepEqual(['en', 'ar'].map(language => i18n(language).t('logActHandedTo', 'Ads')), ['handed to Ads', 'سلّم لـ Ads']);
 // A row that only names the Agent it went to reads from that Agent's name; one naming neither is a change with no words.
 const named = describeEntry({ subject: 'card', action: 'agent_handed_to', agent_id: lead, details: {} }, { agentName: id => id === lead ? 'Ads' : undefined });
 assert.deepEqual([named.act, named.to], [['logActHandedTo', { text: 'Ads' }], undefined]);
 assert.deepEqual(describeEntry({ subject: 'card', action: 'agent_handed_to', details: { to_name: 7 } }).act, ['logActCardOther']);
});

test('an Agent called in a note replies in the log, with its reply as the note under the line (#22)', () => {
 const reply = describeEntry({ subject: 'card', action: 'note_reply', agent_id: lead, body: 'Here is the draft.', details: { reply_to: 12 } });
 assert.deepEqual([reply.act, reply.note, reply.from, reply.to], [['logActNoteReply'], 'Here is the draft.', undefined, undefined]);
 assert.equal(i18n('en').t(reply.act[0]), 'replied in the log');
 assert.equal(i18n('ar').t(reply.act[0]), 'ردّ في السجل');
});

test('a request for an Agent says who asked whom, and the Owner\'s yes or no with its reason, in both languages', () => {
 const sent = describeEntry({ subject: 'agent', action: 'agent_request_sent', agent_id: lead, details: { agent_name: 'Lead', asked_for: 'WhatsApp Leads', job: 'Follows up the leads.' } });
 assert.deepEqual([sent.act, sent.obj, sent.from, sent.to], [['logActAgentRequestSent', { text: 'Lead' }], 'WhatsApp Leads', undefined, { key: 'logAgentRequestWaiting' }]);
 const made = describeEntry({ subject: 'agent', action: 'agent_request_made', agent_id: writer, details: { agent_name: 'WhatsApp Leads', asked_by: 'يوسف' } });
 assert.deepEqual([made.act, made.obj, made.from, made.to], [['logActAgentRequestMade', { text: 'يوسف' }], 'WhatsApp Leads', { key: 'logAgentRequest' }, { key: 'logAgentShowsFor', values: ['يوسف'] }]);
 const declined = describeEntry({ subject: 'agent', action: 'agent_request_declined', agent_id: lead, details: { agent_name: 'Lead', asked_for: 'WhatsApp Leads', asked_by: 'يوسف', reason: 'Ads follows WhatsApp leads now.' } });
 assert.deepEqual([declined.act, declined.obj, declined.from, declined.to], [['logActAgentRequestDeclined', { text: 'يوسف' }], 'WhatsApp Leads', { key: 'logAgentRequest' }, { text: 'Ads follows WhatsApp leads now.' }]);
 assert.deepEqual(['en', 'ar'].map(language => { const { t } = i18n(language); return [t('logActAgentRequestSent', 'Lead'), t('logActAgentRequestMade', 'Youssef'), t('logAgentShowsFor', 'Youssef'), t('logActAgentRequestDeclined', 'Youssef'), t('logAgentRequest'), t('logAgentRequestWaiting')]; }),
  [['asked Lead for an agent', 'made an agent Youssef asked for', 'Shows for Youssef', 'declined an agent request from Youssef', 'Request', 'Waiting for the Owner’s answer'],
   ['طلب من Lead وكيل', 'عمل وكيل طلبه Youssef', 'ظهر عند Youssef', 'رفض طلب وكيل من Youssef', 'طلب', 'مستني رد المالك']]);
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

test('an app connected or disconnected names the app and its state before and after, in both languages', () => {
 const connected = describeEntry({ subject: 'company', action: 'app_connected', details: { app: 'klaviyo' } });
 assert.deepEqual(connected, { act: ['logActAppConnected'], obj: 'Klaviyo', from: { key: 'logAppOff' }, to: { key: 'logAppOn' }, note: undefined });
 const disconnected = describeEntry({ subject: 'company', action: 'app_disconnected', details: { app: 'notion' } });
 assert.deepEqual([disconnected.act, disconnected.obj, disconnected.from, disconnected.to], [['logActAppDisconnected'], 'Notion', { key: 'logAppOn' }, { key: 'logAppOff' }]);
 assert.equal(describeEntry({ subject: 'company', action: 'app_connected', details: { app: 'retired-app' } }).obj, 'retired-app');
 assert.deepEqual(['logActAppConnected', 'logActAppDisconnected', 'logAppOn', 'logAppOff'].map(key => i18n('en').t(key)), ['connected', 'disconnected', 'Connected', 'Not connected']);
 assert.deepEqual(['logActAppConnected', 'logActAppDisconnected', 'logAppOn', 'logAppOff'].map(key => i18n('ar').t(key)), ['وصّل', 'فصل', 'متوصل', 'مش متوصل']);
});

test('an app connected or disconnected for one Agent names the Agent as it was called then, in both languages', () => {
 assert.deepEqual(describeEntry({ subject: 'company', action: 'app_connected', details: { app: 'klaviyo', agent_name: 'Writer' } }),
  { act: ['logActAppConnectedFor', { text: 'Writer' }], obj: 'Klaviyo', from: { key: 'logAppOff' }, to: { key: 'logAppOn' }, note: undefined });
 const disconnected = describeEntry({ subject: 'company', action: 'app_disconnected', details: { app: 'notion', agent_name: 'Writer' } });
 assert.deepEqual([disconnected.act, disconnected.obj, disconnected.from, disconnected.to], [['logActAppDisconnectedFor', { text: 'Writer' }], 'Notion', { key: 'logAppOn' }, { key: 'logAppOff' }]);
 assert.deepEqual(describeEntry({ subject: 'company', action: 'app_connected', details: { app: 'klaviyo', agent_name: '' } }).act, ['logActAppConnected']);
 assert.deepEqual(['en', 'ar'].map(language => [i18n(language).t('logActAppConnectedFor', 'Writer'), i18n(language).t('logActAppDisconnectedFor', 'Writer')]),
  [['let Writer use', 'stopped Writer using'], ['خلّى Writer يستخدم', 'منع Writer من استخدام']]);
});

test('a subscription connected or disconnected names ChatGPT or Claude and its state before and after', () => {
 assert.deepEqual(describeEntry({ subject: 'company', action: 'subscription_connected', details: { provider: 'openai-codex' } }),
  { act: ['logActAppConnected'], obj: 'ChatGPT', from: { key: 'logAppOff' }, to: { key: 'logAppOn' }, note: undefined });
 const disconnected = describeEntry({ subject: 'company', action: 'subscription_disconnected', details: { provider: 'anthropic' } });
 assert.deepEqual([disconnected.act, disconnected.obj, disconnected.from, disconnected.to], [['logActAppDisconnected'], 'Claude', { key: 'logAppOn' }, { key: 'logAppOff' }]);
 assert.equal(describeEntry({ subject: 'company', action: 'subscription_connected', details: { provider: 'constructor' } }).obj, 'constructor');
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

test('an edit of the Company knowledge names the part by its title, and says when it was cleared, in both languages', () => {
 const edited = describeEntry({ subject: 'company', action: 'company_knowledge_changed', details: { part: 'banned', cleared: false } });
 const cleared = describeEntry({ subject: 'company', action: 'company_knowledge_changed', details: { part: 'voice', cleared: true } });
 assert.deepEqual([edited.act, cleared.act], [['logActCompanyKnowledge', { key: 'knowBanned' }], ['logActCompanyKnowledgeCleared', { key: 'knowVoice' }]]);
 assert.notEqual(i18n('en').t(edited.act[0], 'x'), i18n('en').t(cleared.act[0], 'x'), 'an edit and a clearing read differently');
 for (const language of ['en', 'ar']) {
  const { t } = i18n(language);
  assert.ok(t(edited.act[0], t('knowBanned')).includes(t('knowBanned')), language);
  assert.ok(t(cleared.act[0], t('knowVoice')).includes(t('knowVoice')), language);
 }
});

test('a comment in the Card activity reads as its note now stands, and nothing else changes (#22)', () => {
 const rows = [
  { id: 1, action: 'comment_added', details: { id: 41, body: 'First text' } },
  { id: 2, action: 'comment_added', details: { id: 42, body: 'Never edited' } },
  { id: 3, action: 'card_changed', details: { id: 41, field: 'title' } },
 ];
 const shown = currentNoteText(rows, [{ id: 41, body: 'Edited text' }]);
 assert.deepEqual(shown.map(row => row.details), [{ id: 41, body: 'Edited text' }, { id: 42, body: 'Never edited' }, { id: 41, field: 'title' }]);
 assert.equal(rows[0].details.body, 'First text', 'the rows read from the database are left as they are');
});

test('with no row shown the log says nothing matches while the Company has rows, and that it is empty when it has none', () => {
  assert.equal(logEmptyNote({ companyRows: 12 }), 'noMatch');
  assert.equal(logEmptyNote({ companyRows: 1 }), 'noMatch');
  assert.equal(logEmptyNote({ companyRows: 0 }), 'empty');
  assert.equal(logEmptyNote({ companyRows: null }), 'empty');
});
