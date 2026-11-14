import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { caseInsensitive, caseSensitive, secretLike } from '../lib/secret-text.mjs';

// The form and the database refuse the same notes: every pattern of lib/secret-text.mjs is in public.secret_like, in
// the same list, and nothing else is.
test('the form and the database use the same secret patterns', () => {
  const sql = readFileSync('supabase/migrations/20261211000000_team_work.sql', 'utf8');
  const body = sql.slice(sql.indexOf('create function public.secret_like'), sql.indexOf('revoke all on function public.secret_like'));
  // Each array is one quoted pattern per line, closed by a line that starts with `]`.
  const list = marker => { const start = body.indexOf(marker) + marker.length; return [...body.slice(start, body.indexOf('\n  ]', start)).matchAll(/^\s*'((?:[^']|'')*)',?$/gm)].map(match => match[1].replaceAll("''", "'")); };
  assert.deepEqual(list('t ~ any(array['), caseSensitive);
  assert.deepEqual(list('t ~* any(array['), caseInsensitive);
});

test('keys, tokens and passwords look like secrets; ordinary preferences do not', () => {
  for (const secret of ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz', 'gtmw_run_abcdefghijklmnop1234', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'AKIAABCDEFGHIJKLMNOP', 'Password = hunter22', 'my api key: 12345678', 'Bearer abcdefghijklmnopqrstuvwxyz.123', 'الباسورد: 12345678', '-----BEGIN RSA PRIVATE KEY-----'])
    assert.equal(secretLike(secret), true, secret);
  for (const note of ['Answer in short points, in Egyptian Arabic.', 'رد في نقط قصيرة، واقترح اختيارين قبل ما تكتب.', 'I never share my password with agents.', 'Use the brand token colours.'])
    assert.equal(secretLike(note), false, note);
});
