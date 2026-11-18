| `chat-steps.spec.ts` | A reply's steps read from its Agent's Hermes session when the chat opens (#346): the fake session's tool calls on screen, done and skipped, with the turn's length, within one second of opening. | 5 s | hermes-session-steps.test.mjs (the driver), conversations.test.mjs (which reply a turn is) | new |

## Cases

| `chat-steps.spec.ts` "a reply's steps on screen are its Hermes session's, and the chat shows them within one second of opening" | stays | Read live from the Engine through the server (#346): the reply's steps come from the Agent's session on its own profile in the fake Engine, none kept in the database, and the chat shows them within one second of opening (decision 0042). `hermes-session-steps.test.mjs` guards the reading and `conversations.test.mjs` which reply each turn belongs to. |
