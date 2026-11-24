# The Card, the board and archiving: approved prototype

Approved by Omar on 2026-11-23 (third round in Open Design). It is the reference for the Card, the board, New card, All conversations, and archiving a Conversation or a team channel; `design-reference/` stays the reference for every other screen. The other screens in this copy are not approved here.

Open it: `python3 -m http.server -d design-reference-card 8800`, then `http://127.0.0.1:8800/index.html`. Language: `localStorage` `gtm-lang` (`ar`, `en`); theme: `gtm-theme-v2` (`light`, `dark`). Nobody edits it; `(cd design-reference-card && sha256sum -c SHA256SUMS)` proves it. A change needs a new approval.

| State | Card |
| --- | --- |
| Idea with no assignee | فيديو ريلز: يوم في حياة محاسب |
| An Agent working, ticking to-dos | مراجعة نصوص إعلانات ديسمبر |
| Stopped on a question | حملة Meta: المحاسب الشامل |
| Needs review, rich description | مقال SEO: كورس محاسبة اونلاين |
| Stopped after two failures | أرقام Google Ads لشهر أكتوبر |
| Waiting for another Card | إيميل للمشتركين القدام: خصم الدفعة الجديدة |
| Assigned to me | حملة ديسمبر: الإعلانات والمقال |
| Approved, date ahead | مقال SEO: الفرق بين المحاسب والمراجع |
| Done with a summary | التقرير الأسبوعي (29 أكتوبر – 4 نوفمبر) |
| Archived | the board's archive icon |
| Viewer | account menu, Mona Adel |

| Symbol | Meaning |
| --- | --- |
| Speech bubble with "?" (amber) | Has a question |
| Page with magnifier (amber) | Needs review |
| Warning triangle (red) | Stopped after two failures |
| Circle with tick (teal) | Approved |
| Hourglass and number (grey) | Waiting for another Card |
| Hand (amber) | On you |
| Pulsing dot (teal) | Working now |
| Filled square (grey) | Stopped; the Stop button |
| Archive box (grey) | Archived |
| Bell and number (amber) | Waiting on you |
| Lightning (teal) | The Agent starts at once |
| Curved arrow (grey) | Sent back |
| Eye (grey) | Read only |

Every symbol has its name in a tooltip (long press on a phone) and as its accessible name. ## Where this copy is not the rule

The files are kept exactly as approved. The spec decides wherever it differs, and a built screen does not copy these:

- The code-card states are not built (#36), and a real to-do tick box follows DESIGN.md's touch target.
- A Card waiting for an archived one stays waiting here; archiving releases it. One released while In progress starts here without a new Run; it gets one.
- A message queued while an Agent answers does not restore an archived Conversation here; it does.
- A very long title can push the Card's details out of reach; on a phone the tab order of the Card does not follow what is seen.
- A paste that mixes plain and formatted text loses the plain part.
- A link to a Card (`#card=`) does not open it on load.
- Channels made in onboarding, files on a Card made by an Agent's screen, and a routine's manual result are other screens' behaviour and are not approved here.
