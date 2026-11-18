| `agent-attachments.spec.ts` | Files attached in the composer and replies show as thumbnails in both languages. | 12 s | attachments.test.mjs (how a file is served) | keep (#218, case by case above); the run-key case removed (#341), its member part kept |

## Cases

| `agent-attachments.spec.ts` "a file attached in the composer and in a reply shows as a thumbnail, in both languages" | stays | A real save through the server and the storage: a file from the composer and one from a reply are stored, drawn as thumbnails that load, and served by id with their bytes, type and a sandbox policy. |
| `agent-attachments.spec.ts` "a run key downloads the files of its own card and no other, and another company finds nothing" | removed | The external-agent API (keys, run keys, webhooks) is gone (#341); `app.spec.ts` "the old agent API routes answer not found" and `supabase/tests/external_agent_api_removed.sql` prove it. Its member part stays as the next case. |
| `agent-attachments.spec.ts` "a card file of another company is not found, under its address or one's own, and never signed out" | stays | Company isolation of the member file route (ADR 0004): a member of RS Learning only gets not found for Aleem's file under either Company's address, and a signed-out visitor never gets it. |
