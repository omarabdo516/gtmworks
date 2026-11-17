// Labels a red job (#256, spec #255 D12): infrastructure when the job ended on a known signature, else "your change".
// A `fatal` cause counts only where the job ended: the last lines the first failed step printed before its exit, leaving
// out the failures a test reporter annotated there (a test may meet a 429 or a busy port on purpose) and every step after
// it (an upload can hit its own rate limit). On 2026-11-16 every database job with `Rate exceeded` retried the pull,
// started and failed on pgTAP, so a whole-log search would pass real failures off as infrastructure. A `job` cause counts
// anywhere: Chrome reports a network change only when the host's network changes, which makes every failure in that job
// suspect (#241), and only the runner prints its shutdown. A line of a printed JSON document is data the job logged, not
// an event: a hosted job printed the pull request's body, which quoted the network change.
const rules = [
  { cause: 'registry rate limit', scope: 'fatal', pattern: /error from registry: Rate exceeded|toomanyrequests/i },
  { cause: 'network change', scope: 'job', pattern: /net::ERR_NETWORK_CHANGED/ },
  { cause: 'runner shutdown', scope: 'job', pattern: /##\[error\]The runner has received a shutdown signal/ },
  { cause: 'port in use', scope: 'fatal', pattern: /address already in use|port is already allocated/ },
];
const stamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z /;
const jsonField = /^\s*"[^"]+": "/;
const before = 5;
const width = 200;

function fatalLines(lines) {
  const end = lines.findIndex(line => line.includes('##[error]Process completed with exit code'));
  if (end < 0) return [];
  const annotated = new Set();
  lines.slice(0, end).forEach((line, index) => {
    if (!line.includes('##[error]')) return;
    annotated.add(index);
    for (let n = index + 1; n < end && !stamp.test(lines[n]); n++) annotated.add(n);
  });
  const kept = [];
  for (let n = end - 1; n >= 0 && kept.length < before; n--) if (!annotated.has(n)) kept.unshift(lines[n]);
  return kept;
}

// A long line keeps the matched words: the cut starts shortly before them when they lie past the first 200 characters.
function excerpt(line, pattern) {
  const text = line.replace(stamp, '').trim();
  if (text.length <= width) return text;
  const at = text.search(pattern);
  const start = Math.max(0, Math.min(at - 40, text.length - width));
  return (start ? '…' : '') + text.slice(start, start + width);
}

export function classify(text) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').replaceAll('\r', '').split('\n');
  const scopes = { job: lines.filter(line => !jsonField.test(line.replace(stamp, ''))), fatal: fatalLines(lines) };
  for (const { cause, scope, pattern } of rules) {
    const line = scopes[scope].find(candidate => pattern.test(candidate));
    if (line !== undefined) return { label: 'infrastructure', cause, evidence: excerpt(line, pattern) };
  }
  return { label: 'your change', cause: null, evidence: null };
}
