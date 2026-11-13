// The Numbers page (#35, design-reference: renderDashboard). Its four figures (spend, leads, cost per lead, revenue)
// come only from the Company's connected apps: each figure names the apps it was read from and its period, and a
// figure no connected app reports is unavailable, never estimated. The reference's own figures are demo data.
//
// What a connected app can really supply, figure by figure (the builder's list, #35):
// - Spend, leads per day and per channel: an ads app (Meta Ads, Google Ads) reports spend and leads per campaign/day.
// - Cost per lead: spend ÷ leads, only where the same apps report both for the same period.
// - Revenue and sales: an analytics or sales source (GA4 e-commerce, a CRM or the team's sheet); the reference's
//   "course price × sales" is a demo shortcut and is not built.
// - ROAS: revenue ÷ spend, only where both are read for the same period.
// - "Waiting for your approval" and "What the agents did this week" are gtmworks's own records (the approval queue
//   and the Company's log), not app figures, and are always real.

export const periods = ['7', '30'];
export const parsePeriod = value => (periods.includes(value) ? value : '7');
export const figureKeys = [['spend', 'numbersSpend'], ['leads', 'numbersLeads'], ['costPerLead', 'numbersCostPerLead'], ['revenue', 'numbersRevenue']];
const money = new Set(['spend', 'costPerLead', 'revenue']);

/**
 * The four tiles from the connected apps' readings for one period. A reading is one app's figures for a period:
 * {app:'Meta Ads', period:'7', spend?:number, leads?:number, revenue?:number, currency?:'EGP'}.
 * A tile's value is null when no connected app reports it for that period.
 */
export function numbersTiles(readings, period) {
 const current = (readings || []).filter(reading => reading && reading.period === period && typeof reading.app === 'string');
 const tiles = {};
 for (const name of ['spend', 'leads', 'revenue']) {
  const reported = current.filter(reading => Number.isFinite(reading[name]));
  tiles[name] = { value: reported.length ? reported.reduce((total, reading) => total + reading[name], 0) : null, sources: reported.map(reading => reading.app) };
 }
 // Cost per lead only from apps that report both spend and leads for the period.
 const both = current.filter(reading => Number.isFinite(reading.spend) && Number.isFinite(reading.leads));
 const spend = both.reduce((sumSpend, reading) => sumSpend + reading.spend, 0), leads = both.reduce((sumLeads, reading) => sumLeads + reading.leads, 0);
 tiles.costPerLead = { value: both.length && leads > 0 ? spend / leads : null, sources: both.map(reading => reading.app) };
 const currency = current.find(reading => typeof reading.currency === 'string')?.currency || null;
 return {
  connected: current.length > 0,
  tiles: figureKeys.map(([name, label]) => ({ name, label, value: tiles[name].value, sources: [...new Set(tiles[name].sources)], period, money: money.has(name), currency: money.has(name) ? currency : null })),
 };
}

/** A tile's value in the interface language: whole numbers for counts and money, one decimal for cost per lead. */
export function formatFigure(tile, locale) {
 if (tile.value == null) return null;
 const digits = tile.name === 'costPerLead' ? 1 : 0;
 return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(tile.value);
}
