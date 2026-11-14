// The Company's one log (#11), as the Activity log page and the Numbers page read it (design-reference: entryHTML,
// logGroupsHTML, renderLogPage). Pure helpers: what a row says, which filter it matches, and its day.

const fieldKeys = { title: 'title', offering: 'offering', segment: 'segment', hook: 'hook', channel: 'channel', format: 'format', go_live: 'publishingDate', goal: 'goal', caption: 'caption', next_actor: 'nextActor', project_id: 'logProject' };
// Long or free-form values are named, not quoted, in a log line.
const unquoted = new Set(['caption', 'go_live']);
const short = value => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > 80 ? `${text.slice(0, 79)}…` : text; };
const roleKeys = new Set(['owner', 'manager', 'contributor', 'viewer']);

/**
 * What one log row says: its act (a message key with values), the object it names, a change from → to and a note.
 * A value is either authored text ({text}) or a catalogue key ({key}).
 * @param {{action:string,subject:string,details?:Record<string,unknown>|null,body?:string|null,person_id?:string|null,agent_id?:string|null}} row
 * @param {{name?:(id:string)=>string|undefined,agentName?:(id:string)=>string|undefined}} [names]
 */
export function describeEntry(row, names = {}) {
 const d = row.details || {};
 const nameOf = id => (typeof id === 'string' && names.name?.(id)) || undefined;
 const text = value => ({ text: short(value) });
 const key = value => ({ key: value });
 const out = { act: ['logActOther'], obj: undefined, from: undefined, to: undefined, note: undefined };
 if (row.subject === 'card') {
  switch (row.action) {
   case 'note': out.act = ['logActNote']; out.note = row.body || ''; break;
   case 'card_created': out.act = ['logActCardCreated']; break;
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
  // A rename (design-reference: co-name-save) shows the old name and the new one.
  out.act = [row.action === 'company_renamed' ? 'logActCompanyRenamed' : 'logActOther'];
  if (typeof d.old_name === 'string') out.from = text(d.old_name);
  if (typeof d.new_name === 'string') out.to = text(d.new_name);
  return out;
 }
 if (row.subject === 'agent') {
  const agent = (typeof d.agent_name === 'string' && d.agent_name) || (row.agent_id && names.agentName?.(row.agent_id)) || undefined;
  if (agent) out.obj = agent;
  out.act = [({ agent_added: 'logActAgentAdded', agent_made_main: 'logActAgentMain', agent_removed: 'logActAgentRemoved', agent_provided: 'logActAgentProvided' })[row.action] || 'logActAgentChanged'];
 }
 return out;
}

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

// A row's day in the reader's time zone (undefined: the runtime's own), as YYYY-MM-DD.
export function dayOf(iso, timeZone) {
 const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).formatToParts(new Date(iso));
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
