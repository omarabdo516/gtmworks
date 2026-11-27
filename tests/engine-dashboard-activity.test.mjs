import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dashboardChange, dashboardPage } from '../lib/engine-dashboard-activity.mjs';
import { dashboardActs, dashboardChanges, dashboardPages, dashboardRefusalKinds } from '../lib/engine-dashboard-words.mjs';

// #873 (spec #866): which requests of the Owner's dashboard are a change for the Activity log, and what the line names:
// the dashboard's page and the kind of change, read from the method and the route only, never from a body or a query.

test('the four changes the ticket names each read as their own kind, on their own page', () => {
 assert.deepEqual(dashboardChange('PUT', '/api/env'), { page: 'keys', change: 'keySaved' }, 'a key written');
 assert.deepEqual(dashboardChange('POST', '/api/dashboard/agent-plugins/install'), { page: 'plugins', change: 'pluginInstalled' }, 'a plugin installed');
 assert.deepEqual(dashboardChange('PUT', '/api/config'), { page: 'config', change: 'settingSaved' }, 'a setting saved');
 assert.deepEqual(dashboardChange('POST', '/api/messaging/telegram/onboarding/p1/apply'), { page: 'channels', change: 'platformConnected' }, 'a platform connected');
 assert.deepEqual(dashboardChange('PUT', '/api/messaging/platforms/telegram'), { page: 'channels', change: 'platformSet' }, "a platform's settings saved");
});

test('every other write reads by its page and its method', () => {
 assert.deepEqual(dashboardChange('DELETE', '/api/env'), { page: 'keys', change: 'keyRemoved' });
 assert.deepEqual(dashboardChange('POST', '/api/mcp/servers'), { page: 'mcp', change: 'added' });
 assert.deepEqual(dashboardChange('POST', '/api/webhooks'), { page: 'webhooks', change: 'added' });
 assert.deepEqual(dashboardChange('POST', '/api/skills'), { page: 'skills', change: 'added' });
 assert.deepEqual(dashboardChange('PUT', '/api/skills/content'), { page: 'skills', change: 'settingSaved' });
 assert.deepEqual(dashboardChange('DELETE', '/api/cron/jobs/abc'), { page: 'cron', change: 'removed' });
 assert.deepEqual(dashboardChange('POST', '/api/cron/jobs/abc/trigger'), { page: 'cron', change: 'changed' });
 assert.deepEqual(dashboardChange('POST', '/api/model/set'), { page: 'models', change: 'settingSaved' });
 assert.deepEqual(dashboardChange('POST', '/api/gateway/restart'), { page: 'system', change: 'changed' });
 assert.deepEqual(dashboardChange('PUT', '/api/profiles/lead/soul'), { page: 'profiles', change: 'settingSaved' });
 assert.deepEqual(dashboardChange('POST', '/api/plugins/kanban/tasks'), { page: 'kanban', change: 'added' });
 assert.deepEqual(dashboardChange('POST', '/api/pairing/approve'), { page: 'pairing', change: 'changed' });
 assert.deepEqual(dashboardChange('POST', '/api/fs/write-text'), { page: 'files', change: 'changed' });
 // A route no page is known for still reads as a change, with no page named.
 assert.deepEqual(dashboardChange('POST', '/api/something-new'), { page: null, change: 'changed' });
});

test('the route is read as the Engine reads it, and its query never reaches the line', () => {
 assert.deepEqual(dashboardChange('put', '/API/Env/?key=OPENROUTER_API_KEY&value=sk-secret'), { page: 'keys', change: 'keySaved' });
 assert.deepEqual(dashboardChange('PUT', '//api/%63onfig'), { page: 'config', change: 'settingSaved' });
 assert.ok(!JSON.stringify(dashboardChange('PUT', '/api/env?value=sk-secret')).includes('sk-secret'));
});

test('reading writes nothing: a read, a page, a code file, a socket ticket or a check is no change', () => {
 for (const [method, path] of [['GET', '/'], ['GET', '/config'], ['HEAD', '/api/env'], ['OPTIONS', '/api/env'], ['GET', '/api/status'],
  ['POST', '/api/auth/ws-ticket'], ['POST', '/api/webapp/socket-ticket'], ['POST', '/api/files/ticket'], ['POST', '/api/providers/validate'],
  ['POST', '/api/mcp/servers/crm/test'], ['POST', '/api/messaging/platforms/telegram/test'], ['POST', '/api/ops/doctor'], ['POST', '/api/ops/dump'],
  ['POST', '/api/ops/prompt-size'], ['POST', '/api/audio/speak'], ['POST', '/api/profiles/lead/export'], ['POST', '/api/git/review/pr-list'], ['PUT', '/assets/index.js']])
  assert.equal(dashboardChange(method, path), null, `${method} ${path}`);
});

// The words a line may carry are lib/engine-dashboard-words.mjs's, and the database refuses any other
// (log_engine_dashboard): the two lists are one. The database's are read from supabase/schema.sql, which is written from
// a freshly migrated database and checked against one by the database job (#780).
test('the words a dashboard line may carry are exactly the ones the database takes', () => {
 const schema = readFileSync('supabase/schema.sql', 'utf8');
 const body = /CREATE FUNCTION public\.log_engine_dashboard\(c uuid, act text, page text, kind text\)[\s\S]*?end \$\$;/.exec(schema)?.[0];
 assert.ok(body, 'the database has log_engine_dashboard');
 const list = text => [...text.matchAll(/'([^']*)'/g)].map(([, word]) => word);
 const listAfter = pattern => list(new RegExp(`${pattern} in \\(([^)]*)\\)`).exec(body)?.[1] ?? '');
 assert.deepEqual(listAfter('page not'), [...dashboardPages], 'the pages');
 assert.deepEqual(listAfter("act in \\('changed','rejected'\\) and kind"), [...dashboardChanges], 'the kinds of change');
 assert.deepEqual(listAfter("act='refused' and kind"), [...dashboardRefusalKinds], 'the refused actions');
 const acts = [...body.matchAll(/act='([a-z]+)'|act in \(([^)]*)\)/g)].flatMap(([, one, many]) => one ? [one] : list(many));
 assert.deepEqual(new Set(acts), new Set(dashboardActs), 'the acts');
});

// A refused action names the page it was asked on (#873, from the review of #889), read from its route as a change is.
test('a refused action reads its page from its route as a change does', () => {
 assert.equal(dashboardPage('/api/env/reveal'), 'keys');
 assert.equal(dashboardPage('/api/hermes/update'), 'system');
 assert.equal(dashboardPage('/api/ops/import-upload'), 'system');
 assert.equal(dashboardPage('/API/Profiles/lead?x=1'), 'profiles');
 assert.equal(dashboardPage('/assets/index.js'), null);
});
