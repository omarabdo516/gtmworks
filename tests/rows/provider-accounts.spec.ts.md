| `provider-accounts.spec.ts` | Two ChatGPT subscriptions, a Claude one and an API key are four Providers of one Company (#618): the Owner names the second ChatGPT and the key, reloads, and each name stays with its own Provider in the page and the database, with no credential, token tail or Engine label drawn; a Manager reads the names with no control and the server refuses their rename and their disconnect; another Company reads none of them. | 15 s | provider-names.test.mjs and supabase/tests/provider_names.sql (the rename per Role and Company); company-profiles.test.mjs (the accounts the server reads) | new |

## Cases

| `provider-accounts.spec.ts` "the Owner names two subscriptions of one kind and a key apart, and the names stay after a reload" | stays | Providers: two subscriptions of one kind and a key read apart, are named one by one, and keep their names after a reload; no secret is drawn. |
| `provider-accounts.spec.ts` "a Manager reads the names with no control, and the server refuses their rename and their disconnect" | stays | Permissions: a Manager reads the Providers' names only, and the server refuses a rename and a disconnect of one account. |
| `provider-accounts.spec.ts` "another Company reads none of these names" | stays | Isolation: one Company's Provider names never reach another's page. |
