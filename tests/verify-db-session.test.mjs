import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// scripts/verify-db-session.mjs runs every verify file in one psql session inside the lane's database container (#259).
// Here `docker` is a stand-in that prints what psql would print for the session, so the test needs no stack.
function session(t, files, psqlOutput, psqlStatus = 0, sql = {}) {
 const dir = mkdtempSync(join(tmpdir(), 'gtmworks-verify-session-'));
 t.after(() => rmSync(dir, { recursive: true, force: true }));
 for (const file of files) writeFileSync(join(dir, file), sql[file] ?? `select json_build_object('from', '${file}');\n`);
 writeFileSync(join(dir, 'psql.out'), psqlOutput);
 writeFileSync(join(dir, 'docker'), `#!/bin/sh\ncat > "${dir}/psql.in"\ncat "${dir}/psql.out"\nexit ${psqlStatus}\n`);
 chmodSync(join(dir, 'docker'), 0o755);
 const ledger = join(dir, 'database.jsonl');
 const run = spawnSync(process.execPath, [join(process.cwd(), 'scripts/verify-db-session.mjs'), 'supabase_db_repo', ...files], {
  cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DB_LEDGER: ledger },
 });
 const records = (() => { try { return readFileSync(ledger, 'utf8').trim().split('\n').map(line => JSON.parse(line)); } catch { return []; } })();
 return { ...run, records, input: readFileSync(join(dir, 'psql.in'), 'utf8') };
}

const files = ['a.verify.sql', 'b.verify.sql', 'c.verify.sql', 'd.verify.sql'];

test('every verify file passes in one session and is reported by name, with its own ledger line', t => {
 const output = [
  '@verify a.verify.sql', '{"rls" : [{"table" : "companies", "rls" : true}], "ok" : true}', 'Time: 1.750 ms',
  // json_agg puts a line break between elements: one result can span lines.
  '@verify b.verify.sql', '{"grants" : [true, ', ' true]}', 'Time: 0.400 ms',
  '@verify c.verify.sql', '{"c" : true}', 'Time: 2.000 ms',
  '@verify d.verify.sql', '{"d" : true}', 'Time: 0.100 ms',
 ].join('\n') + '\n';
 const run = session(t, files, output);
 assert.equal(run.status, 0, run.stderr);
 for (const file of files) assert.match(run.stdout, new RegExp(`^${file.replace('.', '\\.')}: Database verification passed$`, 'm'));
 assert.deepEqual(run.records.map(record => [record.file, record.name, record.outcome]), files.map(file => [file, 'verify', 'passed']));
 assert.deepEqual(run.records.map(record => record.duration_ms), [2, 0, 2, 0]);
 assert.deepEqual(files.map(file => run.input.indexOf(`from', '${file}'`) > run.input.indexOf(`@verify ${file}`)), [true, true, true, true]);
 assert.ok(run.input.indexOf('@verify b.verify.sql') > run.input.indexOf(`from', 'a.verify.sql'`), 'the files run in order');
});

test('a false check, a failed query, an empty result and a file the session never reached each fail the run by name', t => {
 const output = [
  '@verify a.verify.sql', '{"ok" : false, "rls" : true}', 'Time: 1.000 ms',
  '@verify b.verify.sql', 'Time: 0.300 ms', '@failed relation "public.missing" does not exist',
  '@verify c.verify.sql', 'Time: 0.200 ms',
 ].join('\n') + '\n';
 const run = session(t, files, output);
 assert.equal(run.status, 1);
 assert.match(run.stderr, /^a\.verify\.sql: Database verification returned false or null: rows\[0\]\.ok=false$/m);
 assert.match(run.stderr, /^b\.verify\.sql: relation "public\.missing" does not exist$/m);
 assert.match(run.stderr, /^c\.verify\.sql: Database verification returned no rows$/m);
 assert.match(run.stderr, /^d\.verify\.sql: the session ended before this file ran$/m);
 assert.match(run.stdout, /^4 verify files: 0 passed, 4 failed$/m);
 assert.deepEqual(run.records.map(record => [record.file, record.outcome]), files.map(file => [file, 'failed']));
});

test('one broken file fails the session while the files around it still pass', t => {
 const output = [
  '@verify a.verify.sql', '{"a" : true}', 'Time: 1.000 ms',
  '@verify b.verify.sql', 'Time: 0.300 ms', '@failed syntax error at or near "selec"',
  '@verify c.verify.sql', '{"c" : true}', 'Time: 1.000 ms',
  '@verify d.verify.sql', '{"d" : true}', 'Time: 1.000 ms',
 ].join('\n') + '\n';
 const run = session(t, files, output);
 assert.equal(run.status, 1);
 assert.deepEqual(run.records.map(record => record.outcome), ['passed', 'failed', 'passed', 'passed']);
 assert.match(run.stdout, /^4 verify files: 3 passed, 1 failed$/m);
});

test('a session psql could not open fails every file', t => {
 const run = session(t, ['a.verify.sql'], '', 2);
 assert.equal(run.status, 1);
 assert.match(run.stderr, /^a\.verify\.sql: the session ended before this file ran$/m);
});

test('a verify file of more or fewer than one statement fails by name and never reaches psql', t => {
 const output = ['@verify b.verify.sql', '{"b" : true}', 'Time: 1.000 ms'].join('\n') + '\n';
 const run = session(t, ['a.verify.sql', 'b.verify.sql', 'c.verify.sql'], output, 0, {
  // The first statement's error would not be the last one psql reports, so the file could pass on its select alone.
  'a.verify.sql': "set role nobody_at_all;\nselect json_build_object('ok', true);\n",
  'c.verify.sql': '-- nothing to run\n',
 });
 assert.equal(run.status, 1);
 assert.match(run.stderr, /^a\.verify\.sql: a verify file is one statement, this one has 2$/m);
 assert.match(run.stderr, /^c\.verify\.sql: a verify file is one statement, this one has 0$/m);
 assert.deepEqual(run.records.map(record => [record.file, record.outcome]), [['a.verify.sql', 'failed'], ['b.verify.sql', 'passed'], ['c.verify.sql', 'failed']]);
 assert.ok(!run.input.includes('nobody_at_all') && !run.input.includes('@verify c.verify.sql'), 'neither file is sent to psql');
});

test('each file runs in a connection of its own, its trailing statement still runs, and an error from any of its statements fails it', t => {
 const run = session(t, ['a.verify.sql', 'b.verify.sql'], '');
 const blocks = run.input.split(/(?=^\\connect$)/m).filter(block => block.trim());
 assert.equal(blocks.length, 2, 'one connection per file');
 for (const [index, file] of ['a.verify.sql', 'b.verify.sql'].entries()) {
  const block = blocks[index];
  const order = ['\\connect', "\\set LAST_ERROR_SQLSTATE '00000'", `@verify ${file}`, `from', '${file}'`, '\n;\n', "<> '00000' as verify_failed \\gset", '\\if :verify_failed']
   .map(text => block.indexOf(text));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), `${file}: ${order}`);
  assert.ok(!/^\\r$/m.test(block), `${file}: nothing is dropped unrun`);
 }
});
