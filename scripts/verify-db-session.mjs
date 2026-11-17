import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { codeOutsideQuotes, leavesOpen, topLevelStatements } from '../tests/sql-statements.mjs';
import { verifyResult } from './verify-db.mjs';

// Every verify file in one psql session in the lane's database container (#259), where a CLI process per file cost
// about a second each. psql runs as the install job runs it, as postgres with each file's output read as rows. A marker
// (the file's place in the list) starts each file's output; a failed query does not end the session, so every file is
// reported by name. Usage: node scripts/verify-db-session.mjs <database container> <file>... (DB_LEDGER adds one
// ledger line per file.)
const [container, ...files] = process.argv.slice(2);
// A verify file is one statement, as it was for the CLI's prepared statement, and psql never sees a command of its own
// in one: a backslash outside quoted text would be one.
const sql = files.map(file => readFileSync(file, 'utf8'));
const refused = new Map(files.flatMap((file, index) => {
 // Left open, the file would swallow the session's own lines after it.
 if (leavesOpen(sql[index])) return [[index, `${file}: a verify file leaves no string, quoted name, dollar quote or comment open`]];
 const count = topLevelStatements(sql[index]).length;
 if (count !== 1) return [[index, `${file}: a verify file is one statement, this one has ${count}`]];
 if (codeOutsideQuotes(sql[index]).includes('\\')) return [[index, `${file}: a verify file holds no psql command (a backslash outside a string)`]];
 return [];
}));

// Each file gets a connection and a read-only transaction of its own, as it had a CLI process of its own, so nothing it
// sets reaches the next file and it writes nothing. Its statement runs even without a final semicolon, and an error
// fails the file: psql keeps the last error's code after a later statement succeeds. psql prints a SQL NULL as null and
// reports the file's row count, so a file passes only on exactly one row holding one JSON value.
const script = files.flatMap((file, index) => refused.has(index) ? [] : [[
 '\\connect',
 "\\set LAST_ERROR_SQLSTATE '00000'",
 'begin transaction read only;',
 `\\echo '@verify ${index}'`,
 '\\timing on',
 sql[index],
 ...codeOutsideQuotes(sql[index]).trimEnd().endsWith(';') ? [] : [';'],
 "\\echo '@rows' :ROW_COUNT",
 '\\timing off',
 'rollback;',
 "select :'LAST_ERROR_SQLSTATE' <> '00000' as verify_failed \\gset",
 '\\if :verify_failed',
 `\\echo '@failed' :LAST_ERROR_MESSAGE`,
 '\\endif',
].join('\n')]).join('\n') + '\n';

const psql = spawnSync('docker', [
 'exec', '-i', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', container,
 'psql', '-X', '-q', '-A', '-t', '-P', 'null=null', '-v', 'ON_ERROR_STOP=0', '-U', 'postgres', '-d', 'postgres',
], { input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });

const blocks = new Map();
let current = null;
for (const line of (psql.stdout ?? '').split('\n')) {
 const started = line.match(/^@verify (\d+)$/);
 if (started) { current = { lines: [], ms: 0, error: null, rows: null }; blocks.set(Number(started[1]), current); continue; }
 if (!current) continue;
 const timing = line.match(/^Time: ([\d.]+) ms/);
 if (timing) current.ms += Number(timing[1]);
 else if (line.startsWith('@failed ')) current.error = line.slice('@failed '.length);
 else if (/^@rows \d+$/.test(line)) current.rows = Number(line.slice('@rows '.length));
 else current.lines.push(line);
}

let failed = 0;
for (const [index, file] of files.entries()) {
 const block = blocks.get(index);
 let message = null;
 if (refused.has(index)) message = refused.get(index);
 else if (!block) message = `${file}: the session ended before this file ran`;
 else if (block.error !== null) message = `${file}: ${block.error}`;
 else if (block.rows !== 1) message = `${file}: Database verification returned ${block.rows ?? 'no count of its'} rows (a verify file selects one json value in one row)`;
 else {
  try {
   const output = block.lines.join('\n').trim();
   verifyResult(output ? JSON.parse(`[${output}]`) : [], file);
  } catch (error) { message = error instanceof SyntaxError ? `${file}: Database verification did not return one JSON value (a verify file selects one json value in one row)` : error.message; }
 }
 if (message) { failed++; console.error(message); } else console.log(`${file}: Database verification passed`);
 if (process.env.DB_LEDGER) {
  appendFileSync(process.env.DB_LEDGER, JSON.stringify({
   suite: 'database', file, name: 'verify', duration_ms: Math.round(block?.ms ?? 0), outcome: message ? 'failed' : 'passed', retries: 0,
  }) + '\n');
 }
}
console.log(`${files.length} verify files: ${files.length - failed} passed, ${failed} failed`);
process.exitCode = failed || psql.status !== 0 ? 1 : 0;
