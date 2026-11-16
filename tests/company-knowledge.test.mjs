import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { knowledgeBlocks, knowledgeInstructions, knowledgeParts, pickPart } from '../lib/company-knowledge.mjs';
import { i18n } from '../lib/i18n.mjs';

// The Company knowledge (#27): five parts in one order, each with a title in both languages, a run's instructions made
// from the parts that have text, and a part's text read as paragraphs and bullets.
test('the app and the database know the same parts, in the same order', () => {
 const sql = readdirSync('supabase/migrations').filter(name => !name.endsWith('.verify.sql')).sort().map(name => readFileSync(`supabase/migrations/${name}`, 'utf8')).filter(text => text.includes('function public.company_knowledge_parts')).at(-1);
 const listed = sql?.match(/function public\.company_knowledge_parts\(\)[^$]*\$\$\s*select array\[([^\]]*)\]/)?.[1];
 assert.deepEqual(listed?.split(',').map(part => part.trim().replace(/^'|'$/g, '')), knowledgeParts.map(([part]) => part));
 assert.deepEqual(knowledgeParts.map(([part]) => part), ['voice', 'audience', 'products', 'banned', 'decisions']);
 for (const language of ['en', 'ar']) for (const [, title] of knowledgeParts) assert.ok(i18n(language).t(title), `${language} ${title}`);
});

test('a part asked for by its key is shown, and anything else shows the brand voice', () => {
 assert.equal(pickPart('banned'), 'banned');
 for (const other of [undefined, '', 'memory', 'Voice', ['banned']]) assert.equal(pickPart(other), 'voice', String(other));
});

test('a run is told the parts that have text, in the parts\' order, each under its heading', () => {
 assert.equal(knowledgeInstructions([
  { part: 'banned', body: '  No guaranteed jobs.\n' },
  { part: 'audience', body: ' \n ' },
  { part: 'memory', body: 'Not a part of the knowledge.' },
  { part: 'voice', body: 'Like a colleague two years ahead.\n• No emojis in an ad.' },
 ]), 'The company keeps the knowledge below for all of its agents. Follow it in all your work for this company. Its people keep it up to date and every run is given its latest text, so do not save it to your memory.\n\n'
  + '## Brand voice\nLike a colleague two years ahead.\n• No emojis in an ad.\n\n## Banned claims\nNo guaranteed jobs.');
 for (const none of [[], [{ part: 'voice', body: '  ' }], [{ part: 'voice', body: 7 }], null, undefined, 'voice', {}]) assert.equal(knowledgeInstructions(none), undefined, JSON.stringify(none));
});

test('a part\'s text reads as paragraphs, and lines starting with a bullet or a dash as one list while they follow each other', () => {
 assert.deepEqual(knowledgeBlocks('  We talk like a colleague.  \n• Egyptian ads in Egyptian Arabic\n-   Saudi ads lightly Saudi\r\n\n\nPrices follow the course page.\n• No emojis\n'), [
  { kind: 'p', text: 'We talk like a colleague.' },
  { kind: 'ul', items: ['Egyptian ads in Egyptian Arabic', 'Saudi ads lightly Saudi'] },
  { kind: 'p', text: 'Prices follow the course page.' },
  { kind: 'ul', items: ['No emojis'] },
 ]);
 assert.deepEqual(knowledgeBlocks(' \n '), []);
});
