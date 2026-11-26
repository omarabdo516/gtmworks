import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stableDump } from '../scripts/schema-snapshot.mjs';

// #780: the generated file of the database's shape keeps only what the schema decides, so two dumps of one schema are the
// same file, and the database job reads it against the migrations.
test('a dump keeps the schema and drops the lines that differ between two dumps of it', () => {
 const dump = ['--', '\\restrict AbC123', '', '-- Dumped from database version 17.11', '-- Dumped by pg_dump version 17.11', '', '', '', 'CREATE TABLE public.t (id uuid);', '\\unrestrict AbC123', ''].join('\n');
 assert.equal(stableDump(dump), '--\n\nCREATE TABLE public.t (id uuid);\n');
 assert.equal(stableDump(dump.replaceAll('AbC123', 'Zz9')), stableDump(dump));
});

test('the committed snapshot says it is generated, holds the schema and is checked by the database job', () => {
 const snapshot = readFileSync('supabase/schema.sql', 'utf8');
 assert.match(snapshot, /^-- The database's current shape, generated/);
 assert.match(snapshot, /Never edit this file/);
 for (const shape of [/CREATE TABLE public\.companies /, /CREATE FUNCTION public\.is_member\(/, /CREATE POLICY /, /^GRANT /m, /-- Storage policies/])
  assert.match(snapshot, shape);
 assert.doesNotMatch(snapshot, /\\restrict /);
 assert.match(readFileSync('ci.sh', 'utf8'), /node scripts\/schema-snapshot\.mjs check "\$container"/);
});
