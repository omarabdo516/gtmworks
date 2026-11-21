# What the pinned Engine does with one Agent's Routines (#31)

Measured on 2026-11-21 on `nousresearch/hermes-agent:v0.23.0@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002`,
the image `docker-compose.install.yml` pins, through the management listener, as `lib/hermes.mjs` calls it.

A Routine is a cron job of one Agent's own profile (ADR 0016, decision of 2026-11-16). Each route takes `?profile=`
(`hermes_cli/web_routers/cron.py`: list 735, create 750, update 781, pause 786, resume 791, trigger 796, delete 806).

| Step | Answer |
| --- | --- |
| Make `ag-a` and `ag-b` | 200 each |
| Create "Ads summary" on `ag-a`, `0 9 * * *`, zone `Africa/Cairo`, deliver `local` | 200: a 12-character hex id, `profile: ag-a`, `schedule: {kind: cron, expr: "0 9 * * *"}`, `next_run_at` 09:00 +02:00 |
| List `ag-a`, then `ag-b` | each holds its own job alone, each row naming its profile |
| Pause `ag-b`'s job with `?profile=ag-a` | **200: it is paused.** The profile is a hint; the Engine acts on whichever profile holds the id (`_job_owner_profile`) |
| Pause, resume `ag-a`'s job | 200 `paused` / `enabled: false`, then 200 `scheduled` |
| Change its schedule to `30 16 * * 4` | 200, the new expression and the next Thursday 16:30 +02:00 |
| Run now (trigger) on a profile with no model | 200 with `last_run_at` set, `last_status: blocked_config` and a `last_error` that names the Engine |
| Delete it | 200 `{ok: true}`, and the list is empty |

What gtmworks does with it:

- The pause through another profile's hint is why the driver finds a job in the Agent's own list first and never sends
  an id that is not there (`lib/hermes.mjs`, `ownRoutine`); `tests/agent-routines.test.mjs` holds the fake Engine to the
  same hint rule.
- Any `last_status` other than `ok` is a run that did not finish; a `last_error` that names the Engine is not shown.

## What a Routine's run is told

Read from the same image's `cron/scheduler.py` (2504-2512, `_resolve_cron_disabled_toolsets`,
`_resolve_cron_enabled_toolsets`): a job's run loads the profile's `SOUL.md` (the Agent's instructions and the team's
rules, which gtmworks writes there), its memory and its Skills, the Company's shared Skills (`team-lessons`,
`company-knowledge`) included, through the profile's own config. Its toolsets are the profile's `cron` platform tools
minus `agent.disabled_toolsets`, so everything gtmworks keeps off for the Agent stays off; `cronjob` is always off
inside a Routine's run (`cron.allow_agent_scheduling` stays false). Not reached: the Conversation a Routine was asked
for in, and anything gtmworks adds to a Conversation's Run only (its tools such as `save_rule` or `hand_to_agent`).
The result stays on the profile (`deliver: local`).
