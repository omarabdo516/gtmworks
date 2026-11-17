// Labels a red job (#256, spec #255 D12): infrastructure when the job ended on a known signature, else "your change".
// A `fatal` cause counts only where the job ended: the last lines of the first failed step, as the tool that failed
// printed them. That leaves out every other step (an upload after the failure can hit its own rate limit, a cleanup before
// it may report a busy port it then freed), the failures a test reporter annotated in a script step (a test may meet a 429
// on purpose), and anything indented, which is how a failed test prints what it saw. On 2026-11-16 every database job with
// `Rate exceeded` retried the pull, started and failed on pgTAP far below it, so a whole-log search would pass real failures
// off as infrastructure. A `job` cause counts anywhere: Chrome reports a network change only when the host's network
// changes, which makes every failure in that job suspect (#241), and only the runner prints its shutdown. No scope reads a
// line of a printed JSON document (a hosted job printed the pull request's body, which quoted the network change) or a
// line quoted from another log (a failed classifier test prints its fixture). A step whose tests ran and failed ended on
// them, whatever their messages name, and a rate limit is not why the step failed when the image it held up was then
// downloaded (pulls run side by side, so another layer's or image's progress proves nothing).
const rules = [
  {
    cause: 'registry rate limit', scope: 'fatal', pattern: /error from registry: Rate exceeded|toomanyrequests|^npm (?:error|ERR!) (?:code E429|429 Too Many Requests)/i,
    recovered: (lines, at) => {
      // The retry names the image it pulls again; only that image finishing proves this pull got past the limit.
      const image = lines.slice(at + 1, at + 4).map(line => line.match(/^Retrying after \S+: (\S+)$/)?.[1]).find(Boolean);
      return image != null && lines.slice(at + 1).some(line => [`Status: Downloaded newer image for ${image}`, `Status: Image is up to date for ${image}`].includes(line.trim()));
    },
  },
  { cause: 'network change', scope: 'job', pattern: /net::ERR_NETWORK_CHANGED/ },
  { cause: 'runner shutdown', scope: 'job', pattern: /^##\[error\]The runner has received a shutdown signal/ },
  { cause: 'port in use', scope: 'fatal', pattern: /address already in use|port is already allocated/ },
];
const stamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z /;
const quoted = /^\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z /;
const jsonField = /^\s*"[^"]+": "/;
const exit = '##[error]Process completed with exit code';
const window = 30;
const width = 200;

// One entry per line: its text without the runner's time stamp, and whether the runner stamped it (an annotation's
// continuation lines are not stamped).
function entries(text) {
  return String(text ?? '').replace(/^﻿/, '').replaceAll('\r', '').split('\n')
    .map(line => ({ text: line.replace(stamp, ''), stamped: stamp.test(line) }));
}

// A step starts at its `##[group]Run` line; an action's step names `owner/action@version`, or a path inside the action.
function steps(lines) {
  const found = [{ action: false, lines: [] }];
  for (const line of lines) {
    if (line.text.startsWith('##[group]Run ')) found.push({ action: /^##\[group\]Run [\w.-]+(?:\/[\w.-]+)+@/.test(line.text), lines: [] });
    found.at(-1).lines.push(line);
  }
  return found;
}

const readable = line => !jsonField.test(line.text) && !quoted.test(line.text);
const colour = /\u001b\[[\d;]*m/g;
// The summary line each test runner prints when a test failed: Vitest, Playwright, node:test, pg_prove.
const testsFailed = /^\s*Tests\s+\d+ failed|^\s*\d+ failed$|^ℹ fail [1-9]|^Result: FAIL$/;

// Which of the steps that ran failed, from the job's steps as the API lists them: the runner's own set-up, post and
// complete steps print no `##[group]Run` line, and a skipped step prints nothing, so the rest line up with the log's.
export function failedStep(apiSteps) {
  const ran = (apiSteps ?? []).filter(step => step.conclusion !== 'skipped' && !/^(Set up job|Complete job|Post )/.test(step.name));
  const index = ran.findIndex(step => step.conclusion === 'failure');
  return index < 0 ? null : index;
}

// Without the API's steps, the failed step is the first that exited non-zero or whose action printed an error.
function fatalLines(lines, index) {
  const all = steps(lines);
  const failed = index == null
    ? all.find(step => step.lines.some(line => line.text.startsWith(exit)) || (step.action && step.lines.some(line => line.text.startsWith('##[error]'))))
    : all[index + 1];
  if (!failed || failed.lines.some(line => testsFailed.test(line.text.replace(colour, '')))) return [];
  const own = failed.lines.slice(0, failed.action ? undefined : failed.lines.findIndex(line => line.text.startsWith(exit)));
  const kept = [];
  for (let n = 0; n < own.length; n++) {
    if (!failed.action && own[n].text.startsWith('##[error]')) {
      while (n + 1 < own.length && !own[n + 1].stamped) n++;
      continue;
    }
    if (readable(own[n]) && !/^\s/.test(own[n].text)) kept.push(own[n].text);
  }
  return kept.slice(-window);
}

const recoveredAt = (lines, at, recovered) => recovered != null && recovered(lines, at);

// A long line keeps the matched words: the cut starts shortly before them when they lie past the first 200 characters.
function excerpt(line, pattern) {
  const text = line.trim();
  if (text.length <= width) return text;
  const at = text.search(pattern);
  const start = Math.max(0, Math.min(at - 40, text.length - width));
  return (start ? '…' : '') + text.slice(start, start + width);
}

// `failedStep`: which of the steps that ran failed (failedStep() above), when the caller has the job's steps.
export function classify(text, { failedStep: index = null } = {}) {
  const lines = entries(text);
  const scopes = { job: lines.filter(readable).map(line => line.text), fatal: fatalLines(lines, index) };
  for (const { cause, scope, pattern, recovered } of rules) {
    const found = scopes[scope];
    const at = found.findIndex((candidate, n) => pattern.test(candidate) && !recoveredAt(found, n, recovered));
    if (at >= 0) return { label: 'infrastructure', cause, evidence: excerpt(found[at], pattern) };
  }
  return { label: 'your change', cause: null, evidence: null };
}
