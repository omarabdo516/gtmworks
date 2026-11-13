// Adds or replaces interface strings in both catalogues at once, so every key lands in English and Arabic together.
// Usage: node scripts/add-messages.mjs <file.json>  where the file holds {"key": {"en": "...", "ar": "..."}, ...}
import { readFileSync, writeFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const language of ['en', 'ar']) {
  const path = `lib/messages/${language}.json`;
  const catalogue = JSON.parse(readFileSync(path, 'utf8'));
  for (const [key, values] of Object.entries(input)) {
    if (typeof values?.en !== 'string' || typeof values?.ar !== 'string') throw new Error(`${key} needs both en and ar`);
    catalogue[key] = values[language];
  }
  writeFileSync(path, `${JSON.stringify(catalogue, null, 2)}\n`);
}
console.log(`added ${Object.keys(input).length} key(s) to en and ar`);
