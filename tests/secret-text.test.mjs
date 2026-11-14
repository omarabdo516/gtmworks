import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { caseInsensitive, caseSensitive, secretLike } from '../lib/secret-text.mjs';

// The form and the database refuse the same notes: every pattern of lib/secret-text.mjs is in public.secret_like, in
// the same list, and nothing else is.
test('the form and the database use the same secret patterns', () => {
  // The latest migration that defines it is the one the database runs.
  const sql = readdirSync('supabase/migrations').filter(name => !name.endsWith('.verify.sql')).sort().map(name => readFileSync(`supabase/migrations/${name}`, 'utf8')).filter(text => text.includes('function public.secret_like')).at(-1);
  const start = sql.search(/create (or replace )?function public\.secret_like/);
  const body = sql.slice(start, sql.indexOf('\n$$;', start));
  // Each array is one quoted pattern per line, closed by a line that starts with `]`.
  const list = marker => { const start = body.indexOf(marker) + marker.length; return [...body.slice(start, body.indexOf('\n  ]', start)).matchAll(/^\s*'((?:[^']|'')*)',?$/gm)].map(match => match[1].replaceAll("''", "'")); };
  assert.deepEqual(list('t ~ any(array['), caseSensitive);
  assert.deepEqual(list('t ~* any(array['), caseInsensitive);
});

test('keys, tokens and passwords look like secrets; ordinary preferences do not', () => {
  for (const secret of ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz', 'gtmw_run_abcdefghijklmnop1234', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'AKIAABCDEFGHIJKLMNOP', 'Password = hunter22', 'my api key: 12345678', 'Bearer abcdefghijklmnopqrstuvwxyz.123', 'الباسورد: 12345678', '-----BEGIN RSA PRIVATE KEY-----',
   // Quoted names (JSON, YAML, .env) and credentials inside an address.
   '{"password":"hunter22"}', "{'api_key': 'abcd1234'}", 'password: "hunter22"', 'DB_PASSWORD=hunter22', 'client_secret = "s3cr3t-value"', 'postgresql://alice:hunter22@localhost/db', 'https://bob:pa55word@example.com/path',
   // Quoted values with spaces, and every form the first detector refused.
   'password: "abc def 123"', "token = 'a b c d'", 'password: "abc"', 'secret=abcd', 'pwd: x"yz',
   // Egyptian spellings of the Arabic words.
   'كلمه السر: abcd1234', 'الباسوورد: abcd1234', 'باسوورد = hunter22'])
    assert.equal(secretLike(secret), true, secret);
  for (const note of ['Answer in short points, in Egyptian Arabic.', 'رد في نقط قصيرة، واقترح اختيارين قبل ما تكتب.', 'I never share my password with agents.', 'Use the brand token colours.'])
    assert.equal(secretLike(note), false, note);
});
