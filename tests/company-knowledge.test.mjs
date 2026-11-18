import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { knowledgeBlocks, knowledgeParts, pickPart } from '../lib/company-knowledge.mjs';
import { i18n } from '../lib/i18n.mjs';

// The Company knowledge (#27): five parts in one order, each with a title in both languages, and a part's text read as
// paragraphs and bullets.
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

test('a part\'s text reads as paragraphs, and lines starting with a bullet or a dash as one list while they follow each other', () => {
 assert.deepEqual(knowledgeBlocks('  We talk like a colleague.  \n• Egyptian ads in Egyptian Arabic\n-   Saudi ads lightly Saudi\r\n\n\nPrices follow the course page.\n• No emojis\n'), [
  { kind: 'p', text: 'We talk like a colleague.' },
  { kind: 'ul', items: ['Egyptian ads in Egyptian Arabic', 'Saudi ads lightly Saudi'] },
  { kind: 'p', text: 'Prices follow the course page.' },
  { kind: 'ul', items: ['No emojis'] },
 ]);
 assert.deepEqual(knowledgeBlocks(' \n '), []);
});
