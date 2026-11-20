import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The browser suite runs one lane per Playwright worker (#69). Every lane is a whole stack of its own: a local Supabase
// stack seeded exactly as supabase/seed.sql builds it (scripts/local-db.sh with LANE=n) and an app server with its
// worker on port 3000+n (scripts/web.sh). One lane's tests change its data only, so files that share the seeded people
// and companies run at the same time without seeing each other. Lane 0 is the stack every other script uses.
// GTMWORKS_TEST_LANES sets how many lanes run (default 1, at most maxLanes); each worker takes the lane of its parallel
// index. This file is also the one place that names the stack's ports (#225).

export const maxLanes = 7;
export const lanes = Math.max(1, Number.parseInt(process.env.GTMWORKS_TEST_LANES || '1', 10) || 1);
export const lane = Number.parseInt(process.env.TEST_PARALLEL_INDEX || '0', 10) || 0;
/** The app's address for a lane. */
export const originOf = (n = lane) => `http://127.0.0.1:${3000 + n}`;
/** The Supabase project directory of a lane; lane 0 is the checkout itself. */
export const workdirOf = n => resolve(`supabase/.temp/lanes/${n}`);
/** The server log a lane's app writes, read by tests that check what reached the log. */
export const serverLogOf = (n = lane) => `playwright-report/server${n ? `-${n}` : ''}.log`;
/** The lane's Supabase project id, which names its containers, volumes and network (scripts/local-db.sh writes it). */
export const projectOf = (n = lane) => `repo${n ? `-lane-${n}` : ''}`;
/** The lane's database container and the script that puts its seeded data back (scripts/local-db.sh writes it). */
export const dbContainerOf = (n = lane) => `supabase_db_${projectOf(n)}`;
export const seedSnapshotOf = (n = lane) => resolve(`supabase/.temp/lanes/${n}/seed-data.sql`);
export const appOrigin = originOf();
/** The bundled Hermes a lane's app and worker are given (scripts/web.sh, #342): a spec starts its fake Hermes there. */
export const hermesHostOf = (n = lane) => `127.0.0.${110 + n}`;
/** Where a lane's app reads the newest gtmworks (scripts/web.sh, #442): a spec starts its fake release source there. */
export const updateHostOf = (n = lane) => `127.0.0.${120 + n}`;

// Lane 0's ports by role, as supabase/config.toml sets them. The path is from the repository root: Playwright compiles
// this file to CommonJS, where import.meta does not exist.
const portKeys = {
 api: 'api.port', db: 'db.port', shadow: 'db.shadow_port', pooler: 'db.pooler.port', studio: 'studio.port',
 mail: 'local_smtp.port', analytics: 'analytics.port',
};
export function stackPortsOf(config) {
 const found = {};
 let section = '';
 for (const line of config.split('\n')) {
  section = line.match(/^\[([^\]]+)\]$/)?.[1] ?? section;
  const port = line.match(/^(port|shadow_port) = (\d+)$/);
  if (port) found[`${section}.${port[1]}`] = Number(port[2]);
 }
 return Object.fromEntries(Object.entries(portKeys).map(([role, key]) => {
  if (!(key in found)) throw new Error(`supabase/config.toml sets no ${key}`);
  return [role, found[key]];
 }));
}
export const stackPorts = stackPortsOf(readFileSync('supabase/config.toml', 'utf8'));
// Each lane moves every port by 100 (54321 -> 54421 for lane 1), as local-db.sh writes them.
export const portOf = (role, n = lane) => stackPorts[role] + 100 * n;
const ports = Object.values(stackPorts);
// Every port any lane's stack binds, for net.ipv4.ip_local_reserved_ports (scripts/ci-runner.mjs reserved-ports).
export const reservedPorts = `${Math.min(...ports)}-${Math.max(...ports) + 100 * (maxLanes - 1)}`;
export const mail = `http://127.0.0.1:${portOf('mail')}`;
export const inbox = `${mail}/api/v1/messages`;
// `npx supabase db query` and `supabase status` in the tests reach this lane's stack.
if (lane > 0) process.env.SUPABASE_WORKDIR = workdirOf(lane);
