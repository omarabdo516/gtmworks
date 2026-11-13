# One-session build checklist

Every reference screen and every issue taken in the one-session build (branch `gtmworks/one-session`). An item stays
`passes: false` until its proof is written next to it: a command and its result, or a screenshot path. Items are never
deleted; only `passes` flips. Screens are compared reference-left, app-right in Arabic at each width; the pairs are
saved under `/home/omar/.hermes/cache/scratch/gtm-session/shots/`.

## Reference screens

- home (Conversation with the main Agent), 1440 — passes: false
- home, 390 — passes: false
- agent-chat (Conversation with another Agent), 1440 — passes: false
- agent-chat, 390 — passes: false
- board, 1440 — passes: false
- board, 390 — passes: false
- waiting (Waiting on you), 1440 — passes: false
- waiting, 390 — passes: false
- numbers, 1440 — passes: false
- numbers, 390 — passes: false
- log (Activity log), 1440 — passes: false
- log, 390 — passes: false
- settings (overlay, Company section), 1440 — passes: false
- settings, 390 — passes: false
- agents (settings, Agents), 1440 — passes: false
- agents, 390 — passes: false
- agent (one Agent's page), 1440 — passes: false
- agent, 390 — passes: false
- account (settings, Your account), 1440 — passes: false
- account, 390 — passes: false

## Issues

- #41 Sign in with email and password (merged branch) — passes: false
- #8 The new shell: sidebar and Agent Conversation — passes: false
- #7 Remove the Agency and the reviewer Role (merged branch) — passes: false
- #49 Every release publishes a ready, tested image (merged branch) — passes: false
- #34 The board takes the six columns of the approved design — passes: false
- #16 "Waiting on you" is one list — passes: false
- #35 The numbers page — passes: false
- #11 One log for the Company, with an Activity log page — passes: false
- #51 Install gtmworks with one line — passes: false
- #52 `gtmworks update` moves from release to release — passes: false
- #2 Each company gets its own Hermes profile — passes: false
- #3 A company connects its own ChatGPT or Claude subscription — passes: false
- #47 Flaky: activity times hydrate without errors — passes: false
- #48 Flaky: drawer targets are at least 44px and do not overlap — passes: false
- #56 Flaky: prepared navigation and motion inventory — passes: false

## Team-work rules (Omar, 2026-11-13)

- a. The author of a message comes only from the signed-in session — passes: false
- b. Every server route is in a route-to-permission table; role re-checked per request — passes: false
- c. A busy Agent queues another member's message as their own next turn; stop limited — passes: false
- d. A message addressed to a person does not wake the Agent — passes: false
- e. Agent levels per company (read/draft, act on approval, scheduled), new companies at 1 — passes: false
- f. Health check warns on terminal/code/file tools in a multi-member company — passes: false
- g. A member's preference note (max 4,000 characters, no secrets) in their own Conversations — passes: false
