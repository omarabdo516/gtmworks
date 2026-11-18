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

// A Viewer sees only their account and the Agents they work with (reference: sovSecs); Usage is for the Owner and the
// Managers (#32), as the reference's canManage() draws it.
export const visibleSections = role => overlaySections.filter(([key, , , company]) => key === 'usage' ? role === 'owner' || role === 'manager' : !company || role !== 'viewer');

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
