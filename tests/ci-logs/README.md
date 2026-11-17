# Failed CI job logs for `ci-classify.test.mjs`

Excerpts of real failed jobs of omarabdo516/gtmworks on 2026-11-16, named `<job>-<job id>.log`. Each keeps the log's
own lines in their order: the first three lines, every line that names a known signature with one line on each side
(the first three of each), every `##[error]` annotation with its continuation lines, and the 15 lines before each
`##[error]Process completed` line. `[excerpt: lines omitted]` marks a cut.

| Log | What ended the job |
|---|---|
| `database-133592988053`, `-133596593734`, `-133600998199`, `-133607458789`, `-133614975910`, `-133627087516`, `-133630248163` | failed pgTAP or migration tests; each `Rate exceeded` pull was retried and went through |
| `database-133610408482` | failed pgTAP tests, no rate limit |
| `database-133269529029` | the stack's database port held by another job (#216) |
| `integration-133515802171`, `-133560059656`, `-133569580338`, `-133574814781`, `-133580631427`, `-133585741295`, `-133592987843` | the browser's network changed on the PC (#241) |
| `integration-133545390129` | the runner received a shutdown signal |
| `integration-133640016093` | the browser could not start inside the change under test (`unshare` refused) |
| `integration-133599861446` | a hosted run: a request reset by the app under test |

`constructed-registry-rate-limit.log` is not one job's log. No job that day ended on the rate limit, so it joins real
lines of `database-133592988053`: its pull up to `Rate exceeded`, then that job's own last two lines.

`constructed-test-failure-429.log` is not one job's log either. It is the first lines of `integration-133640016093`,
then a failed browser test whose own error is a 429 answer from the app, the job's end, and an upload step after it that
failed on a rate limit. Its label must stay "your change".
