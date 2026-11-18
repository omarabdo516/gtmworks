| `agent-conversation.spec.ts` | People and agents reply inside one card, in order, labelled, each in its own direction. | 3.9 s | — | keep (#218, case by case above) |

## Cases

| `agent-conversation.spec.ts` "people and agents reply inside one card, in order, each labelled and in its own direction" | stays | A direction check, and a real save through the page: an Agent's message (written in the database, #341) and a person's reply are stored in order on one Card, each labelled, and each body picks its own direction (ltr for English, rtl for Arabic). Direction checks stay (#218). |
