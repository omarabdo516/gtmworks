| `password.spec.ts` | Sign-in answers wrong and unknown alike; authenticator, invitation and settings password changes all work. A forgotten password is a password link (password-link.spec.ts, #954). | 21.4 s | password.test.mjs (the rule only) | keep (#218, case by case above) |

## Cases

| `password.spec.ts` "the right email and password reach the Company home; a wrong password and an unknown email get the same answer and no session" | stays | Sign-in: the right password reaches the Company home through the real auth service, and a wrong password and an unknown email get the same answer, the same status and no session cookie. `password.test.mjs` guards the password rule alone. |
| `password.spec.ts` "with a verified authenticator the password changes only after the second step in that session" | stays | Sign-in and two-step verification: with a verified authenticator the auth service refuses a password change from a first-level session, and the Settings password form, signed in with a password, asks for the code, refuses a wrong one and saves only after the right one. |
| `password.spec.ts` "an invited Member sets a password from the invitation and signs in with it later" | stays | Sign-in: an invited Member sets a password from the real invitation email and signs in with it later. |
| `password.spec.ts` "a signed-in person changes their own password in settings and signs in with the new one" | stays | Sign-in: a signed-in person changes their own password in Settings, where a confirmation that does not match is refused, and signs in with the new one. |
