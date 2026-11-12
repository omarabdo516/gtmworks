---
status: accepted
---

# A company signs in its subscription in its own Engine profile

Issue #3. This builds on the management listener of [ADR 0011](0011-agents-are-engine-profiles-made-on-the-management-listener.md) and the bundled install of [ADR 0010](0010-hermes-ships-inside-the-gtmworks-install-and-is-the-engine.md).

## Context

A company's Owner connects the company's own ChatGPT or Claude subscription through Hermes's own sign-in. The sign-in must live only in that company's Hermes home. gtmworks never reads, copies, logs or shows it.

The first version ran the `hermes` command beside the web app, with one home per company under `HERMES_COMPANY_HOMES`. The shipped install has no such command: Hermes is its own container. So every Owner of an install was told sign-in is not available.

The pinned release (Hermes v0.23.0) serves provider sign-in on its dashboard, the management listener of ADR 0011. These facts were read from its source:
- Every sign-in route takes `?profile=<name>` and works in that profile's home: `hermes_cli/web_routers/oauth.py` and `hermes_cli/web_server_profiles.py:277-324`.
- A name the Engine does not know is refused with 404 (`web_server_profiles.py:190-199`). A call without a profile uses the default profile.
- A sign-in session is a random id (`oauth.py:93`). It expires after 15 minutes. It is refused for any profile other than its own (`oauth.py:921-934, 975-992`).
- Disconnect clears every credential of the provider in the profile: `oauth.py:774-815` and `hermes_cli/auth.py:1359-1380`.
- A profile made with `POST /api/profiles` and no clone option starts with an empty credential store (`hermes_cli/profiles.py:1305-1320`).
- A profile with no credential of its own for a provider reads the default profile's credential (`auth.py:813-831`).
- ChatGPT (`openai-codex`) signs in by device code: `/start` answers the link and the code (`oauth.py:502-527`).
- Claude has no dashboard sign-in. Its card is "external" (`web_server_oauth.py:139-147`), and `/submit` always refuses (`oauth.py:896-902`).

## Decision

- When the web app is wired to the bundled Engine (`BUNDLED_HERMES_MANAGEMENT_URL` with the install key), sign-in runs on the management listener. Otherwise, with `HERMES_COMPANY_HOMES`, it runs the `hermes` command as before. With neither, the route says it is not available.
- Each company has one profile that holds no Agent: `company-<company id without dashes>`. It is derived on the server from the company id only.
- The profile is created on the company's first connect. It is empty, never cloned, and its description marks it as the company's. A profile with that name and another description is not the company's: nothing is read from or done in it.
- Every sign-in call names the company's profile. No call is ever sent without a profile.
- A provider signed in on the default profile would read as connected in every company's profile. In that case the provider is `unavailable` for every company, never shown as theirs, and nothing is started or removed.
- Claude is `unavailable` to connect on this path. A Claude credential already in the company's profile shows as connected and can be removed.
- Only the state, the link and the code leave the route. The Engine's session id stays in the web app's memory until the sign-in ends.
- Engine work is bounded:
  - Reads of one company and provider share the answer being asked, and keep it for three seconds.
  - New reads have a global limit, and so do actions.
  - Each person has a limit of their own.
  - Sign-ins still waiting for a person have a global limit.
  - Past a limit the answer is 429.
  - The same limits apply to the command path.
- `docker-compose.install.yml` gives web the listener's address only. The Run API address stays the worker's, and no port is published.
- The install job runs `scripts/check-install-subscription.mjs` on the pinned release.

## Consequences

- A company's subscription is in its own profile, and an Agent runs in its own profile (ADR 0011). Using the subscription for an Agent's runs is later work.
- Claude can be connected only on the command path until a Hermes release offers it on the listener.
- The guard against the default profile depends on the install never signing that provider in on the default profile. If it does, every company sees the provider as unavailable rather than borrowing it.
- Sessions waiting for a person live in one web process's memory. After a restart, the person connects again.
