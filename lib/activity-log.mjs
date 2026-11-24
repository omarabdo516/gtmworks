import { appByKey } from './app-catalogue.mjs';
import { settingLabelKey } from './engine-setting-labels.mjs';
import { columnLabel } from './board-columns.mjs';

// The Company's one log (#11), as the Activity log page and the Numbers page read it (design-reference: entryHTML,
// logGroupsHTML, renderLogPage). Pure helpers: what a row says, which filter it matches, and its day.
import { knowledgeParts } from './company-knowledge.mjs';

const fieldKeys = { title: 'title', offering: 'offering', segment: 'segment', hook: 'hook', channel: 'channel', format: 'format', go_live: 'publishingDate', goal: 'goal', caption: 'caption', next_actor: 'nextActor', project_id: 'logProject' };
// Long or free-form values are named, not quoted, in a log line.
const unquoted = new Set(['caption', 'go_live']);
const short = value => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > 80 ? `${text.slice(0, 79)}…` : text; };
const roleKeys = new Set(['owner', 'manager', 'contributor', 'viewer']);
// "{Role} · Invite sent" after an invitation (#185; design-reference: sendInvite's log line), by the invited Role.
const invitedKeys = { manager: 'logInvitedManager', contributor: 'logInvitedContributor', viewer: 'logInvitedViewer' };
// What an Agent showed its person under its reply (#136), by the card's kind.
const cardActs = { draft: 'logActDraftShown', review: 'logActReviewShown' };
// Good morning's value in its log line (#182): Off, a time read as the page reads it (9:00 AM, 9:00 الصبح), or "another
// time" for a schedule set in a chat that is no daily time.
const morningValue = value => {
 if (value === 'off' || value == null) return { key: 'logOff' };
 const clock = /^(\d{1,2}):(\d{2})$/.exec(String(value));
 if (!clock) return { key: 'logMorningOther' };
 const hour = Number(clock[1]);
 return { key: `logMorningAt${hour < 5 ? 0 : hour < 12 ? 1 : hour < 15 ? 2 : hour < 18 ? 3 : 4}`, values: [String(hour % 12 || 12), clock[2]] };
};
// What a field saved from an Agent's page is called in its log line (#161, #162, #176): the words beside the field's own name.
const settingFields = { about: 'logFieldAbout', instructions: 'logFieldInstructions', voice: 'logFieldVoice', morning: 'logFieldMorning' };
// What a decided permission request went to (design-reference: OUTCOME).
const permissionOutcomes = { once: 'permissionAllowedOnce', always: 'permissionAlwaysAllowed', deny: 'permissionNotAllowed' };
const count = value => Number.isSafeInteger(value) && value >= 0;
// The subscriptions' own names, the same in every language (lib/provider-switches.mjs names accounts by them too).
export const subscriptionNames = { 'openai-codex': 'ChatGPT', anthropic: 'Claude' };

// The rows a chat writes (#136 to #139), on its Agent or on its Card (#146), read the same.
function chatEntry(row, d, agent, out) {
 // A card an Agent delivered with its reply (#136): the Agent is the row's actor and the card's title is the object. A
 // kind this version has no words for reads as a change to the Agent.
 const card = d.card && typeof d.card === 'object' ? d.card : {};
 if (row.action === 'agent_card_shown' && Object.hasOwn(cardActs, card.kind)) {
  out.act = [cardActs[card.kind]];
  if (typeof card.title === 'string') out.obj = short(card.title);
  // A review says how many reviewed texts are fine and how many need an edit (#137).
  if (card.kind === 'review' && count(card.fine) && count(card.edits)) out.to = { key: 'logReviewCounts', values: [String(card.fine), String(card.edits)] };
  return out;
 }
 // The person's answer to an Agent's question (#138): the person is the row's actor, the question is the object and
 // the answer what it went to.
 const question = d.question && typeof d.question === 'object' ? d.question : {};
 if (row.action === 'agent_question_answered') {
  out.act = ['logActQuestionAnswered', { text: short(agent || '') }];
  if (typeof question.text === 'string') out.obj = short(question.text);
  // Several picks (#648) read as one list of the choices picked.
  if (typeof question.answer === 'string') out.to = { text: short(question.answer) };
  else if (Array.isArray(question.answer) && question.answer.length && question.answer.every(pick => typeof pick === 'string')) out.to = { text: short(question.answer.join(' · ')) };
  return out;
 }
 // The person's decision on what an Agent's Run asked to do (#163; design-reference: decide's log line): the person is the
 // row's actor and what was asked the object, from "Waiting for OK" to the outcome. A choice this version has no words
 // for reads as a change to the Agent.
 const permission = d.permission && typeof d.permission === 'object' ? d.permission : {};
 if (row.action === 'agent_permission_decided' && Object.hasOwn(permissionOutcomes, permission.choice)) {
  out.act = [permission.choice === 'deny' ? 'logActPermissionRefused' : 'logActPermissionAllowed', { text: short(agent || '') }];
  if (typeof permission.text === 'string') out.obj = short(permission.text);
  [out.from, out.to] = [{ key: 'logPermissionWaiting' }, { key: permissionOutcomes[permission.choice] }];
  return out;
 }
 // A standing permission revoked by an Owner or a Manager (#166; design-reference: the click case revoke's log line): the
 // person is the row's actor and the permission, as its row named it, the object, from "Standing" to "Will ask again".
 if (row.action === 'agent_permission_revoked') {
  out.act = ['logActPermissionRevoked', { text: short(agent || '') }];
  if (typeof permission.text === 'string') out.obj = short(permission.text);
  [out.from, out.to] = [{ key: 'logPermissionStanding' }, { key: 'logPermissionAsksAgain' }];
  return out;
 }
 // The person archives or restores their own Conversation (#674; design-reference-card: cvArchive, cvRestore): the person
 // is the row's actor and the Conversation's title the object, to Archived and back. The row is where the
 // Conversation's other events are (log_chat_event): its Card's, or the person's own.
 if (row.action === 'conversation_archived' || row.action === 'conversation_restored') {
  const archived = row.action === 'conversation_archived';
  out.act = [archived ? 'logActConversationArchived' : 'logActConversationRestored'];
  if (typeof d.title === 'string' && d.title) out.obj = short(d.title);
  if (archived) out.to = { key: 'logArchive' }; else out.from = { key: 'logArchive' };
  return out;
 }
 // The person's "Done it" on a step an Agent handed them (#139; design-reference: handDone's log line): the person is the
 // row's actor and the step's title the object, from "Handed to you" to "Done it".
 const hand = d.hand && typeof d.hand === 'object' ? d.hand : {};
 if (row.action === 'agent_hand_done') {
  out.act = ['logActHandDone'];
  if (typeof hand.title === 'string') out.obj = short(hand.title);
  [out.from, out.to] = [{ key: 'logHandOpen' }, { key: 'logHandDone' }];
  return out;
 }
 return null;
}

/**
 * What one log row says: its act (a message key with values), the object it names, a change from → to and a note.
 * A value is either authored text ({text}) or a catalogue key ({key}), with the values it names ({key, values}).
 * @param {{action:string,subject:string,details?:Record<string,unknown>|null,body?:string|null,person_id?:string|null,agent_id?:string|null}} row
 * @param {{name?:(id:string)=>string|undefined,agentName?:(id:string)=>string|undefined}} [names]
 */
export function describeEntry(row, names = {}) {
 const d = row.details || {};
 const nameOf = id => (typeof id === 'string' && names.name?.(id)) || undefined;
 const text = value => ({ text: short(value) });
 const key = value => ({ key: value });
 const out = { act: ['logActOther'], obj: undefined, from: undefined, to: undefined, note: undefined };
 const agent = (typeof d.agent_name === 'string' && d.agent_name) || (row.agent_id && names.agentName?.(row.agent_id)) || undefined;
 const chat = chatEntry(row, d, agent, out);
 if (chat) return chat;
 if (row.subject === 'card') {
  switch (row.action) {
   case 'note': out.act = ['logActNote']; out.note = row.body || ''; break;
   // An Agent's reply to a note that called it (#22), written under the note.
   case 'note_reply': out.act = ['logActNoteReply']; out.note = row.body || ''; break;
   case 'card_created': out.act = ['logActCardCreated']; break;
   // A team channel's first Agent called puts the channel's Card on the board (#151): gtmworks is the row's actor.
   case 'channel_card_added': out.act = ['logActCardFromChannel']; break;
   // An Agent that answered in that channel is on the row, so the Card's "Worked on it:" names it.
   case 'channel_reply': out.act = ['logActChannelReply']; break;
   // A job Lead handed another Agent (#147; design-reference: runSteps's handoff row): the Agent it went to is named,
   // and the job is what it went to. The row is on the Card the handover made or changed.
   case 'agent_handed_to': {
    const to = (typeof d.to_name === 'string' && d.to_name) || (row.agent_id && names.agentName?.(row.agent_id));
    if (!to) { out.act = ['logActCardOther']; break; }
    out.act = ['logActHandedTo', text(to)];
    if (typeof d.goal === 'string') out.to = text(d.goal);
    break;
   }
   // "Undo" on a move (#168) reads as its own act, naming both of the board's columns, as the board moved it.
   case 'card_moved_back': out.act = ['logActMovedBack']; if (d.old_column) out.from = key(columnLabel(String(d.old_column), true)); if (d.new_column) out.to = key(columnLabel(String(d.new_column), true)); break;
   // A Card archived (#670) leaves its column for the archive; restored, it comes back to that column.
   case 'card_archived': out.act = ['logActArchived']; if (d.column) out.from = key(columnLabel(String(d.column), true)); out.to = key('logArchive'); break;
   case 'card_restored': out.act = ['logActRestored']; out.from = key('logArchive'); if (d.column) out.to = key(columnLabel(String(d.column), true)); break;
   // An idea added in the Ideas column (#188), with the column it landed in.
   case 'idea_added': out.act = ['logActIdeaAdded']; out.to = key('boardColIdeas'); break;
   case 'checklist_changed': out.act = ['logActChecklist']; if (d.title) out.to = text(`${d.done ? '✓ ' : ''}${d.title}`); break;
   case 'label_changed': out.act = ['logActLabels']; break;
   case 'assignee_changed': out.act = ['logActAssignees']; if (nameOf(d.person_id)) out.to = text(nameOf(d.person_id)); break;
   case 'creative_added': out.act = ['logActDesign']; if (d.name) out.to = text(d.name); break;
   case 'version_added': out.act = ['logActVersion']; break;
   case 'approval_approved': out.act = ['logActApproved']; if (d.step) out.to = text(d.step); break;
   case 'approval_rejected': out.act = ['logActRejected']; if (d.step) out.to = text(d.step); if (d.reason) out.note = String(d.reason); break;
   case 'approval_skipped': out.act = ['logActSkipped']; if (d.step) out.to = text(d.step); break;
   case 'card_changed': {
    const field = String(d.field);
    if (field === 'stage_id') { out.act = ['logActMoved']; if (d.old_name) out.from = text(d.old_name); if (d.new_name) out.to = text(d.new_name); }
    else if (field === 'next_actor') { out.act = ['logActHandedOver']; if (nameOf(d.old)) out.from = text(nameOf(d.old)); out.to = nameOf(d.new) ? text(nameOf(d.new)) : undefined; }
    else if (field === 'project_id') { out.act = ['logActChanged', { key: 'logProject' }]; if (d.old_name) out.from = text(d.old_name); out.to = d.new_name ? text(d.new_name) : key('logNone'); }
    else if (fieldKeys[field]) {
     out.act = ['logActChanged', { key: fieldKeys[field] }];
     if (!unquoted.has(field)) { if (d.old != null && d.old !== '') out.from = text(d.old); if (d.new != null && d.new !== '') out.to = text(d.new); }
    } else out.act = ['logActCardOther'];
    break;
   }
   default: out.act = ['logActCardOther'];
  }
  return out;
 }
 if (row.subject === 'member') {
  const person = (typeof d.person_name === 'string' && d.person_name) || nameOf(row.person_id);
  if (person) out.obj = person;
  const role = value => typeof value === 'string' && roleKeys.has(value) ? key(value) : undefined;
  switch (row.action) {
   case 'member_added': out.act = [d.agent_role ? 'logActAgentJoined' : 'logActMemberAdded']; out.to = role(d.new_role); break;
   case 'member_removed': out.act = ['logActMemberRemoved']; break;
   case 'member_invited':
    out.act = ['logActMemberInvited'];
    if (typeof d.email === 'string') out.obj = d.email;
    if (typeof d.role === 'string' && Object.hasOwn(invitedKeys, d.role)) out.to = key(invitedKeys[d.role]);
    break;
   case 'agent_granted': out.act = ['logActAgentGranted']; break;
   case 'agent_revoked': out.act = ['logActAgentRevoked']; break;
   case 'member_changed':
    if (d.old_role && d.new_role && d.old_role !== d.new_role) { out.act = ['logActMemberRole']; out.from = role(d.old_role); out.to = role(d.new_role); }
    else out.act = ['logActMemberChanged'];
    break;
   default: out.act = ['logActMemberChanged'];
  }
  return out;
 }
 if (row.subject === 'company') {
  // A rename (design-reference: co-name-save) shows the old name and the new one. A change of the Agent level, made by a
  // version before ADR 0018 removed levels, stays in the log and still reads by the level's name.
  if (row.action === 'agent_level_changed') {
   out.act = ['logActAgentLevel'];
   const level = value => [1, 2, 3].includes(Number(value)) ? key(`agentLevel${Number(value)}`) : undefined;
   out.from = level(d.old_level); out.to = level(d.new_level);
   return out;
  }
  // An app (#30; design-reference: appConnect's log line) connected or disconnected for one Agent, named as it was
  // called then, or for the whole Company before apps were per Agent; or a model subscription (#123).
  const connected = { app_connected: true, app_disconnected: false, subscription_connected: true, subscription_disconnected: false }[row.action];
  if (typeof connected === 'boolean') {
   out.act = typeof d.agent_name === 'string' && d.agent_name ? [connected ? 'logActAppConnectedFor' : 'logActAppDisconnectedFor', text(d.agent_name)]
    : [connected ? 'logActAppConnected' : 'logActAppDisconnected'];
   if (typeof d.app === 'string') out.obj = appByKey(d.app)?.name || short(d.app);
   if (typeof d.provider === 'string') out.obj = Object.hasOwn(subscriptionNames, d.provider) ? subscriptionNames[d.provider] : short(d.provider);
   [out.from, out.to] = connected ? [key('logAppOff'), key('logAppOn')] : [key('logAppOn'), key('logAppOff')];
   return out;
  }
  // A Company's API key for a model provider (#124), named by the provider and never by the key.
  if (row.action === 'provider_key_set' || row.action === 'provider_key_removed') {
   out.act = [row.action === 'provider_key_set' ? 'logActProviderKeySet' : 'logActProviderKeyRemoved'];
   if (typeof d.provider === 'string') out.obj = short(d.provider);
   return out;
  }
  // The Engine went on with a request on the next account of the same kind, in the Owner's order (#621): gtmworks is the
  // row's actor, the kind is the object, and the two accounts read under the names they had then. Never a credential.
  if (row.action === 'provider_switched') {
   out.act = ['logActProviderSwitched'];
   if (typeof d.provider === 'string') out.obj = Object.hasOwn(subscriptionNames, d.provider) ? subscriptionNames[d.provider] : short(d.provider);
   if (typeof d.from_name === 'string') out.from = text(d.from_name);
   if (typeof d.to_name === 'string') out.to = text(d.to_name);
   return out;
  }
  // An edit of the Company knowledge (#27) names the part by its title, and says when it was cleared.
  if (row.action === 'company_knowledge_changed') {
   const title = knowledgeParts.find(([part]) => part === d.part)?.[1];
   out.act = [d.cleared === true ? 'logActCompanyKnowledgeCleared' : 'logActCompanyKnowledge', ...(title ? [key(title)] : [])];
   return out;
  }
  // A team channel archived or restored (#675; design-reference-card: cvArchive, cvRestore): the channel is the object,
  // from where it was to Archived and back. Only that channel's Members read the row.
  if (row.action === 'channel_archived' || row.action === 'channel_restored') {
   const archived = row.action === 'channel_archived';
   out.act = [archived ? 'logActChannelArchived' : 'logActChannelRestored'];
   if (typeof d.channel === 'string' && d.channel) out.obj = `#${short(d.channel)}`;
   if (archived) out.to = key('logArchive'); else out.from = key('logArchive');
   return out;
  }
  out.act = [row.action === 'company_renamed' ? 'logActCompanyRenamed' : 'logActOther'];
  if (typeof d.old_name === 'string') out.from = text(d.old_name);
  if (typeof d.new_name === 'string') out.to = text(d.new_name);
  return out;
 }
 if (row.subject === 'agent') {
  // A job an Agent handed another inside a channel (#150): the Agent it went to is named, and the job is what it went to.
  if (row.action === 'agent_handed_to') {
   const to = (typeof d.to_name === 'string' && d.to_name) || (row.agent_id && names.agentName?.(row.agent_id));
   if (!to) { out.act = ['logActAgentChanged']; return out; }
   out.act = ['logActHandedTo', text(to)];
   if (typeof d.goal === 'string') out.to = text(d.goal);
   return out;
  }
  // A lasting rule told to an Agent (#18), removed, and brought back (#28): the rule is the object and the Agent is
  // named in the act; a rule in force again says so.
  const ruleActs = { agent_rule_saved: 'logActRuleSaved', agent_rule_removed: 'logActRuleRemoved', agent_rule_restored: 'logActRuleRestored' };
  if (Object.hasOwn(ruleActs, row.action)) {
   out.act = [ruleActs[row.action], text(agent || '')];
   if (typeof d.rule === 'string') out.obj = short(d.rule);
   if (row.action !== 'agent_rule_removed') out.to = key('logRuleInEffect');
   return out;
  }
  // The Agent's memory cleared by the Owner (#350): the Agent is named in the act, and no note of it ever is.
  // A change the Engine's answer never confirmed is logged by the worker's pass (#370): it reads as asked for, not as
  // done, and says it is not confirmed.
  const unconfirmed = d.unconfirmed === true ? key('logUnconfirmed') : undefined;
  const asked = act => unconfirmed ? `${act}Asked` : act;
  if (row.action === 'memory_reset') {
   out.act = [asked('logActMemoryReset'), text(agent || '')];
   if (unconfirmed) out.to = unconfirmed;
   return out;
  }
  // One note edited, or forgotten by the Owner (#191): the Agent is named, and no note of it ever is.
  const noteAct = { memory_edit: 'logActMemoryEdit', memory_forget: 'logActMemoryForget' }[row.action];
  if (noteAct) {
   out.act = [asked(noteAct), text(agent || '')];
   if (unconfirmed) out.to = unconfirmed;
   return out;
  }
  // A Routine of an Agent made, rescheduled, paused, turned back on, run now or deleted in Settings (#31): the Agent is
  // named in the act and the Routine is the object.
  const routineAct = { routine_created: 'logActRoutineCreated', routine_changed: 'logActRoutineChanged', routine_paused: 'logActRoutinePaused', routine_resumed: 'logActRoutineResumed', routine_run: 'logActRoutineRun', routine_deleted: 'logActRoutineDeleted' }[row.action];
  if (routineAct) {
   out.act = [routineAct, text(agent || '')];
   if (typeof d.routine === 'string') out.obj = short(d.routine);
   return out;
  }
  // A skill written into an Agent's profile in the Engine, or switched for it (review of #340): the skill is the object.
  const skillAct = { skill_written: 'logActSkillWritten', skill_enabled: 'logActSkillEnabled', skill_disabled: 'logActSkillDisabled' }[row.action];
  if (skillAct) {
   out.act = [asked(skillAct), text(agent || '')];
   if (typeof d.skill === 'string') out.obj = short(d.skill);
   if (unconfirmed) out.to = unconfirmed;
   return out;
  }
  // A field saved from the Agent's page (#161, #176): the Agent is named in the act and the field is what changed. The
  // row keeps no text, so it reads "Edited"; a field whose words this version does not know reads as a change to the Agent.
  const settingField = typeof d.field === 'string' && Object.hasOwn(settingFields, d.field) ? settingFields[d.field] : null;
  if (row.action === 'agent_setting_changed' && settingField) {
   out.act = ['logActSettingChanged', key(settingField), text(agent || '')];
   if (d.field === 'about' || d.field === 'instructions') out.to = key('logEdited');
   // Good morning (#182): the time before and after, or Off.
   if (d.field === 'morning') { out.from = morningValue(d.old); out.to = morningValue(d.new); }
   return out;
  }
  // A setting on the Agent's Engine profile changed (#125): named by its label, with the value before and after. A key
  // this version no longer lists still reads as a setting, never as its raw config name.
  if (row.action === 'agent_setting_changed' && typeof d.setting === 'string') {
   out.act = ['logActSettingChanged', { key: settingLabelKey(d.setting) }, text(agent || '')];
   out.from = d.old === true ? key('logOn') : d.old === false ? key('logOff') : d.old == null ? key('logNone') : text(d.old);
   out.to = d.new === true ? key('logOn') : d.new === false ? key('logOff') : d.new == null ? key('logNone') : text(d.new);
   return out;
  }
  // A Contributor's rule suggested for the team (#25), and an Owner's or a Manager's decision on it, naming who taught it.
  const suggestion = { agent_rule_suggested: ['logActRuleSuggested', 'logRuleWaiting'], agent_rule_approved: ['logActRuleApproved', 'logRuleTeamWide'], agent_rule_rejected: ['logActRuleRejected', 'logRuleOwnWork'] }[row.action];
  if (suggestion) {
   out.act = [suggestion[0], text(agent || ''), text(typeof d.taught_by === 'string' ? d.taught_by : '')];
   if (typeof d.rule === 'string') out.obj = short(d.rule);
   out.to = key(suggestion[1]);
   return out;
  }
  // A change proposed to an Agent's settings (#19; design-reference: the log's "proposed a change to its settings"): the
  // Agent that proposed it, then the Owner's answer, each naming the setting and the value after it (never instructions).
  const changeAct = { agent_change_proposed: 'logActChangeProposed', agent_change_approved: 'logActChangeApproved', agent_change_declined: 'logActChangeDeclined' }[row.action];
  if (changeAct) {
   const what = d.setting === 'instructions' ? 'logFieldInstructions' : d.setting === 'delegation' ? 'logChangeSubagents' : settingLabelKey(d.setting);
   out.act = [changeAct, key(what), text(agent || '')];
   const value = d.new === true ? key('logOn') : d.new === false ? key('logOff') : typeof d.new === 'string' || typeof d.new === 'number' ? text(d.new) : undefined;
   if (row.action === 'agent_change_proposed') { out.from = value; out.to = key('logChangeWaiting'); }
   else if (row.action === 'agent_change_approved') { out.from = key('logChangeProposal'); out.to = value ?? key('logChangeApplied'); }
   else { out.from = key('logChangeProposal'); out.to = typeof d.reason === 'string' ? text(d.reason) : key('logChangeNothing'); }
   return out;
  }
  const asker = typeof d.asked_by === 'string' ? d.asked_by : '';
  if (row.action === 'agent_request_sent') {
   out.act = ['logActAgentRequestSent', text(agent || '')]; out.to = key('logAgentRequestWaiting');
   if (typeof d.asked_for === 'string') out.obj = short(d.asked_for);
   return out;
  }
  if (row.action === 'agent_request_made' || row.action === 'agent_request_declined') {
   const made = row.action === 'agent_request_made';
   out.act = [made ? 'logActAgentRequestMade' : 'logActAgentRequestDeclined', text(asker)];
   out.obj = made ? agent : typeof d.asked_for === 'string' ? short(d.asked_for) : undefined;
   out.from = key('logAgentRequest');
   out.to = made ? { key: 'logAgentShowsFor', values: [asker] } : typeof d.reason === 'string' ? text(d.reason) : undefined;
   return out;
  }
  // A Member's request for an Agent hidden from them (#167), answered: opened for them, which they now see, or kept hidden.
  if (row.action === 'agent_opened_for' || row.action === 'agent_kept_hidden') {
   const opened = row.action === 'agent_opened_for';
   out.act = [opened ? 'logActAgentOpenedFor' : 'logActAgentKeptHidden', text(asker)];
   out.obj = agent;
   out.from = key('logAgentAccessRequest');
   out.to = opened ? { key: 'logAgentShowsFor', values: [asker] } : key('logAgentStaysHidden');
   return out;
  }
  if (agent) out.obj = agent;
  out.act = [({ agent_added: 'logActAgentAdded', agent_made_main: 'logActAgentMain', agent_removed: 'logActAgentRemoved', agent_provided: 'logActAgentProvided', agent_own_profile: 'logActAgentOwnProfile', agent_own_space: 'logActAgentOwnSpace', agent_requested: 'logActAgentRequested' })[row.action] || 'logActAgentChanged'];
  if (row.action === 'agent_requested' && typeof d.job === 'string') out.to = text(d.job);
 }
 return out;
}

// A note stays open to its writer's edits for its first five minutes; the database locks it then (edit_card_note).
export const noteEditWindow = 5 * 60 * 1000;
/** A comment's activity row keeps the text as first written; show the note as it now stands (#22). */
export function currentNoteText(rows, comments) {
 const bodies = new Map(comments.map(comment => [comment.id, comment.body]));
 return rows.map(row => row.action === 'comment_added' && bodies.has(Number(row.details?.id)) ? { ...row, details: { ...row.details, body: bodies.get(Number(row.details.id)) } } : row);
}
// The moment a page is drawn: each open note on it counts its time left down from there, on the server and in the
// browser alike, until the browser's own clock takes over (app/note-edit).
export const drawnAt = () => Date.now();

// The "who" filter: everyone, one person (p:<id>), one Agent (a:<id>, the Agent that acted or the Agent the row is
// about) or gtmworks itself (s). Anything else is everyone.
export function parseWho(value) {
 if (typeof value !== 'string') return { kind: 'all' };
 if (value === 's') return { kind: 'system' };
 const match = /^([pa]):([0-9a-f-]{36})$/i.exec(value);
 return match ? { kind: match[1] === 'p' ? 'person' : 'agent', id: match[2].toLowerCase() } : { kind: 'all' };
}
export function parseCard(value) {
 return typeof value === 'string' && /^[1-9]\d{0,17}$/.test(value) ? Number(value) : null;
}
// A page of the Activity log: enough for a seeded Company's whole log, as the approved screen shows it, and small
// enough that the page appears within the navigation budget (#56); older rows are a click away.
export const logPageSize = 50;

// What the Activity log says when no row is shown, read from the Company's whole log (every row, before any filter):
// a log with rows says nothing matches the filters and offers everything back; an empty log says it is empty.
export function logEmptyNote({ companyRows }) {
  return companyRows > 0 ? 'noMatch' : 'empty';
}

// Older rows are reached by a cursor in the log's own order (created_at, then id, both newest first): the time and id
// of the last row shown. Rows written meanwhile never shift a page, and rows of the same moment are split by id.
/** @param {{created_at:string,id:number}} row */
export const logCursor = row => `${row.created_at}~${row.id}`;
export function parseBefore(value) {
 if (typeof value !== 'string') return null;
 // A '+' in an address reads back as a space.
 const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))~([1-9]\d{0,17})$/.exec(value.replace(' ', '+'));
 return match && !Number.isNaN(Date.parse(match[1])) ? { at: match[1], id: match[2] } : null;
}
/** @param {{actor_kind:string,actor_id:string|null,agent_id?:string|null,card_id?:number|null}} row */
export function matchesFilters(row, who, card) {
 if (card != null && row.card_id !== card) return false;
 if (who.kind === 'system') return row.actor_kind === 'system';
 if (who.kind === 'person') return row.actor_kind === 'person' && row.actor_id === who.id;
 if (who.kind === 'agent') return (row.actor_kind === 'agent' && row.actor_id === who.id) || row.agent_id === who.id;
 return true;
}

// Building a date formatter costs far more than using one, and the log formats a day and a time for each of up to 300
// rows while its page opens: each formatter is built once per locale, options and zone, then reused.
const formatters = new Map();
/** @param {string} locale @param {Intl.DateTimeFormatOptions} options */
export function dateFormatter(locale, options) {
 // With no zone given the runtime's own zone applies, read now, so a device that changes zone gets a new formatter.
 const zone = options.timeZone ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
 const key = `${locale}|${zone}|${JSON.stringify({ ...options, timeZone: undefined })}`;
 let formatter = formatters.get(key);
 if (!formatter) formatters.set(key, formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }));
 return formatter;
}

// A row's day in the reader's time zone (undefined: the runtime's own), as YYYY-MM-DD.
export function dayOf(iso, timeZone) {
 const parts = dateFormatter('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).formatToParts(new Date(iso));
 const get = type => parts.find(part => part.type === type)?.value;
 return `${get('year')}-${get('month')}-${get('day')}`;
}
// Days back from today (0 today, 1 yesterday) between two YYYY-MM-DD days.
export function daysBack(day, today) {
 return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000);
}
/** Rows grouped by day, newest day first and newest row first inside a day. */
export function groupByDay(rows, timeZone) {
 const groups = new Map();
 for (const row of [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)) {
  const day = dayOf(row.created_at, timeZone);
  if (!groups.has(day)) groups.set(day, []);
  groups.get(day).push(row);
 }
 return [...groups].map(([day, items]) => ({ day, items }));
}
