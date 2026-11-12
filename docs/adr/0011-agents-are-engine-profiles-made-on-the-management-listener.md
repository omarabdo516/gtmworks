---
status: accepted
---

# Agents are Engine profiles, made on the Engine's management listener

Ticket #293 (parent spec #284). This extends the engine contract of [ADR 0009](0009-conversations-run-on-engines-behind-one-engine-contract.md) and the bundled install of [ADR 0010](0010-hermes-ships-inside-the-gtmworks-install-and-is-the-engine.md).

## Context

The engine contract started, read and stopped a Run. gtmworks now needs to create and read an Agent (name, instructions, model). The pinned release (Hermes v0.23.0) does not serve profiles on its Run API (port 8642). It serves them on its dashboard, a FastAPI server on port 9119. The dashboard is off unless `HERMES_DASHBOARD=1` is set, and it then starts beside `hermes gateway run` in the same container and data volume. On a non-loopback bind it requires a secret, which `HERMES_DASHBOARD_SESSION_TOKEN` provides and which REST callers send as `Authorization: Bearer`. These facts were observed on the pinned image, on a scratch network, from a second container.

## Decision

- One Agent is one Engine profile, and a Run for an Agent uses the Agent's name as the profile, with the same key.
- The contract gains `createAgent({name,instructions,model})` and `readAgent(name)`. Their outcomes are values, as Runs' are. Creating gives `created`, `exists` (the name is taken), `refused` (the key), `unreachable` or `failed`. Reading gives `found`, `missing`, `refused` or `unreachable`.
- The Hermes driver creates an Agent in three steps:
  - `POST /api/profiles` with the name and the instructions as the profile's soul.
  - `PUT /api/profiles/<name>/model`, only when a model is given.
  - `PUT /api/env?profile=<name>`, setting the profile's `API_SERVER_KEY` to the connection's key. A new profile has no Run API key of its own and refuses Runs until this step runs.
- Each step must answer `ok: true`, because a 200 alone is not trusted. A model is `provider/model`, split on the first slash. A name is lower-case letters, digits, `-` and `_`, at most 64 characters.
- A create that stops part way is `failed`, and nothing rolls it back. Asking again with the same name gives `exists`, and the profile is never changed: an existing profile may belong to someone else, and giving it the key would let gtmworks into its memory. `readAgent` reports such a profile as not `ready`, which means its Run API does not accept the key, so a caller can see that no Run can start on it.
- The management listener is reached at the Engine's host on port 9119 (`http://hermes:9119` in the install). A connection may name another `managementAddress`. Both addresses pass `isHermesAddressAllowed`. No redirect is followed, and answers are read up to the same limit as a Run record. The stored Connection is unchanged, so no migration is needed.
- In `docker-compose.install.yml` the `hermes` service sets `HERMES_DASHBOARD=1` and `HERMES_DASHBOARD_SESSION_TOKEN` to the install key (`HERMES_API_KEY`). So the one install key opens both listeners, and the key rules of ADR 0008 and 0010 still hold.

## The management listener is never public

It publishes no host port, and the public gateway (`scripts/install-nginx.conf`) proxies only to the app, auth, rest and storage. Web and worker reach it on the compose network. The install job proves both on the pinned release:
- An Agent made through the contract runs.
- The worker reaches the listener with the key.
- `/api/profiles` through the gateway is the app's 404.
- Port 9119 on the install host is refused.

## Consequences

- Anyone holding the install key can manage every profile in the bundled Engine. The key stays in `.env.install`, in web and worker only, and is never logged or returned.
- Skills, memory and scheduled jobs are also served on this listener. The tickets that use them build on the same reach and key.
