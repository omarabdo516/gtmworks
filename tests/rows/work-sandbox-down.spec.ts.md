| `work-sandbox-down.spec.ts` | A Company whose work sandbox is not running says so in Settings in English and Arabic and stops saying it when the sandbox answers; a reply whose tool could not run shows one plain error under it while the Conversation still answers (#398). | 6 s | engine-unreachable.test.mjs (the Engine's state and the sandbox read without a browser), hermes-session-steps.test.mjs (the failed sandbox step) | new |

## Cases

| `work-sandbox-down.spec.ts` "Settings names a work sandbox that is not running in English and Arabic, and stops when it answers again" | stays | #398: one plain state in the Company section, in both languages, read once from the fake Engine's ssh workspace and gone on the next read once it answers. |
| `work-sandbox-down.spec.ts` "a reply whose command could not run because the sandbox is down says so under the reply, and a reply that needed no tool does not" | stays | #398: a reply whose session's terminal step is the Engine's degraded result carries the one plain error under it; a reply with no failed sandbox step carries none. |
