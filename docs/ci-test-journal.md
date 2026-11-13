# The Playwright execution journal

Playwright writes its JSON report (`playwright-report/results.json`) only when a suite finishes. A CI job that is
cancelled or killed mid-suite leaves no report, and the tests it already ran would be lost. Each Playwright invocation
therefore also appends a journal, one JSON line per event, written before the reporter hook returns:
`playwright-report/journal-main.jsonl` for the main suite and `playwright-report/journal-proxy.jsonl` for the
production-shaped suite (`scripts/playwright-journal-reporter.mjs`).

After the suites, CI runs `node scripts/playwright-journal.mjs playwright-report`, which writes `execution.json` and makes
`results.json` truthful. The `playwright-report` artifact holds all three.

## Records (version 1)

Every line has `v` (1) and `kind`, and only the fields listed here. The reporter builds each line from this list and the
reader ignores a line with any other field or value, so error text, console output, attachments, annotations, test
parameters, URLs and environment values are never written.

| kind | when | fields |
| --- | --- | --- |
| `launch` | Playwright starts, before its web server | `invocation`, `run` (`id`, `attempt`, `sha`: the CI run, its attempt and the commit; `null` outside CI or when not in the expected shape) |
| `begin` | the tests are selected | `invocation`, `root` (the test directory), `selected` (how many) |
| `selected` | once per selected test | `project`, `file` (repository-relative), `line`, `title` (describe titles and the test title, joined by ` › `), `retries` |
| `started` | an attempt starts | the test's identity, `retry` |
| `finished` | an attempt ends | the test's identity, `retry`, `status`, `expected` (the status Playwright expected), `duration` (ms) |
| `end` | the run ends | `status` (`passed`, `failed`, `timedOut`, `interrupted`) |

A line cut off by a killed process, or any line that is not exactly such a record, is counted as `malformed` and ignored.

## States

- **not-started**: no `launch` line. `results.json` says `notRun` only when every invocation is not-started.
- **interrupted**: launched, but no `end`, or an `end` that is neither `passed` nor `failed`.
- **complete**: an `end` that is `passed` or `failed`.

Each selected test gets one outcome, from its observed attempts only:

- final: `expected`, `unexpected`, `flaky`, `skipped` (Playwright's own words);
- unknown: `interrupted` (its last attempt started and did not finish, or Playwright marked it interrupted),
  `retry-pending` (it failed with a retry left and the run did not complete: no `end`, or an `interrupted` or
  `timedOut` end, which stops scheduling and so cannot show the retry was never due), `not-started`.

An unknown outcome is never counted as passed or failed.

## What `results.json` becomes

- Playwright wrote it and the main suite is complete: it stays byte for byte.
- Playwright wrote it and the main suite was interrupted (a graceful stop): it gains an `execution` field.
- It is missing or unreadable and no invocation started: `{"notRun": true, "suites": [], "execution": …}`.
- It is missing or unreadable, the main suite never started, but another invocation (the proxy suite) did:
  `{"suites": [], "execution": …}` with `execution.invocations.main.state` `not-started`. No main case is invented;
  `compare-failures` says the main suite did not start and names what the other invocation observed.
- It is missing or unreadable and the main suite started: the journal's report, with `"source": "journal"`. Cases
  without a final outcome have status `unknown`, which `compare-failures` and `flaky-tests` read as neither failed,
  passed nor flaky, and both say the run stopped before it finished.

`execution.json` (and the `execution` field) holds, per invocation: `state`, `endStatus`, `selected`, `started`,
`outcomes`, `unknown` counts, `attempts`, `malformed` and `unknownCases` (the identity and outcome of every case without a
final outcome).

The journal records evidence only. The required `check` still follows the `integration` job's own result, so an
interrupted or failed suite stays red.
