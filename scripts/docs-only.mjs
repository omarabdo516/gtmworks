import { readFileSync } from 'node:fs';

// Accept path arguments or git diff --name-only -z on stdin.
let docsOnly = false;
try {
  const paths = process.argv.length > 2 ? process.argv.slice(2) : readFileSync(0, 'utf8').replace(/\0$/, '').split('\0');
  docsOnly = paths.length > 0 && paths.every(path =>
    path.split('/').every(part => part && part !== '.' && part !== '..') &&
    // The public-assets browser test reads every file under public/, including Markdown.
    !path.startsWith('public/') &&
    (path.startsWith('design/') || path.startsWith('docs/') || path.endsWith('.md'))
  );
} catch {
  // An unreadable list must run every stage.
}
console.log(docsOnly);
