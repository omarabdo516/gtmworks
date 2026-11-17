import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A migration replay's pgTAP file, named for its script. tests/db.sh sets DB_TEST_DIR and runs every replay's file in one
// `supabase test db` (#259); run alone, a replay tests the local stack itself. CLI 3 defaults to local: never accept a
// remote target from argv or env.
export function testDb(scriptUrl, sql) {
 const name = basename(fileURLToPath(scriptUrl), '.mjs');
 if (process.env.DB_TEST_DIR) {
  writeFileSync(join(process.env.DB_TEST_DIR, `${name}.sql`), sql);
  return;
 }
 const dir = mkdtempSync(join(tmpdir(), `gtmworks-${name}-`));
 try {
  const file = join(dir, `${name}.sql`);
  writeFileSync(file, sql);
  const result = spawnSync('npx', ['--no-install', 'supabase', 'test', 'db', file], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
 } finally { rmSync(dir, { recursive: true, force: true }); }
}
