| `hermes-agents.spec.ts` | The Owner chooses the main Agent and removes one after naming its successor, nothing is attached by hand (#342); concurrent changes serialize; every role sees only its own company's agents. | 42.4 s | engine-agents.test.mjs (the driver) | keep (#218, case by case above) |

## Cases

| `hermes-agents.spec.ts` "the Owner connects, names and attaches an agent, confirms profile sharing and chooses a successor on removal" | removed | #342: no Agent is attached by hand any more; its successor journey is the case below. |
| `hermes-agents.spec.ts` "the Owner makes another Agent the main one and removes the main one only after choosing its successor; nothing is attached by hand" | stays | Permissions and a journey through the server: the Owner moves the main mark, a removal of the main Agent waits for its successor, the log names both, and no form or route attaches an Agent (#342). |
| `hermes-agents.spec.ts` "integration: concurrent default changes and first attachments serialize, and sharing cannot race confirmation" | removed | #342: attachments and profile sharing are gone; the race of default changes is the case below. |
| `hermes-agents.spec.ts` "integration: concurrent default changes serialize, so the Company keeps exactly one main Agent" | stays | Company isolation under concurrent requests: two default changes at once leave exactly one main Agent. |
| `hermes-agents.spec.ts` "isolation: every company role sees only its own agents; only an Owner changes assignments, and never another company's" | stays | Company isolation and permissions: each Role sees only its own Company's Agents and gets not found for another's, and only an Owner, also one who did not make the Connection, changes assignments, with the audit naming them. |
