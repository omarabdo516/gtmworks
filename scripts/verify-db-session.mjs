import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { topLevelStatements } from '../tests/sql-statements.mjs';
import { verifyResult } from './verify-db.mjs';

// Every verify file in one read-only psql session in the lane's database container (#259), where a CLI process per file
// cost about a second each. psql runs as the install job runs it: as postgres, read-only, with each file's output read
// as rows. A marker names each file; a failed query does not end the session, so every file is reported by name.
// Usage: node scripts/verify-db-session.mjs <database container> <file>... (DB_LEDGER adds one ledger line per file.)
const [container, ...files] = process.argv.slice(2);
// A verify file is one statement, as it was for the CLI's prepared statement.
const sql = new Map(files.map(file => [file, readFileSync(file, 'utf8')]));
const refused = new Map(files.flatMap(file => {
 const count = topLevelStatements(sql.get(file)).length;
 return count === 1 ? [] : [[file, `${file}: a verify file is one statement, this one has ${count}`]];
}));

// Each file gets a connection of its own, as it had a CLI process of its own, so nothing it sets reaches the next file.
// A statement left without its semicolon still runs, as psql runs it at the end of a file, and an error from any of the
// file's statements fails it: psql keeps the last error's code after a later statement succeeds.
const script = files.filter(file => !refused.has(file)).map(file => [
 '\\connect',
 "\\set LAST_ERROR_SQLSTATE '00000'",
 `\\echo '@verify ${file}'`,
 '\\timing on',
 sql.get(file),
 ';',
 '\\timing off',
 "select :'LAST_ERROR_SQLSTATE' <> '00000' as verify_failed \\gset",
 '\\if :verify_failed',
 `\\echo '@failed' :LAST_ERROR_MESSAGE`,
 '\\endif',
].join('\n')).join('\n') + '\n';

const psql = spawnSync('docker', [
 'exec', '-i', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', container,
 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=0', '-U', 'postgres', '-d', 'postgres',
], { input: script, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });

const blocks = new Map();
let current = null;
for (const line of (psql.stdout ?? '').split('\n')) {
 const started = line.match(/^@verify (.+)$/);
 if (started) { current = { lines: [], ms: 0, error: null }; blocks.set(started[1], current); continue; }
 if (!current) continue;
 const timing = line.match(/^Time: ([\d.]+) ms/);
 if (timing) current.ms += Number(timing[1]);
 else if (line.startsWith('@failed ')) current.error = line.slice('@failed '.length);
 else current.lines.push(line);
}

let failed = 0;
for (const file of files) {
 const block = blocks.get(file);
 let message = null;
 if (refused.has(file)) message = refused.get(file);
 else if (!block) message = `${file}: the session ended before this file ran`;
 else if (block.error !== null) message = `${file}: ${block.error}`;
 else {
  try {
   const output = block.lines.join('\n').trim();
   verifyResult(output ? JSON.parse(`[${output}]`) : [], file);
  } catch (error) { message = error instanceof SyntaxError ? `${file}: Database verification returned invalid JSON` : error.message; }
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
