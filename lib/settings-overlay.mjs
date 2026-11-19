// The settings overlay (design-reference/app.js, SOV_SECS): its sections in order, who sees which, and the address of
// each state. The overlay is route-backed: /c/<slug>/settings opens it on its first section and
// ?section=<key>[&agent=<id>] opens a section or one Agent's page, so every state has an address a test or a link can open.

// [key, message key, icon, belongs to the company (hidden from a Viewer), belongs to "You", the Owner's alone]
export const overlaySections = [
  ['company', 'settingsCompany', 'building', true, false],
  ['agents', 'agents', 'bot', false, false],
  ['knowledge', 'settingsKnowledge', 'book', true, false],
  ['learning', 'settingsLearning', 'bulb', true, false],
  ['models', 'settingsModels', 'cpu', true, false],
  ['apps', 'settingsApps', 'plug', true, false],
  ['routines', 'settingsRoutines', 'repeat', true, false],
  ['usage', 'usage', 'gauge', true, false],
  ['backup', 'settingsBackup', 'archive', true, false, true],
  ['account', 'settingsAccount', 'user', false, true],
];

// A Viewer sees only their account and the Agents they work with (reference: sovSecs); Backup is the Owner's alone.
export const visibleSections = role => overlaySections.filter(([, , , company, , ownerOnly]) => (!company || role !== 'viewer') && (!ownerOnly || role === 'owner'));

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

// Token use of one company in the period read (#347), from its rows of ownedUsage: the tokens and sessions Hermes
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
