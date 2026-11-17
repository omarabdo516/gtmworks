import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// scripts/verify-db-session.mjs runs every verify file in one psql session inside the lane's database container (#259).
// Here `docker` is a stand-in that prints what psql would print for the session, so the test needs no stack. The session
// marks each file it sends by its place in the command line (`@verify 0` is the first file).
function session(t, files, psqlOutput, psqlStatus = 0, sql = {}) {
 const dir = mkdtempSync(join(tmpdir(), 'gtmworks-verify-session-'));
 t.after(() => rmSync(dir, { recursive: true, force: true }));
 for (const file of files) writeFileSync(join(dir, file), sql[file] ?? `select json_build_object('from', 'file ${files.indexOf(file)}');\n`);
 writeFileSync(join(dir, 'psql.out'), psqlOutput);
 writeFileSync(join(dir, 'docker'), `#!/bin/sh\necho "$@" > "${dir}/psql.args"\ncat > "${dir}/psql.in"\ncat "${dir}/psql.out"\nexit ${psqlStatus}\n`);
 chmodSync(join(dir, 'docker'), 0o755);
 const ledger = join(dir, 'database.jsonl');
 const run = spawnSync(process.execPath, [join(process.cwd(), 'scripts/verify-db-session.mjs'), 'supabase_db_repo', ...files], {
  cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DB_LEDGER: ledger },
 });
 const records = (() => { try { return readFileSync(ledger, 'utf8').trim().split('\n').map(line => JSON.parse(line)); } catch { return []; } })();
 return { ...run, records, input: readFileSync(join(dir, 'psql.in'), 'utf8'), args: readFileSync(join(dir, 'psql.args'), 'utf8') };
}
const lines = (...rows) => rows.join('\n') + '\n';
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const files = ['a.verify.sql', 'b.verify.sql', 'c.verify.sql', 'd.verify.sql'];

test('every verify file passes in one session and is reported by name, with its own ledger line', t => {
 const output = lines(
  '@verify 0', '{"rls" : [{"table" : "companies", "rls" : true}], "ok" : true}', 'Time: 1.750 ms', '@rows 1',
  // json_agg puts a line break between elements: one result can span lines.
  '@verify 1', '{"grants" : [true, ', ' true]}', 'Time: 0.400 ms', '@rows 1',
  '@verify 2', '{"c" : true}', 'Time: 2.000 ms', '@rows 1',
  '@verify 3', '{"d" : true}', 'Time: 0.100 ms', '@rows 1',
 );
 const run = session(t, files, output);
 assert.equal(run.status, 0, run.stderr);
 for (const file of files) assert.match(run.stdout, new RegExp(`^${escape(file)}: Database verification passed$`, 'm'));
 assert.match(run.args, /(^| )-P null=null( |$)/, 'psql prints a SQL NULL as null, never as an empty line');
 assert.deepEqual(run.records.map(record => [record.file, record.name, record.outcome]), files.map(file => [file, 'verify', 'passed']));
 assert.deepEqual(run.records.map(record => record.duration_ms), [2, 0, 2, 0]);
 assert.deepEqual(files.map((_, index) => run.input.indexOf(`'file ${index}'`) > run.input.indexOf(`@verify ${index}'`)), [true, true, true, true]);
 assert.ok(run.input.indexOf("@verify 1'") > run.input.indexOf("'file 0'"), 'the files run in order');
});

test('a false check, a failed query, an empty result and a file the session never reached each fail the run by name', t => {
 const output = lines(
  '@verify 0', '{"ok" : false, "rls" : true}', 'Time: 1.000 ms', '@rows 1',
  '@verify 1', 'Time: 0.300 ms', '@rows 0', '@failed relation "public.missing" does not exist',
  '@verify 2', 'Time: 0.200 ms', '@rows 0',
 );
 const run = session(t, files, output);
 assert.equal(run.status, 1);
 assert.match(run.stderr, /^a\.verify\.sql: Database verification returned false or null: rows\[0\]\.ok=false$/m);
 assert.match(run.stderr, /^b\.verify\.sql: relation "public\.missing" does not exist$/m);
 assert.match(run.stderr, /^c\.verify\.sql: Database verification returned 0 rows \(a verify file selects one json value in one row\)$/m);
 assert.match(run.stderr, /^d\.verify\.sql: the session ended before this file ran$/m);
 assert.match(run.stdout, /^4 verify files: 0 passed, 4 failed$/m);
 assert.deepEqual(run.records.map(record => [record.file, record.outcome]), files.map(file => [file, 'failed']));
});

test('one broken file fails the session while the files around it still pass', t => {
 const output = lines(
  '@verify 0', '{"a" : true}', 'Time: 1.000 ms', '@rows 1',
  '@verify 1', 'Time: 0.300 ms', '@rows 0', '@failed syntax error at or near "selec"',
  '@verify 2', '{"c" : true}', 'Time: 1.000 ms', '@rows 1',
  '@verify 3', '{"d" : true}', 'Time: 1.000 ms', '@rows 1',
 );
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

test('a file that returns more or fewer than one row, or a row that is not one JSON value, fails by name', t => {
 const named = ['a.verify.sql', 'b.verify.sql', 'c.verify.sql'];
 // a: a true row and a NULL row, which psql prints as `null`; b: two columns; c: a single NULL row.
 const run = session(t, named, lines('@verify 0', '{"ok" : true}', 'null', '@rows 2', '@verify 1', 't|t', '@rows 1', '@verify 2', 'null', '@rows 1'));
 assert.equal(run.status, 1);
 assert.match(run.stderr, /^a\.verify\.sql: Database verification returned 2 rows \(a verify file selects one json value in one row\)$/m);
 assert.match(run.stderr, /^b\.verify\.sql: Database verification did not return one JSON value \(a verify file selects one json value in one row\)$/m);
 assert.match(run.stderr, /^c\.verify\.sql: Database verification returned false or null: rows\[0\]=null$/m);
});

test('a file of more or fewer than one statement, or with a psql command, fails by name and never reaches psql', t => {
 const named = ['a.verify.sql', 'b.verify.sql', 'c.verify.sql', 'd.verify.sql', 'e.verify.sql'];
 const run = session(t, named, lines('@verify 1', '{"b" : true}', '@rows 1'), 0, {
  'a.verify.sql': "set role nobody_at_all;\nselect json_build_object('ok', true);\n",
  // A backslash inside a string is data, as in a pattern; psql obeys one only outside strings.
  'b.verify.sql': "select json_build_object('ok', 'a.b' ~ 'a\\.b', 'escaped', E'it\\'s' = 'it''s');\n",
  'c.verify.sql': '-- nothing to run\n',
  // The escape string's quote would hide the second statement from a reader that does not know escape strings.
  'd.verify.sql': "select json_build_object('ok', E'\\'' = '''', 'gone', true);\nselect 1/0\n",
  'e.verify.sql': "select json_build_object('ok', true) \\gset\n\\! touch escaped\n",
 });
 assert.equal(run.status, 1);
 assert.match(run.stderr, /^a\.verify\.sql: a verify file is one statement, this one has 2$/m);
 assert.match(run.stderr, /^c\.verify\.sql: a verify file is one statement, this one has 0$/m);
 assert.match(run.stderr, /^d\.verify\.sql: a verify file is one statement, this one has 2$/m);
 assert.match(run.stderr, /^e\.verify\.sql: a verify file holds no psql command \(a backslash outside a string\)$/m);
 assert.deepEqual(run.records.map(record => [record.file, record.outcome]), named.map(file => [file, file === 'b.verify.sql' ? 'passed' : 'failed']));
 assert.equal(run.input.match(/@verify \d+'/g).join(), "@verify 1'", 'only the good file is sent to psql');
 assert.ok(!/nobody_at_all|1\/0|touch escaped/.test(run.input), 'nothing of a refused file is sent');
});

test('each file runs in a connection and read-only transaction of its own, its trailing statement still runs, and an error from any statement fails it', t => {
 // The second file's statement has no final semicolon; the first's has one, so it gets no empty statement after it.
 const run = session(t, ['a.verify.sql', 'b.verify.sql'], '', 0, { 'b.verify.sql': "select json_build_object('from', 'file 1') -- no semicolon\n" });
 const blocks = run.input.split(/(?=^\\connect$)/m).filter(block => block.trim());
 assert.equal(blocks.length, 2, 'one connection per file');
 assert.ok(!/^;$/m.test(blocks[0]), 'a terminated statement gets no empty one after it');
 for (const [index, block] of blocks.entries()) {
  const order = [
   '\\connect', "\\set LAST_ERROR_SQLSTATE '00000'", 'begin transaction read only;', `@verify ${index}'`, `'file ${index}'`,
   ...index === 1 ? ['\n;\n'] : [], "\\echo '@rows' :ROW_COUNT", 'rollback;', "<> '00000' as verify_failed \\gset", '\\if :verify_failed',
  ].map(text => block.indexOf(text));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), `file ${index}: ${order}`);
  assert.ok(!/^\\r$/m.test(block), `file ${index}: nothing is dropped unrun`);
 }
});

test('a file name with a quote or a space is still reported by name', t => {
 const named = ["it's.verify.sql", 'two words.verify.sql'];
 const run = session(t, named, lines('@verify 0', '{"a" : true}', '@rows 1', '@verify 1', '{"b" : true}', '@rows 1'));
 assert.equal(run.status, 0, run.stderr);
 for (const file of named) assert.match(run.stdout, new RegExp(`^${escape(file)}: Database verification passed$`, 'm'));
});
