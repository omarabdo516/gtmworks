---
status: accepted
---

# gtmworks connects directly to Hermes with encrypted profile keys

Partly superseded by [ADR 0009](0009-conversations-run-on-engines-behind-one-engine-contract.md) (#274): Hermes is now one driver behind the engine contract, not the only engine. The rules below still hold for the Hermes driver.

Omar's direction change on #184 (2026-11-09), approved ticket #241 (2026-11-11), supersedes the runtime-neutral dispatch direction in ADR 0006/0007. gtmworks is self-hosted beside Hermes and runs no model or agent engine.

- An Agency owner, after two-step verification, connects an HTTP(S) address, profile and bearer key. Private and loopback addresses are allowed. Redirects are not followed with a key.
- Hermes keys are not model credentials. They are encrypted with AES-256-GCM using the install's existing `WEBHOOK_ENCRYPTION_KEY`; the web server decrypts only to call Hermes. Backups require that encryption key. No saved key, suffix, ciphertext or remote error body is returned or logged.
- All outgoing Hermes API calls belong in `lib/hermes.mjs`. Connect and Test connection read `/p/<profile>/v1/capabilities` and `/p/<profile>/health` (the version source; capabilities has no version, as verified in the installed Hermes API server source). Only the live-checked v0.23.0 contract is enabled; other or missing versions fail closed with an untested-version state and no offered agent features.
- A Connection records its Agency owner separately from its company context. RLS permits only that Agency owner to mutate it; a non-Agency company Owner may read its safe state. Another Agency owner sees no Connection, even with agency-wide company access. This install has no separate Agency organisation table; #242 supplies company/agent selection and default-agent behaviour, not a new agent engine.
- Hermes owns agents, settings, skills, scheduled work, connections and memory. gtmworks owns companies, members, marketing cards and stages, versions, approvals, library, results and its append-only record of conversations as seen by people. Legacy agent APIs remain transitional; new conversations call Hermes and relay events (#190).
- Agents do not approve, publish or spend at this stage. Opening those permissions later needs Omar's separate decision.

## Company agents (#242)

- Company assignments carry a free name, speciality and default flag, separately from the encrypted Connection. Members read only assignments in their companies; only a verified Agency owner attaches their Connections or changes assignments.
- A profile is identified by its normalized Connection address and profile name. Reusing it in another company requires explicit confirmation that Hermes's per-profile memory may carry company facts across; the company audit records the confirming person. This also applies to separate Connections naming the same profile.
- The first assignment becomes default. A unique partial index enforces at most one default; assignment writes are serialized in one checked RPC. Removing a default with remaining agents requires a successor from the same company.
- An attached Connection may replace its key or refresh its state, but must be detached before its address/profile changes or it is deleted. This prevents bypassing the sharing warning by retargeting a Connection. Default selection is available to the conversation work in #190; this ticket adds no conversation engine.
