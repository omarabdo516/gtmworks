#!/usr/bin/env node
// The design system's values for code that runs on the server and writes its own HTML (#808, DESIGN.md "Where the values
// live"): DESIGN.md's front matter is the one source of them, and this writes its colours, radii, spacing, shadows and
// type into lib/design-tokens.mjs, which such code imports in place of writing a value itself (lib/design-css.mjs reads
// it). The file is generated, never edited; tests/design-values.test.mjs fails when it differs from the front matter.
//
// Usage: node scripts/design-tokens.mjs write
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { load } from 'js-yaml';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv[2]!=='write') { console.error('usage: node scripts/design-tokens.mjs write'); process.exit(2); }
const matter=readFileSync(join(root,'DESIGN.md'),'utf8').match(/^---\n([\s\S]*?)\n---\n/);
if(!matter) { console.error('DESIGN.md has no front matter'); process.exit(1); }
const design=/** @type {Record<string,unknown>} */(load(matter[1]));
const tokens={colors:design.colors,rounded:design.rounded,spacing:design.spacing,shadows:design.shadows,typography:design.typography};
const target=join(root,'lib/design-tokens.mjs');
writeFileSync(target,`// Generated from DESIGN.md's front matter by \`node scripts/design-tokens.mjs write\`: never edit this file (#808).
// tests/design-values.test.mjs fails when it differs from the front matter. Read it through lib/design-css.mjs.
/** @type {{colors:Record<string,string>,rounded:Record<string,string>,spacing:Record<string,string>,shadows:Record<string,string>,typography:Record<string,Record<string,string|number>>}} */
export const designTokens=${JSON.stringify(tokens,null,1)};
`);
console.log(`design tokens: wrote ${target}`);
