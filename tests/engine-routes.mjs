import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Every route a fake Engine of a run was asked for (spec #831, #842): each fake (tests/fake-hermes.mjs) writes each
// method and path it is asked, once, to one file the run owns, by any process of the run (the runner's workers inherit
// it), and the Playwright configs' global teardown reads it at the end of the whole browser suite. A Card is archived,
// never deleted: the run fails when any fake was asked for the Engine's delete of a task (DELETE /tasks/{id}).
const logKey = 'GTMWORKS_ENGINE_ROUTES';

/** The run's log, made once by the process that starts the run. */
export function routesLog() {
  process.env[logKey] ||= join(mkdtempSync(join(tmpdir(), 'gtmworks-engine-routes-')), 'routes.log');
  return process.env[logKey];
}

/** Notes a route a fake was asked for, once for each fake (`seen`). @param {Set<string>} seen @param {string} method @param {string} url */
export function noteRoute(seen, method, url) {
  const route = `${method} ${String(url).split('?')[0]}`;
  if (seen.has(route)) return;
  seen.add(route);
  const log = process.env[logKey];
  if (log) try { appendFileSync(log, `${route}\n`); } catch { /* the run's log is gone */ }
}

/** The routes the run's fakes were asked for. */
export function routesAsked(log = process.env[logKey]) {
  try { return readFileSync(log, 'utf8').split('\n').filter(Boolean); } catch { return []; }
}

// The Engine's delete of a task (plugins/kanban/dashboard/plugin_api.py delete_task), never an attachment's or a link's.
const taskDelete = /^DELETE \/api\/plugins\/kanban\/tasks\/[^/]+$/;

/** Fails naming each delete of a task any fake of the run was asked for; the log goes with it. */
export function assertNoCardDeleted(log = process.env[logKey]) {
  const deleted = routesAsked(log).filter(route => taskDelete.test(route));
  if (log) rmSync(dirname(log), { recursive: true, force: true });
  if (deleted.length) throw new Error(`a Card was deleted on the Engine, which gtmworks never asks (spec #831):\n${[...new Set(deleted)].join('\n')}`);
}
