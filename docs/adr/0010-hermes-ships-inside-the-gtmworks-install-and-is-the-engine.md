---
status: accepted
---

# Hermes ships inside the gtmworks install and is the engine

Omar's decision of 2026-11-11, ticket #282. This supersedes the Codex and Claude Code drivers planned in [ADR 0009](0009-conversations-run-on-engines-behind-one-engine-contract.md). The engine contract of ADR 0009 stays; Hermes is its driver.

[ADR 0012](0012-no-agency-layer-the-company-owner-manages-the-company.md) (#7): every Agency owner below is now the Company's Owner.

## Context

ADR 0008 had each person install gtmworks beside their own Hermes and paste its address, profile and key. ADR 0009 then planned Codex and Claude Code drivers so that Hermes would not be required. Hermes already provides memory, routines, several agents, skills, approvals and subscription sign-in. Rebuilding those around other engines would cost more than shipping Hermes, and a person who has never heard of Hermes should be able to install gtmworks alone.

## Decision

- The self-hosted install (`docker-compose.install.yml`) runs Hermes's official release image, `nousresearch/hermes-agent`, pinned by tag and digest. Bumping it is a one-line change to that image, together with the version the driver accepts (`hermesVersion` in `lib/hermes.mjs`); `tests/bundled-hermes.test.mjs` fails on a digest-less image or a mismatched version, and the install test brings the pinned release up.
- Hermes's API server is switched on with an install-generated key (`HERMES_API_KEY` in `.env.install`, created by `lib/install-env.mjs` like the other secrets, added to an older install's file by this installer's `update`, `backup` or `restore`, which then require it). The app and the installer before this ADR accept a file with no key yet, so an update they start still succeeds; the app then simply has no bundled Hermes until the next update. Hermes refuses to start without a key. It listens on the compose network only and publishes no host port. Its data lives in the `hermes` named volume.
- Nobody pastes a Hermes address or key. On a self-hosted install the worker gives each company that has no Hermes Connection or agent one Connection to the bundled Hermes (`http://hermes:8642`, profile `default`), owned by the Agency owner, and a default agent on it. It tests Hermes first through the existing driver, which fails closed, and stores the key encrypted as ADR 0008 requires. A pasted Connection is never replaced.
- Hosted installs are unchanged: the worker provides nothing without `GTMWORKS_SELF_HOSTED=true` and the bundled address, and the address check (`isHermesAddressAllowed`) is unchanged.
- Codex and Claude Code drivers are no longer planned. The engine contract (`lib/engine.mjs`) and its fake stay, so conversation code still never calls Hermes's API directly.
- Hermes's MIT notice ships in `THIRD_PARTY_NOTICES.md`. gtmworks copies no Hermes code.

## Consequences

- The install guide has no Hermes step, and the install test sends an Arabic message to the bundled Hermes, answered by a fake model provider, so CI needs no subscription.
- The companies of one install share the bundled `default` profile and so its memory. An Agency owner who needs a company's memory kept apart connects a separate Hermes profile for it, as ADR 0008 allows. Separate profiles per company inside the bundled Hermes need a later ticket.
- A model provider and its sign-in are configured in Hermes; gtmworks still holds no model credentials.
- `install.sh backup` does not include the `hermes` volume yet, so Hermes's memory and sign-in are not restored with a backup.
- Everything ADR 0008 says about the Hermes driver still holds.
- [ADR 0011](0011-agents-are-engine-profiles-made-on-the-management-listener.md) (#293) switches on Hermes's management listener (port 9119) with the same key, also on the compose network only, to create Agents as profiles.
