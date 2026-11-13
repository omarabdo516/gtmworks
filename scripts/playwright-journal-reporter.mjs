// A Playwright reporter that appends one JSON line per event and writes each line before the hook returns, so a run
// stopped before onEnd (a cancelled CI job, a killed process) still leaves what it selected and observed on disk.
// Playwright's own JSON report is written only in onEnd. Format and states: docs/ci-test-journal.md.
// Options: invocation (main, proxy) and outputFile, relative to the config's directory.
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { record, runIdentity } from './playwright-journal.mjs';

// Repository-relative with forward slashes; a file outside the repository keeps no path beyond its name.
function repoPath(root, file) {
  const path = relative(root, file);
  return (path.startsWith('..') || isAbsolute(path) ? file.split(sep).at(-1) : path).split(sep).join('/');
}

export default class PlaywrightJournal {
  constructor({ configDir = process.cwd(), invocation = 'main', outputFile = `playwright-report/journal-${invocation}.jsonl` } = {}) {
    this.root = configDir;
    this.invocation = invocation;
    this.file = resolve(configDir, outputFile);
    // Written as Playwright starts, before its web server: a run stopped while the server boots is not "never started".
    this.write('launch', { invocation, run: runIdentity() }, 'w');
  }

  printsToStdio() { return false; }

  // A journal that cannot be written must not change a test's outcome: one warning, then the journal stops.
  write(kind, fields, flag = 'a') {
    if (this.broken) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const fd = openSync(this.file, flag);
      try { writeSync(fd, JSON.stringify(record(kind, fields)) + '\n'); } finally { closeSync(fd); }
    } catch (error) {
      this.broken = true;
      console.error(`playwright-journal: cannot write ${this.file} (${error.code ?? 'error'}); the journal stops here`);
    }
  }

  identity(test) {
    const titles = [test.title];
    for (let suite = test.parent; suite?.type === 'describe'; suite = suite.parent) titles.unshift(suite.title);
    return { project: test.parent?.project()?.name ?? '', file: repoPath(this.root, test.location.file), line: test.location.line, title: titles.join(' › ') };
  }

  onBegin(config, suite) {
    const tests = suite.allTests();
    this.write('begin', { invocation: this.invocation, root: repoPath(this.root, config.rootDir), selected: tests.length });
    for (const test of tests) this.write('selected', { ...this.identity(test), retries: test.retries });
  }

  onTestBegin(test, result) {
    this.write('started', { ...this.identity(test), retry: result.retry });
  }

  onTestEnd(test, result) {
    this.write('finished', { ...this.identity(test), retry: result.retry, status: result.status, expected: test.expectedStatus, duration: Math.round(result.duration) });
  }

  onEnd(result) {
    this.write('end', { status: result.status });
  }
}
