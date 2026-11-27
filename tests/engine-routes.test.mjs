import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fakeHermes } from './fake-hermes.mjs';
import { assertNoCardDeleted, routesAsked, routesLog } from './engine-routes.mjs';

// Spec #831 (#842): a Card is archived, never deleted. Every fake Engine of a run writes each route it is asked for to
// the run's one log, and the browser suite's global teardown fails the run when any of them was asked for the Engine's
// delete of a task.
const ask=(fake,method,path)=>fetch(`${fake.managementAddress}${path}`,{method,headers:{Authorization:`Bearer ${fake.settings.key}`}});

test('every route a fake is asked for reaches the run\'s log, and a delete of a task fails the run', async () => {
 delete process.env.GTMWORKS_ENGINE_ROUTES;
 const log=routesLog();
 const fake=await fakeHermes();
 try {
  const card=fake.settings.kanban.task({title:'Old webinar',status:'done'}).id;
  await ask(fake,'GET','/api/plugins/kanban/board?include_archived=true');
  await ask(fake,'GET','/api/plugins/kanban/board');
  assert.deepEqual(routesAsked(log),['GET /api/plugins/kanban/board']);
  assert.doesNotThrow(()=>assertNoCardDeleted(routesLog()));
  delete process.env.GTMWORKS_ENGINE_ROUTES;
  const next=routesLog();
  const deleted=await ask(fake,'DELETE',`/api/plugins/kanban/tasks/${card}`);
  assert.equal(deleted.status,200);
  assert.equal(fake.settings.kanban.tasks.length,0);
  assert.throws(()=>assertNoCardDeleted(next),new RegExp(`DELETE /api/plugins/kanban/tasks/${card}`));
  assert.equal(existsSync(next),false);
 } finally { await fake.close(); delete process.env.GTMWORKS_ENGINE_ROUTES; }
});
