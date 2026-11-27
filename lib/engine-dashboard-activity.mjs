import { firstMatch, routeOf } from './engine-dashboard-routes.mjs';

// What the Owner's dashboard writes to the Activity log (#873, spec #866). The Engine knows one identity for everyone who
// comes through the gate, so these lines are the only record of which Owner did what there:
// - a visit: the dashboard's first page loaded, at most one line per person and Company in thirty minutes (the database
//   keeps the window: log_engine_dashboard), so a reload or a return soon after is the same visit; moving between the
//   dashboard's own pages loads no page, and writes nothing;
// - each change request: the person, the dashboard's page and the kind of change, read from the method and the route
//   only (dashboardChange), and whether the Engine took it: one it answered with an error is a line that says it was not
//   taken. A read writes nothing;
// - each refused action, with which of the four it was (lib/engine-dashboard-refusals.mjs) and its page, when known.
// No line holds a key, a setting's value, a name from a body, a query or any part of a request's body: every value the
// line carries is one word of lib/engine-dashboard-words.mjs, and the database refuses any other.

/** @typedef {import('./engine-dashboard-words.mjs').DashboardPage} DashboardPage */
/** @typedef {import('./engine-dashboard-words.mjs').DashboardChangeKind} DashboardChangeKind */

// Each page by the start of its API routes (hermes_cli/web_routers on the pinned Engine), the first that matches.
/** @type {[RegExp,DashboardPage][]} */
const pageRoutes=[
 [/^\/api\/env(?:\/|$)/,'keys'],
 [/^\/api\/(?:config|ui-preferences|delegation|memory|curator|shared-metrics|tools)(?:\/|$)/,'config'],
 [/^\/api\/dashboard\/(?:theme|font)$/,'config'],
 [/^\/api\/plugins\/kanban(?:\/|$)/,'kanban'],
 [/^\/api\/(?:dashboard\/(?:agent-plugins|plugins|plugin-providers)|desktop-plugins|plugins)(?:\/|$)/,'plugins'],
 [/^\/api\/mcp(?:\/|$)/,'mcp'],
 [/^\/api\/messaging(?:\/|$)/,'channels'],
 [/^\/api\/webhooks(?:\/|$)/,'webhooks'],
 [/^\/api\/pairing(?:\/|$)/,'pairing'],
 [/^\/api\/cron(?:\/|$)/,'cron'],
 [/^\/api\/skills(?:\/|$)/,'skills'],
 [/^\/api\/(?:model|providers|credentials|local-models)(?:\/|$)/,'models'],
 [/^\/api\/profiles(?:\/|$)/,'profiles'],
 [/^\/api\/(?:files|fs)(?:\/|$)/,'files'],
 [/^\/api\/(?:ops|gateway|hermes|health)(?:\/|$)/,'system'],
 [/^\/api\/sessions(?:\/|$)/,'sessions'],
];
// The routes that ask with POST but change nothing: tickets for a socket or a download, checks and tests, diagnostics,
// an export, speech, and the chat's own uploads (the chat has no record in gtmworks, spec #866).
const readsByPost=[
 /\/(?:ws-ticket|socket-ticket|window-ticket|ticket|validate|test|export|pr-list)$/,
 /^\/api\/ops\/(?:doctor|dump|security-audit|prompt-size)$/,
 /^\/api\/(?:audio|chat|auth|webapp)(?:\/|$)/,
];
// The routes a POST adds one thing on.
const adds=/^\/api\/(?:mcp\/servers|webhooks|cron\/jobs|skills|credentials\/pool|providers\/custom-endpoints|plugins\/kanban\/tasks)$/;
/** @type {[string,RegExp,DashboardChangeKind][]} */
const kinds=[
 ['PUT',/^\/api\/env$/,'keySaved'],
 ['DELETE',/^\/api\/env$/,'keyRemoved'],
 ['POST',/^\/api\/dashboard\/agent-plugins\/install$/,'pluginInstalled'],
 ['PUT',/^\/api\/messaging\/platforms\/[^/]+$/,'platformSet'],
 ['POST',/^\/api\/messaging\/(?:[^/]+\/onboarding\/[^/]+\/apply|relay\/[^/]+\/link)$/,'platformConnected'],
 ['POST',/^\/api\/model\/set$/,'settingSaved'],
 ['POST',adds,'added'],
];

/**
 * The dashboard's page a request's route is on, or null when none is known.
 * @param {string} path the path under the dashboard's prefix, its query left on or not
 * @returns {DashboardPage|null}
 */
export const dashboardPage=path=>pageRoutes.find(([pattern])=>pattern.test(routeOf(path)))?.[1]??null;

/**
 * Whether a dashboard request is a change for the Activity log, and which: the page it is on and its kind; null for a
 * read, a page, a code file or anything that changes nothing.
 * @param {string} method @param {string} path the path under the dashboard's prefix, its query left on or not
 * @returns {{page:DashboardPage|null,change:DashboardChangeKind}|null}
 */
export function dashboardChange(method,path) {
 const asked=method.toUpperCase();
 if(!['POST','PUT','PATCH','DELETE'].includes(asked)) return null;
 const route=routeOf(path);
 if(!route.startsWith('/api/')) return null;
 if(asked==='POST'&&readsByPost.some(pattern=>pattern.test(route))) return null;
 const page=dashboardPage(route);
 const change=firstMatch(kinds,asked,route)??(asked==='DELETE'?'removed':asked==='POST'?'changed':'settingSaved');
 return {page,change};
}

/**
 * Writes one dashboard line to the Activity log as the person, with their own session (log_engine_dashboard asks that
 * they are an Owner of the Company). A line that cannot be written leaves the answer as it is.
 * @param {any} db the person's own client @param {string} company
 * @param {{act:'opened'}|{act:'changed'|'rejected',page:DashboardPage|null,change:DashboardChangeKind}|{act:'refused',page:DashboardPage|null,refused:import('./engine-dashboard-words.mjs').DashboardRefusalKind}} line
 */
export async function dashboardLogged(db,company,line) {
 const kind=line.act==='opened'?null:line.act==='refused'?line.refused:line.change;
 try {
  const {error}=await db.rpc('log_engine_dashboard',{c:company,act:line.act,page:line.act==='opened'?null:line.page,kind});
  if(error) console.error('engine dashboard activity not logged',error.message);
 } catch(error) { console.error('engine dashboard activity not logged',error instanceof Error?error.message:error); }
}
