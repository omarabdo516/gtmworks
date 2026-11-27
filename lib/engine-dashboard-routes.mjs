import { posix } from 'node:path';

// How the Owner's Engine dashboard's requests are read by route (#871, #873, spec #866): the refusals
// (lib/engine-dashboard-refusals.mjs) and the Activity log's kinds of change (lib/engine-dashboard-activity.mjs) each keep
// a table of a method, a route pattern and what it means, and read a request the same way, as the Engine's router does.

/**
 * The route a dashboard path names, as the Engine's router matches it: each escape read once (as the server reads the
 * path before routing), its dot segments resolved, doubled and trailing slashes dropped, in lower case.
 * @param {string} path the path under the dashboard's prefix, its query left on or not
 */
export function routeOf(path) {
 const decoded=path.split('?')[0].replace(/%([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(Number.parseInt(hex,16)));
 return (posix.normalize(`/${decoded}`).replace(/\/+$/,'')||'/').toLowerCase();
}

/**
 * What the first row of a table whose method and pattern match a request means, or null.
 * @template T @param {[string,RegExp,T][]} table @param {string} method a method in upper case @param {string} route a route as routeOf reads it
 * @returns {T|null}
 */
export const firstMatch=(table,method,route)=>table.find(([verb,pattern])=>verb===method&&pattern.test(route))?.[2]??null;
