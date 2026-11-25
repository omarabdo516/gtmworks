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
 // An idea added in the Ideas column (#188) says so, in both languages.
 const idea = describeEntry({ subject: 'card', action: 'idea_added', details: {} });
 assert.deepEqual([idea.act, idea.to, i18n('en').t('logActIdeaAdded'), i18n('ar').t('logActIdeaAdded')], [['logActIdeaAdded'], { key: 'boardColIdeas' }, 'added an idea', 'ضاف فكرة'], 'with the column it landed in');
 // "Undo" on a move (#168) is a row of its own, naming the two board columns the Card left and returned to.
 const back = describeEntry({ subject: 'card', action: 'card_moved_back', details: { old_column: 'planned', new_column: 'progress' } });
 assert.deepEqual([back.act, back.from, back.to], [['logActMovedBack'], { key: 'boardColPlanned' }, { key: 'boardColProgress' }]);
 assert.deepEqual(['en', 'ar'].map(language => i18n(language).t('logActMovedBack')), ['moved the card back', 'رجّع البطاقة مكانها']);
 // Archiving and restoring a Card (#670) name the column it left for the archive, and the column it came back to.
 const cardArchived = describeEntry({ subject: 'card', action: 'card_archived', details: { column: 'progress' } });
 assert.deepEqual([cardArchived.act, cardArchived.from, cardArchived.to], [['logActArchived'], { key: 'boardColProgress' }, { key: 'logArchive' }]);
 const cardRestored = describeEntry({ subject: 'card', action: 'card_restored', details: { column: 'done' } });
 assert.deepEqual([cardRestored.act, cardRestored.from, cardRestored.to], [['logActRestored'], { key: 'logArchive' }, { key: 'boardColDone' }]);
 assert.deepEqual(['en', 'ar'].map(language => ['logActArchived', 'logActRestored', 'logArchive'].map(key => i18n(language).t(key))),
  [['archived the card', 'restored the card', 'Archived'], ['أرشف البطاقة', 'رجّع البطاقة', 'الأرشيف']]);
 // Archiving and restoring a team channel (#675) name the channel, to the archive and back.
 const channelArchived = describeEntry({ subject: 'company', action: 'channel_archived', details: { channel_id: 'x', channel: 'Spring launch' } });
 assert.deepEqual([channelArchived.act, channelArchived.obj, channelArchived.from, channelArchived.to], [['logActChannelArchived'], '#Spring launch', undefined, { key: 'logArchive' }]);
 const channelRestored = describeEntry({ subject: 'company', action: 'channel_restored', details: { channel_id: 'x', channel: 'Spring launch' } });
 assert.deepEqual([channelRestored.act, channelRestored.obj, channelRestored.from, channelRestored.to], [['logActChannelRestored'], '#Spring launch', { key: 'logArchive' }, undefined]);
 assert.deepEqual(['en', 'ar'].map(language => ['logActChannelArchived', 'logActChannelRestored'].map(key => i18n(language).t(key))),
  [['archived the channel', 'restored the channel'], ['أرشف قناة', 'رجّع قناة']]);
 // Archiving and restoring a Conversation (#674) are its person's own rows, where its other events go (log_chat_event):
 // the Conversation's title, to the archive and back, whichever subject the row has.
 for (const subject of ['agent', 'card']) {
  const chatArchived = describeEntry({ subject, action: 'conversation_archived', details: { title: 'Plan the launch' } });
  assert.deepEqual([chatArchived.act, chatArchived.obj, chatArchived.from, chatArchived.to], [['logActConversationArchived'], 'Plan the launch', undefined, { key: 'logArchive' }]);
  const chatRestored = describeEntry({ subject, action: 'conversation_restored', details: { title: 'Plan the launch' } });
  assert.deepEqual([chatRestored.act, chatRestored.obj, chatRestored.from, chatRestored.to], [['logActConversationRestored'], 'Plan the launch', { key: 'logArchive' }, undefined]);
 }
 assert.deepEqual(['en', 'ar'].map(language => ['logActConversationArchived', 'logActConversationRestored'].map(key => i18n(language).t(key))),
  [['archived the conversation', 'restored the conversation'], ['أرشف المحادثة', 'رجّع المحادثة']]);
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
 const restored = describeEntry({ subject: 'agent', action: 'agent_rule_restored', agent_id: lead, details: { agent_name: 'Ads', rule } });
 assert.deepEqual([restored.act, restored.obj, restored.to], [['logActRuleRestored', { text: 'Ads' }], rule, { key: 'logRuleInEffect' }], 'a rule brought back is in effect again');
 assert.equal(i18n('en').t('logActRuleRestored', 'Ads'), 'brought back a rule for Ads');
 // A skill written into an Agent's profile, or switched for it: the skill is the object, the Agent named in the act.
 const skills = ['skill_written', 'skill_enabled', 'skill_disabled'].map(action => describeEntry({ subject: 'agent', action, agent_id: lead, details: { agent_name: 'Ads', skill: 'weekly-recap' } }));
 assert.deepEqual(skills.map(entry => [entry.act, entry.obj]), [[['logActSkillWritten', { text: 'Ads' }], 'weekly-recap'], [['logActSkillEnabled', { text: 'Ads' }], 'weekly-recap'], [['logActSkillDisabled', { text: 'Ads' }], 'weekly-recap']]);
 assert.equal(i18n('en').t('logActSkillDisabled', 'Ads'), 'switched off a skill for Ads');
 // A field saved from an Agent's page (#161): the Agent is named in the act and the field is what changed. About keeps
 // no text, so it reads Edited; a field this version has no words for reads as a change to the Agent.
 const setting = describeEntry({ subject: 'agent', action: 'agent_setting_changed', agent_id: lead, details: { agent_name: 'Ads', field: 'about' } });
 assert.deepEqual([setting.act, setting.obj, setting.from, setting.to], [['logActSettingChanged', { key: 'logFieldAbout' }, { text: 'Ads' }], undefined, undefined, { key: 'logEdited' }]);
 assert.deepEqual(['en', 'ar'].map(language => { const { t } = i18n(language); const [key, ...args] = setting.act; return [t(key, ...args.map(value => 'key' in value ? t(value.key) : value.text)), t('logEdited')]; }),
  [['changed the description in the settings of Ads', 'Edited'], ['غيّر الوصف في إعدادات Ads', 'اتعدّل']]);
 const unknownField = describeEntry({ subject: 'agent', action: 'agent_setting_changed', agent_id: lead, details: { agent_name: 'Ads', field: 'thinking' } }, { agentName: () => 'Ads' });
 assert.deepEqual([unknownField.act, unknownField.to], [['logActAgentChanged'], undefined], 'a field with no words is never guessed');
 // The standing instructions read as Edited too (#176): their text is never in the row.
 const instructions = describeEntry({ subject: 'agent', action: 'agent_setting_changed', agent_id: lead, details: { agent_name: 'Ads', field: 'instructions' } });
 assert.deepEqual([instructions.act, instructions.obj, instructions.from, instructions.to], [['logActSettingChanged', { key: 'logFieldInstructions' }, { text: 'Ads' }], undefined, undefined, { key: 'logEdited' }]);
 assert.deepEqual(['en', 'ar'].map(language => { const { t } = i18n(language); const [key, ...args] = instructions.act; return t(key, ...args.map(value => 'key' in value ? t(value.key) : value.text)); }),
  ['changed the instructions in the settings of Ads', 'غيّر التعليمات في إعدادات Ads']);
 // The Voice section saved on the Agent's page (#162): one row named by the section, with no value in it.
 const voice = describeEntry({ subject: 'agent', action: 'agent_setting_changed', agent_id: lead, details: { agent_name: 'Ads', field: 'voice' } });
 assert.deepEqual([voice.act, voice.obj, voice.from, voice.to], [['logActSettingChanged', { key: 'logFieldVoice' }, { text: 'Ads' }], undefined, undefined, undefined]);
 // Good morning (#182): the time before and after, or Off.
 const morning = describeEntry({ subject: 'agent', action: 'agent_setting_changed', agent_id: lead, details: { agent_name: 'Lead', field: 'morning', old: 'off', new: '9:00' } });
 assert.deepEqual([morning.act, morning.from, morning.to], [['logActSettingChanged', { key: 'logFieldMorning' }, { text: 'Lead' }], { key: 'logOff' }, { key: 'logMorningAt1', values: ['9', '00'] }]);
 const morningOff = describeEntry({ subject: 'agent', action: 'agent_setting_changed', agent_id: lead, details: { agent_name: 'Lead', field: 'morning', old: '9:30', new: 'off' } });
 assert.deepEqual([morningOff.from, morningOff.to], [{ key: 'logMorningAt1', values: ['9', '30'] }, { key: 'logOff' }]);
 const morningOther = describeEntry({ subject: 'agent', action: 'agent_setting_changed', agent_id: lead, details: { agent_name: 'Lead', field: 'morning', old: '17:30', new: 'other' } });
 assert.deepEqual([morningOther.from, morningOther.to], [{ key: 'logMorningAt3', values: ['5', '30'] }, { key: 'logMorningOther' }]);
 assert.deepEqual(['en', 'ar'].map(language => { const { t } = i18n(language); const [key, ...args] = voice.act; return t(key, ...args.map(value => 'key' in value ? t(value.key) : value.text)); }),
  ['changed the voice in the settings of Ads', 'غيّر الصوت في إعدادات Ads']);
 // A setting on an Agent's Engine profile (#125): its label, then the value before and after; a yes or no is a word.
 const engineSetting = describeEntry({ subject: 'agent', action: 'agent_setting_changed', agent_id: lead, details: { agent_name: 'Ads', setting: 'memory.memory_char_limit', old: 2200, new: 3000 } });
 assert.deepEqual([engineSetting.act, engineSetting.from, engineSetting.to], [['logActSettingChanged', { key: 'settingMemorySize' }, { text: 'Ads' }], { text: '2200' }, { text: '3000' }]);
 assert.equal(i18n('en').t('logActSettingChanged', 'Memory size', 'Ads'), 'changed Memory size in the settings of Ads');
 const toggled = describeEntry({ subject: 'agent', action: 'agent_setting_changed', agent_id: lead, details: { agent_name: 'Ads', setting: 'memory.memory_enabled', old: true, new: false } });
 assert.deepEqual([toggled.from, toggled.to], [{ key: 'logOn' }, { key: 'logOff' }]);
 const unknown = describeEntry({ subject: 'agent', action: 'agent_setting_changed', agent_id: lead, details: { agent_name: 'Ads', setting: 'gone.away', old: 'a', new: 'b' } });
 assert.equal(unknown.act[1].key, 'settingUnknown', 'a setting this version does not list is never its raw key');
 // An Agent's memory cleared by the Owner (#350): the Agent is named, and no note text is ever in the row.
 const cleared = describeEntry({ subject: 'agent', action: 'memory_reset', agent_id: lead, details: { agent_name: 'Ads' } });
 assert.deepEqual([cleared.act, cleared.obj], [['logActMemoryReset', { text: 'Ads' }], undefined]);
 assert.equal(i18n('en').t('logActMemoryReset', 'Ads'), 'reset the memory of Ads');
 // One note of an Agent's memory edited, or forgotten by the Owner (#191): the Agent is named, the note never is.
 const [edited, forgotten] = ['memory_edit', 'memory_forget'].map(action => describeEntry({ subject: 'agent', action, agent_id: lead, details: { agent_name: 'Ads' } }));
 assert.deepEqual([edited.act, edited.obj], [['logActMemoryEdit', { text: 'Ads' }], undefined]);
 assert.deepEqual([forgotten.act, forgotten.obj], [['logActMemoryForget', { text: 'Ads' }], undefined]);
 assert.equal(i18n('en').t('logActMemoryEdit', 'Ads'), 'edited a note in the memory of Ads');
 assert.equal(i18n('en').t('logActMemoryForget', 'Ads'), 'forgot a note in the memory of Ads');
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
 const rows = [moved, back, note, idea, handed, caption, role, added, requested, saved, removed, suggested, approved, rejected, describeEntry({ subject: 'card', action: 'unknown' }), describeEntry({ subject: 'member', action: 'agent_granted', details: {} }), invited, ...['manager', 'viewer'].map(role => describeEntry({ subject: 'member', action: 'member_invited', details: { email: 'a@b.co', role } }))];
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

// #166: a standing permission revoked reads as the reference's line: who revoked, the permission, Standing to Will ask again.
test('a revoked standing permission names the permission, from Standing to Will ask again, in both languages', () => {
 const line = describeEntry({ subject: 'agent', action: 'agent_permission_revoked', agent_id: lead, details: { agent_name: 'Ads', permission: { text: 'Meta Ads · create_campaign' } } }, { agentName: () => 'Ads' });
 assert.deepEqual([line.act, line.obj, line.from, line.to], [['logActPermissionRevoked', { text: 'Ads' }], 'Meta Ads · create_campaign', { key: 'logPermissionStanding' }, { key: 'logPermissionAsksAgain' }]);
 assert.deepEqual(['en', 'ar'].map(language => { const { t } = i18n(language); return [t('logActPermissionRevoked', 'Ads'), t('logPermissionStanding'), t('logPermissionAsksAgain')]; }),
  [['revoked a permission of Ads', 'Standing', 'Will ask again'], ['لغى صلاحية من صلاحيات Ads', 'دايمة', 'هيستأذن تاني']]);
 const bare = describeEntry({ subject: 'agent', action: 'agent_permission_revoked', agent_id: lead, details: { permission: { text: 7 } } }, { agentName: () => 'Ads' });
 assert.deepEqual([bare.act, bare.obj], [['logActPermissionRevoked', { text: 'Ads' }], undefined]);
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

// #150: a job handed over inside a channel is written on the Agent, so its row names the Agent it went to and the job.
test('a job handed over inside a channel names the Agent and the job, in both languages', () => {
 const line = describeEntry({ subject: 'agent', action: 'agent_handed_to', agent_id: lead, details: { agent_name: 'Lead', to_name: 'Ads', goal: 'Plan the March intake' } });
 assert.deepEqual([line.act, line.obj, line.from, line.to], [['logActHandedTo', { text: 'Ads' }], undefined, undefined, { text: 'Plan the March intake' }]);
 const named = describeEntry({ subject: 'agent', action: 'agent_handed_to', agent_id: lead, details: {} }, { agentName: id => id === lead ? 'Ads' : undefined });
 assert.deepEqual([named.act, named.to], [['logActHandedTo', { text: 'Ads' }], undefined]);
 assert.deepEqual(describeEntry({ subject: 'agent', action: 'agent_handed_to', details: { to_name: 7 } }).act, ['logActAgentChanged']);
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

// #167: an Owner's or a Manager's answer to a Member's request for a hidden Agent names that Member and the Agent.
test('an Agent opened for a Member, or kept hidden from them, names both, in both languages', () => {
 const opened = describeEntry({ subject: 'agent', action: 'agent_opened_for', agent_id: writer, details: { agent_name: 'Reach', asked_by: 'يوسف' } });
 assert.deepEqual([opened.act, opened.obj, opened.from, opened.to], [['logActAgentOpenedFor', { text: 'يوسف' }], 'Reach', { key: 'logAgentAccessRequest' }, { key: 'logAgentShowsFor', values: ['يوسف'] }]);
 const kept = describeEntry({ subject: 'agent', action: 'agent_kept_hidden', agent_id: writer, details: { agent_name: 'Reach', asked_by: 'يوسف', private: 'managers' } });
 assert.deepEqual([kept.act, kept.obj, kept.to], [['logActAgentKeptHidden', { text: 'يوسف' }], 'Reach', { key: 'logAgentStaysHidden' }]);
 assert.deepEqual(['en', 'ar'].map(language => { const { t } = i18n(language); return [t('logActAgentOpenedFor', 'Youssef'), t('logActAgentKeptHidden', 'Youssef'), t('logAgentAccessRequest'), t('logAgentStaysHidden')]; }),
  [['opened an agent for Youssef', 'kept an agent closed for Youssef', 'Request to open', 'Stays hidden'], ['فتح وكيل لـYoussef', 'خلّى وكيل مقفول لـYoussef', 'طلب فتح', 'فضل مخفي']]);
});

// #19: a proposed change names the setting and the Agent, with the value after it; the Owner's answer follows.
test('a proposed change to an Agent\'s settings, its approval and its decline name the setting and the Agent, in both languages', () => {
 const proposed = describeEntry({ subject: 'agent', action: 'agent_change_proposed', agent_id: writer, details: { agent_name: 'Analyst', setting: 'model', new: 'google/gemini-2.5-pro', reason: 'Faster on big numbers.' } });
 assert.deepEqual([proposed.act, proposed.from, proposed.to], [['logActChangeProposed', { key: 'settingModel' }, { text: 'Analyst' }], { text: 'google/gemini-2.5-pro' }, { key: 'logChangeWaiting' }]);
 const approved = describeEntry({ subject: 'agent', action: 'agent_change_approved', agent_id: writer, details: { agent_name: 'Analyst', setting: 'delegation', new: true } });
 assert.deepEqual([approved.act, approved.from, approved.to], [['logActChangeApproved', { key: 'logChangeSubagents' }, { text: 'Analyst' }], { key: 'logChangeProposal' }, { key: 'logOn' }]);
 const soul = describeEntry({ subject: 'agent', action: 'agent_change_approved', agent_id: writer, details: { agent_name: 'Analyst', setting: 'instructions' } });
 assert.deepEqual([soul.act[1], soul.to], [{ key: 'logFieldInstructions' }, { key: 'logChangeApplied' }], 'the instructions themselves never reach the log');
 const declined = describeEntry({ subject: 'agent', action: 'agent_change_declined', agent_id: writer, details: { agent_name: 'Analyst', setting: 'timezone', new: 'Africa/Cairo' } });
 assert.deepEqual([declined.act, declined.to], [['logActChangeDeclined', { key: 'settingTimezone' }, { text: 'Analyst' }], { key: 'logChangeNothing' }]);
 const reasoned = describeEntry({ subject: 'agent', action: 'agent_change_declined', agent_id: writer, details: { agent_name: 'Analyst', setting: 'model', reason: 'Keep it this month.' } });
 assert.deepEqual(reasoned.to, { text: 'Keep it this month.' });
 assert.deepEqual(['en', 'ar'].map(language => { const { t } = i18n(language); return [t('logActChangeProposed', 'main model', 'Analyst'), t('logActChangeApproved', 'sub-agents', 'Analyst'), t('logActChangeDeclined', 'the instructions', 'Analyst'), t('logChangeWaiting')]; }),
  [['proposed a change to main model in the settings of Analyst', 'approved a change to sub-agents in the settings of Analyst', 'declined a change to the instructions in the settings of Analyst', 'Waiting for the Owner’s OK'],
   ['اقترح تغيير main model في إعدادات Analyst', 'وافق على تغيير sub-agents في إعدادات Analyst', 'رفض تغيير the instructions في إعدادات Analyst', 'مستني موافقة المالك']]);
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

// #621: the Engine went on with a request on the next account of one kind; the row names the kind and both accounts.
test('a request moved to the next account names its kind and the two accounts, before and after', () => {
 assert.deepEqual(describeEntry({ subject: 'company', action: 'provider_switched', details: { provider: 'openai-codex', from_name: 'ChatGPT · Said', to_name: 'ChatGPT 2' } }),
  { act: ['logActProviderSwitched'], obj: 'ChatGPT', from: { text: 'ChatGPT · Said' }, to: { text: 'ChatGPT 2' }, note: undefined });
 assert.equal(describeEntry({ subject: 'company', action: 'provider_switched', details: { provider: 'anthropic' } }).obj, 'Claude');
});

// #644: the Engine moved a request to the Company's Fallback model; the row names the model it was to run on and the
// one that answered, by the Engine's model ids.
test('a request moved to the Fallback model names the model it was to run on and the one that answered', () => {
 assert.deepEqual(describeEntry({ subject: 'company', action: 'fallback_model_used', details: { from_provider: 'openai-codex', from_model: 'gpt-5.5', to_provider: 'anthropic', to_model: 'claude-sonnet-4-6' } }),
  { act: ['logActFallbackModelUsed'], obj: undefined, from: { text: 'gpt-5.5' }, to: { text: 'claude-sonnet-4-6' }, note: undefined });
 assert.deepEqual(describeEntry({ subject: 'company', action: 'fallback_model_used', details: {} }).act, ['logActFallbackModelUsed']);
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

// #370: a memory or skill change whose Engine answer never confirmed it is logged by the worker's pass, and its row reads
// as asked for, not done, and says it is not confirmed, in both languages; a confirmed one reads as done.
test('a memory or skill change nobody confirmed reads as asked for and not confirmed, and a confirmed one as done', () => {
 const acts = { memory_reset: 'logActMemoryReset', memory_edit: 'logActMemoryEdit', memory_forget: 'logActMemoryForget', skill_written: 'logActSkillWritten', skill_enabled: 'logActSkillEnabled', skill_disabled: 'logActSkillDisabled' };
 for (const [action, act] of Object.entries(acts)) {
  const row = describeEntry({ subject: 'agent', action, agent_id: lead, details: { agent_name: 'Ads', skill: action.startsWith('skill_') ? 'weekly-recap' : undefined, unconfirmed: true } });
  assert.deepEqual([row.act, row.to], [[`${act}Asked`, { text: 'Ads' }], { key: 'logUnconfirmed' }]);
  assert.deepEqual(describeEntry({ subject: 'agent', action, agent_id: lead, details: { agent_name: 'Ads' } }).act, [act, { text: 'Ads' }]);
 }
 assert.deepEqual(['en', 'ar'].map(language => [i18n(language).t('logActMemoryEditAsked', 'Ads'), i18n(language).t('logUnconfirmed')]),
  [['asked to edit a note in the memory of Ads', 'Not confirmed'], ['طلب يعدّل ملاحظة في ذاكرة Ads', 'مش متأكد إنه حصل']]);
});

// #677: a Card's one assignee changed reads as who it went to; nobody chose it when the Agent was removed or the Member
// left or can only read now, and the row says so.
test('an assignee change names who it went to, and a removal says why the Card has no assignee', () => {
 const row = details => describeEntry({ subject: 'card', action: 'card_changed', details: { field: 'assignee', ...details } });
 assert.deepEqual(row({ old: 'p:1', new: 'a:2', old_name: 'Sara', new_name: 'Ads' }), { act: ['logActAssigned'], obj: undefined, from: { text: 'Sara' }, to: { text: 'Ads' }, note: undefined });
 assert.deepEqual(row({ old: 'a:2', new: null, old_name: 'Ads' }).act, ['logActUnassigned']);
 assert.deepEqual(row({ old: 'a:2', new: null, old_name: 'Ads', reason: 'agent_removed' }), { act: ['logActUnassignedRemoved'], obj: undefined, from: { text: 'Ads' }, to: { key: 'logNone' }, note: undefined });
 assert.deepEqual(row({ old: 'p:1', new: null, old_name: 'Sara', reason: 'member_removed' }).act, ['logActUnassignedLeft']);
 assert.deepEqual(row({ old: 'p:1', new: null, old_name: 'Sara', reason: 'member_viewer' }).act, ['logActUnassignedViewer']);
});

test('a change of an Agent\'s look says which part changed, from what to what, and a reset says it is automatic again (#698)', () => {
 const words = (entry, language) => { const { t } = i18n(language); const say = value => value && ('key' in value ? t(value.key) : value.text); const [key, ...args] = entry.act; return [t(key, ...args.map(say)), say(entry.from), say(entry.to)]; };
 const colour = describeEntry({ subject: 'agent', action: 'agent_look_changed', agent_id: lead, details: { agent_name: 'Reach', part: 'colour', from: 'violet', to: 'rose', automatic: false } });
 assert.deepEqual(['en', 'ar'].map(language => words(colour, language)), [['changed the colour of Reach', 'Violet', 'Rose'], ['غيّر لون Reach', 'بنفسجي', 'وردي']]);
 const shape = describeEntry({ subject: 'agent', action: 'agent_look_changed', agent_id: lead, details: { agent_name: 'Reach', part: 'shape', from: 'circle', to: 'blob', automatic: false } });
 assert.deepEqual(['en', 'ar'].map(language => words(shape, language)), [['changed the shape of Reach', 'Circle', 'Soft blob'], ['غيّر شكل Reach', 'دايرة', 'فقاعة']]);
 const back = describeEntry({ subject: 'agent', action: 'agent_look_changed', agent_id: lead, details: { agent_name: 'Reach', part: 'temperament', from: 'dreamy', to: 'energetic', automatic: true } });
 assert.deepEqual(['en', 'ar'].map(language => words(back, language)), [['set the temperament of Reach back to automatic', 'Dreamy', 'Energetic'], ['رجّع طبع Reach تلقائي', 'حالم', 'نشيط']]);
 // A value this version has no words for reads as it was kept, never guessed; a part it does not know reads as a change to the Agent.
 const unknown = describeEntry({ subject: 'agent', action: 'agent_look_changed', agent_id: lead, details: { agent_name: 'Reach', part: 'colour', from: 'violet', to: 'amber' } });
 assert.deepEqual(unknown.to, { text: 'amber' });
 const part = describeEntry({ subject: 'agent', action: 'agent_look_changed', agent_id: lead, details: { agent_name: 'Reach', part: 'size' } });
 assert.deepEqual([part.act, part.obj], [['logActAgentChanged'], 'Reach']);
});
