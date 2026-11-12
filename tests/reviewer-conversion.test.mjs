import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The reviewer conversion (#7) runs while the previous app version still serves. tests/remove-agency-migration.mjs proves
// on a database that a Company with no active Manager stops the migration; this proves the order: the tables it reads are
// locked against writes and the check runs before the migration changes anything at all, on the schema as it was.
const migration=readFileSync('supabase/migrations/20261204000000_remove_agency.sql','utf8').replace(/--.*$/gm,'');

test('the migration locks what the reviewer conversion reads and checks for a Manager before any change', () => {
 // One DO block opens the migration: the lock first, inside it, so that it needs no transaction block of its own and
 // holds until the transaction around the migration ends (tests/migration-statements.test.mjs), then the check.
 const start=migration.match(/^\s*(do \$\$[^;]*;\s*begin\s+(lock table [^;]+;)[\s\S]*?\nend \$\$;)/);
 assert.ok(start,'the migration opens with one block that takes the lock, then checks');
 const [,check,lock]=start;
 for(const table of ['public.members','public.member_invitations','public.approval_steps','public.work_cards','public.role_permissions']) assert.ok(lock.includes(table),`${table} is locked`);
 assert.match(lock,/in (share row exclusive|exclusive|access exclusive) mode;$/);
 assert.match(check,/raise exception 'Approval steps for reviewers/);
 // On the earlier schema: nothing the migration itself creates or renames.
 assert.doesNotMatch(check,/former_reviewer_steps|is_company_owner|keep_hermes_destination|owner_id/);
 assert.ok(migration.indexOf('update public.approval_steps set person_id=null')>migration.indexOf(check),'the conversion comes after');
});
