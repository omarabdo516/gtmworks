# Failed CI job logs for `ci-classify.test.mjs`

Excerpts of real failed jobs of omarabdo516/gtmworks on 2026-11-16, named `<job>-<job id>.log`. Each keeps the log's
own lines in their order: the first three lines, each step's `##[group]Run` line, every line that names a known signature
with one line before and three after (the first four of each), every `##[error]` annotation with its continuation lines,
and the 40 lines before each `##[error]Process completed` line. `[excerpt: lines omitted]` marks a cut.

| Log | What ended the job |
|---|---|
| `database-133592988053`, `-133596593734`, `-133600998199`, `-133607458789`, `-133614975910`, `-133627087516`, `-133630248163` | failed pgTAP or migration tests; each `Rate exceeded` pull was retried and went through |
| `database-133610408482` | failed pgTAP tests, no rate limit |
| `database-133269529029` | the stack's database port held by another job (#216) |
| `integration-133515802171`, `-133560059656`, `-133569580338`, `-133574814781`, `-133580631427`, `-133585741295`, `-133592987843` | the browser's network changed on the PC (#241) |
| `integration-133545390129` | the runner received a shutdown signal |
| `integration-133640016093` | the browser could not start inside the change under test (`unshare` refused) |
| `integration-133599861446` | a hosted run: a request reset by the app under test |

The `constructed-` logs are not one job's log. No job that day ended on these cases, so each joins real lines (the first
lines of a real log and its step lines) with the output a tool prints in that case. Their labels:

| Log | Case | Label |
|---|---|---|
| `constructed-registry-rate-limit` | `supabase start` gives up on a rate limit, then prints 7 lines before its exit | registry rate limit |
| `constructed-action-rate-limit` | `docker/build-push-action` fails on `toomanyrequests`, with no exit line of its own | registry rate limit |
| `constructed-npm-429` | `npm ci` in `./ci.sh static` refused with `E429` | registry rate limit |
| `constructed-test-failure-429` | a failed browser test whose own error is a 429, then an upload that hit a rate limit | your change |
| `constructed-short-failed-step` | a cleanup step reports a busy port it freed; the next step fails in two lines | your change |
| `constructed-node-test-port` | a failed node test prints a Docker port message it was given | your change |
| `constructed-quoted-shutdown` | a failed classifier test prints its shutdown and network-change fixture | your change |
