#!/usr/bin/env node
// The database's current shape in one file (#780): every table, view, type, function, trigger, policy and grant of the
// `public` schema, and the policies and buckets the migrations add to Supabase's storage, as a freshly migrated database
// holds them. A developer or an agent reads `supabase/schema.sql` to learn what a table or a function is today, in place of
// reading every migration. The file is generated, never edited: `node scripts/schema-snapshot.mjs write` writes it from
// the local stack (`bash scripts/local-db.sh` first), and `ci.sh database` runs `check`, which fails when the committed
// file differs from what the migrations produce.
//
// Usage: node scripts/schema-snapshot.mjs write|check [db-container]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
export const snapshotPath=join(root,'supabase/schema.sql');
const header=`-- The database's current shape, generated from a freshly migrated local database (#780).
-- Never edit this file: change a migration, then run \`bash scripts/local-db.sh && node scripts/schema-snapshot.mjs write\`.
-- \`ci.sh database\` fails when it differs from what the migrations produce.
`;

// pg_dump's own lines that differ between two dumps of one schema: the random key of its \restrict guard and the
// versions it names. Nothing else of the dump depends on the machine.
/** @param {string} dump */
export function stableDump(dump) {
 return dump.split('\n').filter(line=>!/^\\(un)?restrict /.test(line)&&!/^-- Dumped (from database|by pg_dump) version /.test(line)).join('\n').replace(/\n{3,}/g,'\n\n').trim()+'\n';
}

// What the migrations add outside `public`: the storage policies (Supabase's own tables and triggers there are its, not
// ours) and the buckets, each as one line in name order.
const storageSql=`
select '-- Storage policies' union all
(select format('CREATE POLICY %I ON storage.%I AS %s FOR %s TO %s%s%s;', policyname, tablename, permissive, cmd,
  array_to_string(roles, ', '), coalesce(' USING (' || qual || ')', ''), coalesce(' WITH CHECK (' || with_check || ')', ''))
 from pg_policies where schemaname = 'storage' order by tablename, policyname)
union all select '-- Storage buckets'
union all (select format('-- bucket %s: public %s, file size limit %s, types %s', id, public, coalesce(file_size_limit::text, 'none'),
  coalesce(array_to_string(allowed_mime_types, ', '), 'any')) from storage.buckets order by id);`;

/** @param {string} container */
export function readSnapshot(container) {
 const run=(/** @type {string[]} */ args)=>execFileSync('docker',['exec',container,...args],{encoding:'utf8',maxBuffer:256*1024*1024});
 const dump=run(['pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--schema=public']);
 const storage=run(['psql','-X','-U','supabase_admin','-d','postgres','-tA','-v','ON_ERROR_STOP=1','-c',storageSql]);
 return `${header}\n${stableDump(dump)}\n${storage.trim()}\n`;
}

const main=()=>{
 const [mode,given]=process.argv.slice(2);
 if(mode!=='write'&&mode!=='check') { console.error('usage: node scripts/schema-snapshot.mjs write|check [db-container]'); process.exit(2); }
 const containerFile=join(root,'supabase/.temp/lanes/0/db-container');
 const container=given??(existsSync(containerFile)?readFileSync(containerFile,'utf8').trim():'');
 if(!container) { console.error('the schema snapshot needs the local database: run bash scripts/local-db.sh first'); process.exit(2); }
 const fresh=readSnapshot(container);
 if(mode==='write') { writeFileSync(snapshotPath,fresh); console.log(`schema snapshot: wrote ${snapshotPath}`); return; }
 const committed=existsSync(snapshotPath)?readFileSync(snapshotPath,'utf8'):'';
 if(committed===fresh) { console.log('schema snapshot: supabase/schema.sql matches the migrations'); return; }
 const ours=committed.split('\n'), theirs=fresh.split('\n');
 const at=ours.findIndex((line,index)=>line!==theirs[index]);
 console.error(`schema snapshot: supabase/schema.sql differs from what the migrations produce (first at line ${at+1}).`);
 console.error('Run: bash scripts/local-db.sh && node scripts/schema-snapshot.mjs write, then commit supabase/schema.sql.');
 process.exit(1);
};
if(process.argv[1]===fileURLToPath(import.meta.url)) main();
