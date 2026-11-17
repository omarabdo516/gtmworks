import { relative } from 'node:path';

// A skip or todo is true or its reason, which may be empty.
const marked = value => value !== undefined && value !== false;

// A node:test reporter for the CI ledger (#256): one JSON line per test, named with the suites around it. The names on
// the path come from test:start, which each file reports in order, so a nested test is named after its own parents.
export default async function* ledger(source) {
  const paths = new Map();
  for await (const { type, data } of source) {
    if (type === 'test:start') {
      const path = paths.get(data.file) ?? [];
      path.length = data.nesting;
      path.push(data.name);
      paths.set(data.file, path);
    }
    if ((type !== 'test:pass' && type !== 'test:fail') || data.details?.type !== 'test') continue;
    const parents = (paths.get(data.file) ?? []).slice(0, data.nesting);
    const outcome = marked(data.skip) || marked(data.todo) ? 'skipped' : type === 'test:pass' ? 'passed' : 'failed';
    yield `${JSON.stringify({
      suite: 'node', file: data.file ? relative(process.cwd(), data.file) : null, name: [...parents, data.name].join(' › '),
      duration_ms: data.details.duration_ms, outcome, retries: 0,
    })}\n`;
  }
}
