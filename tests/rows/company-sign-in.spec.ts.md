| `company-sign-in.spec.ts` | The Owner signs the company in to ChatGPT on the root profile of its own Engine and out; a member only sees whether it is connected; the page says one account serves one Company in both languages and shows the Claude command. | 20.9 s | company-sign-in.test.mjs (the page's line and command) | keep, changed (#384) |

## Cases

| `company-sign-in.spec.ts` "the Owner signs the company in to ChatGPT and out again; a member only sees whether it is connected" | stays | Sign-in, permissions and secrets: the Owner signs the Company in to ChatGPT on its own Engine's root profile and out again, a member sees only the state and the server refuses their start, the page never shows the credential, and the one line that one account serves one Company is there in English and Arabic. |
