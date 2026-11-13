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
| `selected` | once per selected test | `project`, `file` (repository-relative), `line`, `title` (describe titles and the test title, joined by ` › `), `repeatEachIndex`, `retries` |
| `started` | an attempt starts | the test's identity, `retry` |
| `finished` | an attempt ends | the test's identity, `retry`, `status` (`passed`, `failed`, `timedOut`, `skipped`, `interrupted`), `expected` (the status Playwright expected), `duration` (ms) |
| `end` | the run ends | `status` (`passed`, `failed`, `timedout` when the run reached its global time limit, `interrupted`) |

A test's timeout is `timedOut` and the run's is `timedout`: Playwright's own spellings (`TestResult.status` and
`FullResult.status`). Each is accepted only in its own record kind.

A test's identity is `project`, `file`, `line`, `title` and `repeatEachIndex` (Playwright's `TestCase.repeatEachIndex`,
0 unless `--repeat-each` runs a test more than once). Each repetition is its own case; `retry` counts the attempts of
one repetition. `repeatEachIndex` is a compatible addition to version 1: a line written before it existed lacks the
field and is still read, with the repetition unobserved (`null`), never assumed to be 0. A line that has the field with
anything but a non-negative whole number is malformed.

A line cut off by a killed process, or any line that is not exactly such a record (including one whose `kind` is not
one of the six above), is counted as `malformed` and ignored; the lines after it are still read.

## States

- **not-started**: no `launch` line. `results.json` says `notRun` only when every invocation is not-started.
- **interrupted**: launched, but no `end`, or an `end` that is neither `passed` nor `failed`.
- **complete**: an `end` that is `passed` or `failed`.

Each selected test gets one outcome, from its observed attempts only:

- final: `expected`, `unexpected`, `flaky`, `skipped` (Playwright's own words);
- unknown: `interrupted` (its last attempt started and did not finish, or Playwright marked it interrupted),
  `retry-pending` (it failed with a retry left and the run did not complete: no `end`, or an `interrupted` or
  `timedout` end, which stops scheduling and so cannot show the retry was never due), `not-started` (its identity
  was recorded but no attempt started).

A run can also stop while it is still writing its `selected` lines. `unrecordedSelected` counts the selected cases
whose identity was never written (`selected` minus the cases recorded by name; `null` before `begin`, while the
selection itself is unknown). They are unknown too, but nothing is said about them: no name, start or outcome. So
final outcomes + named unknown outcomes + `unrecordedSelected` = `selected`.

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

`execution.json` (and the `execution` field) holds, per invocation: `state`, `endStatus`, `selected`,
`unrecordedSelected`, `started`, `outcomes`, `unknown` counts, `attempts`, `malformed` and `unknownCases` (the identity
and outcome of every recorded case without a final outcome).

## Unknown outcomes in Playwright's own report

After a graceful stop or a run that reached its global time limit, Playwright still writes its own `results.json`, and
there a test whose first attempt failed and whose retry never finished is `unexpected`: Playwright 1.64.1 leaves the
cut-off attempt out of the outcome. That attempt shows as `interrupted` after a graceful stop and as `skipped` after a
global time limit (where the journal has its start and no end). A test that failed with a retry left, when the run
stopped before the retry, is `unexpected` too.

So before `compare-failures` collects the failures of a report with an interrupted `execution` field, it takes out
the red tests the journal names as unknown, by project, file (the journal's repository-relative path without its test
`root`), line and full title:

- a red test whose last attempt was cut off (`interrupted` or `skipped`), against the journal's `interrupted` cases;
- any other red test, against the journal's `retry-pending` cases.

Playwright's JSON has one spec per repetition and no repeat index, so repetitions of one test share an identity there.
Each journal unknown takes out at most one red test of its own kind: a repetition that failed every attempt keeps the
name even when another repetition of it is unknown. A report the journal built already says `unknown`, and a report
without an `execution` field (a complete run, an older one) is read as before. `flaky-tests` needs no such step: it
lists only `flaky`, and an unfinished retry is never that.

When the latest main run was interrupted, `compare-failures` names a PR failure that main also showed failing as
inherited, and one main never showed as **unknown on main**, a separate list and section: main stopped before it had an
outcome there, so it is not called this PR's own. Against a complete main run the two lists are as before.

The journal records evidence only. The required `check` still follows the `integration` job's own result, so an
interrupted or failed suite stays red.
