import { readFileSync } from 'node:fs';
import { testDb } from './pgtap.mjs';

// ADR 0023 replays the cutover's own guard (#389): a cutover never lands in the transaction that applied its first step,
// as an installer from before the stages does when it applies every migration at once. Recorded in an earlier
// transaction, the first step lets the cutover apply; recorded in the same one, the cutover stops the transaction. An
// earlier transaction's record stands in by a subtransaction's: its row carries an id that is not this transaction's.
const cutover = readFileSync('supabase/migrations/20270416000000_one_set_of_tools_cutover.sql', 'utf8');
const guard = cutover.match(/^do \$\$ begin\n[\s\S]*?\nend \$\$;$/m)[0];
const first = '20270408100000_one_set_of_tools.sql';
const sql = `begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
create schema if not exists gtmworks_install;
create table if not exists gtmworks_install.schema_migrations(name text primary key);
delete from gtmworks_install.schema_migrations where name='${first}';
select lives_ok($q$${guard}$q$,'a cutover with no first step recorded by the installer applies (a database the installer did not make)');
savepoint earlier;
insert into gtmworks_install.schema_migrations values ('${first}');
release savepoint earlier;
select lives_ok($q$${guard}$q$,'a cutover whose first step an earlier transaction applied applies');
delete from gtmworks_install.schema_migrations where name='${first}';
insert into gtmworks_install.schema_migrations values ('${first}');
select throws_like($q$${guard}$q$,'%finished by the installer it downloaded%','a cutover in the transaction that applied its first step stops it');
select * from finish();
rollback;
`;
testDb(import.meta.url, sql);
