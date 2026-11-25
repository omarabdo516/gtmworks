| `engine-unreachable.spec.ts` | A Company whose Engine is not running says so once in Settings with no sign-in action that would fail, and a message in a Conversation is stored and stays "Not sent" with Try again (#764), formerly refused with the one plain error while staying in the box; the next message goes, with no reload, once the Engine answers (#387). | 8 s | engine-unreachable.test.mjs (the same state and refusal, without a browser) | new |

## Cases

| `engine-unreachable.spec.ts` "an Engine that is not running says so once in Settings, keeps a message not sent without recording a Run, and Try again sends it when it answers" | stays | #387: the Company's own Engine does not answer (a fake at its lane address), so Settings shows the one noEngine notice and no Connect, Disconnect or Claude command; a message keeps its text, shows the one plain error and records neither a message nor a Run; with the Engine answering again the same box sends without a reload. |
