| `message-sending.spec.ts` | A Conversation with Lead on the lane's fake Hermes whose start of a Run is answered 3 seconds late (#756): the message sent is drawn within 200 ms of the press, measured in the page, as the page's own drawing of it (`sending`), with the line under the transcript reading "Thinking…"; once the reply lands the message is there once, the stored one. | 15 s | components/message-sending.test.tsx (the screen, the refusal and the channel) | new (#756) |

## Cases

| `message-sending.spec.ts` "a message sent while the Engine is slow to start its Run is on screen at once, the line reads Thinking, and it is there once after the reply" | stays | The whole path of #756: the send's POST waits on the Engine's start, and the page does not. |
