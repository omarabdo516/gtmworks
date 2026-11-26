| `agent-conversation.spec.ts` | Two people reply inside one card, in order, labelled, each in its own direction. | 3.9 s | — | keep (#218, case by case above) |

## Cases

| `agent-conversation.spec.ts` "two people reply inside one card, in order, each labelled and in its own direction" | stays | Rewritten by spec #695, whose fixtures are people: a direction check, and a real save through the page: a Contributor's message (written in the database, #341) and a person's reply are stored in order on one Card, each labelled, and each body picks its own direction (ltr for English, rtl for Arabic). Direction checks stay (#218). |
