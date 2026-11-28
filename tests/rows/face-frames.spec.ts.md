| `face-frames.spec.ts` | The faces' cost (#697, spec #694): sixteen Agents in the sidebar, each a 56px face moving, two of them working, on a CPU slowed four times, for ten seconds with the pointer resting near them, keep 50 frames a second or more, and add no long task (the same ten seconds with the faces off the page have as many or more). Runs in the `chat-open` job with a machine to itself, on a pull request too. The two working Agents' Conversations hold their open Engine Run on the row since #883. | 30 s | components/face-life.test.tsx (what moves and what stays still) | new (#697) |

## Cases

| `face-frames.spec.ts` "sixteen moving faces of 56px, two working, keep 50 frames a second on a CPU slowed four times, and add no long task" | stays | The faces' cost on the whole app (#697): only a real page with the sidebar's sixteen faces, their looks, their states from the database and the life module running shows what the browser pays for them, on a CPU slowed as the spec asks. |
