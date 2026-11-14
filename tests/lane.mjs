import { resolve } from 'node:path';

// The browser suite runs one lane per Playwright worker (#69). Every lane is a whole stack of its own: a local Supabase
// stack seeded exactly as supabase/seed.sql builds it (scripts/local-db.sh with LANE=n) and an app server with its
// worker on port 3000+n (scripts/web.sh). One lane's tests change its data only, so files that share the seeded people
// and companies run at the same time without seeing each other. Lane 0 is the stack every other script uses.
// GTMWORKS_TEST_LANES sets how many lanes run (default 1); each worker takes the lane of its parallel index.

export const lanes = Math.max(1, Number.parseInt(process.env.GTMWORKS_TEST_LANES || '1', 10) || 1);
export const lane = Number.parseInt(process.env.TEST_PARALLEL_INDEX || '0', 10) || 0;
/** The app's address for a lane. */
export const originOf = (n = lane) => `http://127.0.0.1:${3000 + n}`;
/** The Supabase project directory of a lane; lane 0 is the checkout itself. */
export const workdirOf = n => resolve(`supabase/.temp/lanes/${n}`);
/** The server log a lane's app writes, read by tests that check what reached the log. */
export const serverLogOf = (n = lane) => `playwright-report/server${n ? `-${n}` : ''}.log`;
/** The lane's database container and the script that puts its seeded data back (scripts/local-db.sh writes it). */
export const dbContainerOf = (n = lane) => `supabase_db_repo${n ? `-lane-${n}` : ''}`;
export const seedSnapshotOf = (n = lane) => resolve(`supabase/.temp/lanes/${n}/seed-data.sql`);
export const appOrigin = originOf();
// Supabase ports move by 100 per lane (54321 -> 54421 for lane 1), as local-db.sh writes them.
export const mail = `http://127.0.0.1:${54324 + 100 * lane}`;
export const inbox = `${mail}/api/v1/messages`;
// `npx supabase db query` and `supabase status` in the tests reach this lane's stack.
if (lane > 0) process.env.SUPABASE_WORKDIR = workdirOf(lane);
