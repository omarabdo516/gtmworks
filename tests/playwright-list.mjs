// Every spec in a `playwright test --list --reporter=json` report, in Playwright's order, each named
// `<file> › <describe> › <title>` as Playwright prints it (the file's own suite adds no title).
export function listedSpecs(report) {
  const specs = [];
  const walk = (suites, outer) => {
    for (const suite of suites ?? []) {
      const path = suite.file && suite.title === suite.file ? outer : [...outer, suite.title];
      for (const spec of suite.specs ?? []) specs.push({ name: `${spec.file} › ${[...path, spec.title].join(' › ')}`, spec });
      walk(suite.suites, path);
    }
  };
  walk(report.suites, []);
  return specs;
}
