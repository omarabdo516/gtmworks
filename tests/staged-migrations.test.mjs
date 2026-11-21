import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// ADR 0023: an update applies every migration before this release's app starts, while the release it replaces still
// serves, and a migration whose name ends in _cutover only once this release's app and worker answer. So every other
// migration from the staged removal of Agent levels on keeps the database usable by the previous release: it takes no
// column, no table and no function signature away. The first step of that removal only adds; the cutover removes.
const migrations=readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql')&&!name.endsWith('.verify.sql')).sort();
const read=name=>readFileSync(`supabase/migrations/${name}`,'utf8');
const firstStep='20270408100000_one_set_of_tools.sql';
const cutover='20270416000000_one_set_of_tools_cutover.sql';

test('a migration before the cutover takes no column, table or function away that the previous release reads', () => {
 for(const name of migrations.filter(name=>name>=firstStep&&!name.endsWith('_cutover.sql'))) {
  const sql=read(name);
  assert.doesNotMatch(sql,/\bdrop\s+(column|table)\b/i,`${name} drops a column or a table`);
  assert.doesNotMatch(sql,/\balter\s+table\b[^;]*\brename\b/i,`${name} renames what the previous release reads`);
  // A function may be dropped only to be made again in the same file with every argument it had, in order, so the
  // previous release's call by name still reaches it.
  for(const [,fn,args] of sql.matchAll(/drop function (?:if exists )?public\.(\w+)\(([^)]*)\)/gi)) {
   const made=[...sql.matchAll(new RegExp(`create function public\\.${fn}\\(([^)]*)\\)`,'g'))].map(([,params])=>params);
   assert.ok(made.length,`${name} drops ${fn} and makes no new one`);
   const before=args.split(',').map(type=>type.trim()).filter(Boolean);
   const types=made[0].split(',').map(param=>param.trim().split(/\s+/)[1]).filter(Boolean);
   assert.deepEqual(types.slice(0,before.length),before,`${name} makes ${fn} again without every argument the previous release passes`);
  }
 }
});

test('the first step of the levels removal keeps the level, and the cutover removes it after every other migration', () => {
 const first=read(firstStep);
 for(const kept of [/companies drop column agent_level/,/drop column tools_level/,/drop column tools_policy/,/drop function[^;]*set_agent_level/,/drop function[^;]*engine_tool_policy/])
  assert.doesNotMatch(first,kept);
 // The previous release's call that makes an Agent for Lead keeps its meaning: one naming no own_profile takes its path.
 assert.match(first,/own_level integer default null, own_policy integer default null, own_answers boolean default true, own_profile boolean default null/);
 assert.match(first,/if own_profile is null then/);
 const last=read(cutover);
 for(const removed of [/alter table public\.companies drop column agent_level;/,/drop column tools_level;/,/drop column tools_policy;/,
  /drop function if exists public\.set_agent_level\(uuid,integer\);/,/drop function if exists public\.engine_tool_policy\(\);/])
  assert.match(last,removed);
 assert.ok(migrations.indexOf(cutover)>migrations.indexOf(firstStep),'the cutover sorts after the first step it follows');
 // A migration of a later release sorts after the cutover, yet an update across both applies it in the early stage,
 // before the cutover (install.sh). It is held to the first test's rule like every other non-cutover migration, and it
 // reads nothing the cutover takes away, so it runs on either step's schema (#375).
 for(const name of migrations.filter(name=>name>cutover)) for(const gone of [/\bagent_level\b/,/\btools_level\b/,/\btools_policy\b/,/\bset_agent_level\b/,/\bengine_tool_policy\b/])
  assert.doesNotMatch(read(name),gone,`${name} sorts after the cutover yet reads what it removes`);
});

test('the installer applies the cutover only once this release answers, and puts the previous Engines back when an update cannot start its own', () => {
 const install=readFileSync('scripts/install.sh','utf8');
 assert.match(install,/\*_cutover\.sql\) \[ "\$stage" = cutover \] \|\| continue;;/);
 const early=install.indexOf('\napply_migrations\n');
 const engines=install.indexOf('if ! engines_up; then');
 const app=install.indexOf('compose up -d --wait --wait-timeout 300\n',engines);
 const health=install.indexOf("compose exec -T web node -e \"let tries=60;");
 const late=install.indexOf('\napply_migrations cutover ||');
 assert.ok(early>0&&early<engines&&engines<app&&app<health&&health<late,'migrations, Engines, app, health, cutover');
 assert.match(install.slice(engines,app),/restore_previous_engine/);
 // The previous sandboxes start again from the image the previous run recorded: this run's is dropped, and a source
 // build's previous image, kept under its own name before the tag was rebuilt, gets the tag back.
 const restore=install.slice(install.indexOf('restore_previous_engine() {'),install.indexOf('\n}\n',install.indexOf('restore_previous_engine() {')));
 assert.match(restore,/rm -f \.install-lock\/work-sandbox-image/);
 // Each restored sandbox gets its own Engine's key, read again per Engine, never the one another Company's start left.
 assert.match(restore,/for name in \$\(engine_names\); do[\s\S]*sandbox_key=\n[\s\S]*sandbox_keys "\$name"[\s\S]*engine "\$name" up -d --remove-orphans/);
 assert.match(restore,/engine "\$name" up -d --remove-orphans[\s\S]*sandbox_reachable "\$name"/,'and each restored sandbox is reached over SSH by its own Engine');
 assert.match(restore,/docker tag "\$work_sandbox_tag-previous" "\$work_sandbox_tag"/);
 const build=install.slice(install.indexOf('work_sandbox_image() {'));
 assert.ok(build.indexOf('docker tag "$work_sandbox_tag" "$work_sandbox_tag-previous"')<build.indexOf('docker build --tag "$work_sandbox_tag" sandbox'),'the running image keeps a name before the build replaces its tag');
 // The previous release's Engine files are kept before an update replaces anything, in both kinds of update.
 assert.equal(install.match(/\n {2}keep_previous_engine \|\| exit 1\n/g)?.length,2);
 // A restore applies the cutover too, once the restored install answers.
 assert.match(install,/apply_migrations \|\| return 1[\s\S]*apply_migrations cutover \|\| \{ echo 'The restore finished/);
});
