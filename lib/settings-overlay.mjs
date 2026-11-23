import { searchFold } from './arabic-search.mjs';

// The settings overlay (design-reference/app.js, SOV_SECS): its sections in order, who sees which, and the address of
// each state. The overlay is route-backed: /c/<slug>/settings opens it on its first section and
// ?section=<key>[&agent=<id>] opens a section or one Agent's page, so every state has an address a test or a link can open.

// [key, message key, icon, belongs to the company (hidden from a Viewer), its sidebar group (#612), the Owner's alone]
// The order is the sidebar's, group by group: Company, Agents and Engine, then the pages that stand on their own.
export const overlaySections = [
  ['company', 'settingsCompany', 'building', true, 'company'],
  ['members', 'members', 'team', true, 'company'],
  ['knowledge', 'settingsKnowledge', 'book', true, 'company'],
  ['agents', 'agents', 'bot', false, 'agents'],
  ['learning', 'settingsLearning', 'bulb', true, 'agents'],
  ['routines', 'settingsRoutines', 'repeat', true, 'agents'],
  ['apps', 'settingsApps', 'plug', true, 'agents'],
  ['models', 'settingsModels', 'cpu', true, 'engine'],
  ['usage', 'usage', 'gauge', true, 'engine'],
  ['backup', 'settingsBackup', 'archive', true, null, true],
  ['account', 'settingsAccount', 'user', false, null],
  // The installed version, its What's new and its licenses (#616): everyone's, as the version is no Role's secret.
  ['about', 'settingsAboutApp', 'info', false, null],
];

// Each group's label; a page with no group stands on its own and has none.
const groupLabels = { company: 'settingsCompany', agents: 'agents', engine: 'settingsGroupEngine' };

// A Viewer sees only the Agents they work with, their account and About (reference: sovSecs); Usage is for the Owner and
// the Managers (#32), as the reference's canManage() draws it; Backup is the Owner's alone (#33).
export const visibleSections = role => overlaySections.filter(([key, , , company, , ownerOnly]) => key === 'usage' ? role === 'owner' || role === 'manager' : (!company || role !== 'viewer') && (!ownerOnly || role === 'owner'));

// The sidebar's groups for one person, in order, each with the pages they may open; a group with none is left out.
export function overlayGroups(role) {
  const groups = [];
  for (const section of visibleSections(role)) {
    const group = section[4];
    const last = groups.at(-1);
    if (last && last.group === group) last.sections.push(section);
    else groups.push({ group, label: group ? groupLabels[group] : null, sections: [section] });
  }
  return groups;
}

// The group a page sits in, for the breadcrumb (Settings › group › page); null for a page on its own.
export function sectionGroup(key) {
  const group = overlaySections.find(([name]) => name === key)?.[4];
  return group ? { group, label: groupLabels[group] } : null;
}

// Finding a setting by name (#613): the sidebar's groups for this Role (overlayGroups) with only the pages whose name, as
// the interface language gives it (`t`), holds the words typed, compared as lib/arabic-search.mjs reads them. A group
// whose own name holds them keeps all its pages ("Engine" finds Subscription and models, and Usage), and a group left
// with none is left out. A page the Role may not open is never among them, so a search cannot tell it exists; an empty
// search is every group the Role sees.
export function findGroups(query, role, t) {
  const wanted = searchFold(query ?? '');
  const groups = overlayGroups(role);
  if (!wanted) return groups;
  const holds = label => searchFold(t(label)).includes(wanted);
  return groups.map(group => ({ ...group, sections: group.label && holds(group.label) ? group.sections : group.sections.filter(([, label]) => holds(label)) }))
    .filter(group => group.sections.length);
}

// The pages a search finds, in the sidebar's order.
export const findSections = (query, role, t) => findGroups(query, role, t).flatMap(group => group.sections);

// The section a request opens: the one asked for when this person may see it, else their first one.
export function pickSection(requested, role) {
  const list = visibleSections(role);
  return list.find(([key]) => key === requested)?.[0] ?? list[0][0];
}

// The address of one overlay state. The first section of a role is the bare /settings address.
export function overlayHref(slug, section, extra = {}) {
  const query = new URLSearchParams();
  // One Agent's page is ?agent=<id> alone: an address with one parameter survives being passed through a shell.
  if (section !== 'company' && !(section === 'agents' && extra.agent)) query.set('section', section);
  for (const [name, value] of Object.entries(extra)) if (value) query.set(name, value);
  const text = query.toString();
  return `/c/${slug}/settings${text ? `?${text}` : ''}`;
}

// "Open company knowledge" in an Agent's memory (#192): the Company knowledge section of Settings for everyone who may
// see it, and nothing for a Viewer, whom visibleSections keeps out of the Company's sections.
export function companyKnowledgeHref(slug, role) {
  return visibleSections(role).some(([key]) => key === 'knowledge') ? overlayHref(slug, 'knowledge') : undefined;
}

// The tab an Agent's page opens (#193): Settings is the page's own address, and Memory is the same address with
// `tab=memory`, so a link, a test or a reload reaches the same tab.
export const agentTab = value => value === 'memory' ? 'memory' : 'settings';

// The element the page gives the focus to once it is drawn: the open tab, as the reference's sov-agent does.
export const agentTabFocus = tab => tab === 'memory' ? 'sov-tab-memory' : 'sov-tab-settings';

// Closing returns to the page the overlay was opened from, when that is a page of the same company other than the
// overlay itself; otherwise to the Conversation with the main Agent.
export function closeTarget(stored, slug) {
  const home = `/c/${slug}/chat`;
  if (typeof stored !== 'string' || !stored.startsWith(`/c/${slug}/`) || stored.startsWith('//') || stored.includes('\\')) return home;
  const path = stored.split(/[?#]/)[0];
  return path === `/c/${slug}/settings` ? home : stored;
}

// The main Agent first, then the others in the order given (the sidebar's order, lib/sidebar.mjs).
export const agentsMainFirst = agents => [...agents.filter(agent => agent.is_default), ...agents.filter(agent => !agent.is_default)];

// The Agent whose memory the Company knowledge card opens (#193): the first Agent the reader sees that is not the main
// one, else the main Agent; none when the reader sees no Agent.
export const memoryAgent = agents => agents.find(agent => !agent.is_default) ?? agents[0] ?? null;

// Token use of one company in the period read (#347), from its rows of managedUsage: the tokens and sessions Hermes
// counted, and how many profiles it could not be asked about.
export function usageTotals(rows, company) {
  const totals = { tokens: 0, sessions: 0, unknown: 0 };
  for (const row of rows) {
    if (row.company_id !== company) continue;
    if (row.input === null || row.output === null || row.sessions === null) { totals.unknown += 1; continue; }
    totals.tokens += row.input + row.output;
    totals.sessions += row.sessions;
  }
  return totals;
}

// The models one company's Agents ran on in the period (#32), each model's own counts added across the profiles that
// used it, tokens first. Hermes merges auxiliary usage into these rows, so this table stands alone and is never summed
// into usageTotals above.
export function usageModels(rows, company) {
  const byModel = new Map();
  for (const row of rows) {
    if (row.company_id !== company || !row.models) continue;
    for (const model of row.models) {
      const seen = byModel.get(model.model) ?? { model: model.model, input: 0, output: 0, sessions: 0 };
      seen.input += model.input;
      seen.output += model.output;
      seen.sessions += model.sessions;
      byModel.set(model.model, seen);
    }
  }
  return [...byModel.values()].sort((a, b) => (b.input + b.output) - (a.input + a.output) || a.model.localeCompare(b.model));
}

// The Agent whose profile used the most tokens of one company in the period; null when Hermes answered for none of its
// profiles.
export function usageHeaviest(rows, company) {
  const counted = rows.filter(row => row.company_id === company && row.input !== null && row.output !== null);
  return counted.reduce((top, row) => !top || row.input + row.output > top.input + top.output ? row : top, null);
}

// Whether the period holds nothing to show: no tokens, sessions or per-model rows, and no profile Hermes could not be
// asked about, whose unknown usage is worth showing (#32, the empty period).
export function usageEmpty(rows) {
  return !rows.some(row =>
    (row.input !== null && row.output !== null && row.sessions !== null && row.input + row.output + row.sessions > 0)
    || (row.models ?? []).some(model => model.input + model.output + model.sessions > 0)
    || row.input === null);
}

// When the overlay's reads started (#661): a setting saved after this time stays on the page as saved
// (app/settings-saved.ts), so a save never reads the whole window again.
export const pageReadAt=()=>Date.now();
