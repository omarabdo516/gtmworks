---
status: accepted
---

# Team-work rules in Conversations

Omar's rules of 2026-11-13 (a, b, c, d, g; ideas from OpenClaw, MIT, no code copied), with the lead's decisions on the review of 2026-11-14. Migrations `20261211000000_team_work` and `20261211000001_team_work_retries`. Everything in ADR 0009 and ADR 0014 still holds.

## Decision

- **Author.** Who wrote a message, comment, note or card activity comes from the signed-in session (`auth.uid()` in the database), never from the request.
- **One permission table.** Every route file and server action is listed in `lib/route-permissions.mjs` with the least role it needs. An entry that is missing or misspelled needs Owner. The role is read from `members` on every request, never from a cookie or a token claim. The database still checks the finer rules.
- **Turns per Conversation.** A Conversation stays private to the person who started it (GLOSSARY). While the Agent is working there, a new message waits as its sender's own next turn and is never merged into the running one. It starts after the open run ends. Everyone reading the Conversation sees who the Agent is working for. The rule is per Conversation: one Member's own Conversations with the same Agent, and different Members' Conversations, may run at the same time.
- **Stop.** Only the person who started the open run, or a Manager or Owner of the Company, may stop it. The database checks this.
- **Messages to a person.** A message that starts with @ and an active Member's name is kept as a note to that Member, and no run starts. A Member that is an Agent, or a name one of the Company's Agents carries, is never a person. A repeated send key keeps its first answer.
- **Member notes.** Each Member keeps one note of preferences per Company, at most 4,000 characters, refused when it looks like a password, key or token (also when the name is quoted, as in JSON, YAML or .env, and when the credentials are inside an address). Only that Member reads or writes it. It goes to the engine with that Member's own runs, as the run's instructions (Hermes v0.23.0 `instructions`, a prompt for that run that is not stored in its session). The note a run was first reserved with is pinned and sent again unchanged on every retry, because Hermes refuses another request body for the same idempotency key.
- **Unknown starts.** A start whose answer was lost may have started the run. It keeps its reservation and is asked again with the same idempotency key and body until the engine says what happened. Only a definite refusal releases a direct send's reservation or fails a queued turn.

## Consequences

- Notes are not secret by design. gtmworks keeps a note out of the Company's memory, but the Agent's memory tool runs in the Company's one profile (ADR 0014), so the Agent may still remember a preference it read and use it for the whole team. The settings screen says so.
- A note sent to a person notifies nobody yet; the Conversation is private, so only its own person sees it.
- A queued turn waits as long as the open run before it stays open, for example while the engine cannot be reached.
