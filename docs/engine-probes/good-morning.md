# How the pinned Engine's daily job reaches each Member (#183)

Measured on 2026-11-21 on `nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002`,
the image `scripts/engine-template.yml` pins, through the management listener as `lib/hermes.mjs` calls it, with the
Engine pointed at a local fake model (as `scripts/ci-install-lib.sh` does). No paid model was used.

| Step | Answer |
| --- | --- |
| Make profile `co-…`, create a job on it (`0 9 * * *`, zone `Africa/Cairo`, deliver `local`) | 200, a 12-character hex id |
| Run it now (`POST /api/cron/jobs/<id>/trigger?profile=`) with the model replying a greeting | 200; `last_status: ok` |
| `GET /api/cron/jobs/<id>/runs?profile=` | `{runs:[…]}`, newest first: each run is a `source: cron` session (`local-<hex>`) with `started_at` and `ended_at` in epoch seconds, `end_reason: cron_complete`, `message_count: 2` |
| `GET /api/sessions/<run id>/messages?profile=&order=latest` | the cron prompt as `user`, then the run's reply as `assistant`, word for word |
| The same with the model replying `[SILENT]` | a second run, `end_reason: cron_complete`, last assistant message `[SILENT]`; the Engine delivers nothing for it |

So the run's reply is readable by gtmworks after it ends, and it is recorded as the main Agent's message in a new
Conversation of each Member (not the fallback of the card at the top of the first chat of the day):

- the worker (`lib/good-morning-runs.mjs`, every 30 s) finds #182's job on the main Agent's own profile by its marker,
  lists its finished runs, reads each new run's reply once by its session (`readRoutineRuns`, `readRunReply`), and reads the
  night's results the same way from every Routine of the Company's Agents that ended since the previous message;
- `record_good_morning` stores the morning once (by its session), and a reply of `[SILENT]` is kept with no greeting and
  opens no Conversation;
- the card under the greeting is read from gtmworks's records when the Conversation is read (`lib/good-morning-card.ts`).
