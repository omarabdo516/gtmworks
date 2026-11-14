// The settings overlay (design-reference/app.js, SOV_SECS): its sections in order, who sees which, and the address of
// each state. The overlay is route-backed: /c/<slug>/settings opens it on its first section and
// ?section=<key>[&agent=<id>] opens a section or one Agent's page, so every state has an address a test or a link can open.

// [key, message key, icon, belongs to the company (hidden from a Viewer), belongs to "You"]
export const overlaySections = [
  ['company', 'settingsCompany', 'building', true, false],
  ['agents', 'agents', 'bot', false, false],
  ['knowledge', 'settingsKnowledge', 'book', true, false],
  ['learning', 'settingsLearning', 'bulb', true, false],
  ['models', 'settingsModels', 'cpu', true, false],
  ['apps', 'settingsApps', 'plug', true, false],
  ['routines', 'settingsRoutines', 'repeat', true, false],
  ['usage', 'usage', 'gauge', true, false],
  ['backup', 'settingsBackup', 'archive', true, false],
  ['account', 'settingsAccount', 'user', false, true],
];

// A Viewer sees only their account and the Agents they work with (reference: sovSecs).
export const visibleSections = role => overlaySections.filter(([, , , company]) => !company || role !== 'viewer');

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

// Token use of one company over the last `days` days (UTC days, counting today), from usage_by_day rows.
export function usageTotals(rows, company, days, today = new Date()) {
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const start = end - (days - 1) * 86400000;
  const totals = { tokens: 0, runs: 0, unknown: 0 };
  for (const row of rows) {
    if (row.company_id !== company) continue;
    const day = Date.parse(`${row.day}T00:00:00Z`);
    if (!(day >= start && day <= end)) continue;
    totals.tokens += Number(row.input_tokens || 0) + Number(row.output_tokens || 0);
    totals.runs += Number(row.runs || 0);
    totals.unknown += Number(row.unknown_runs || 0);
  }
  return totals;
}
