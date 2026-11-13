---
status: accepted
---

# The board shows six columns over the stages, and "Waiting on you" is one list

Issues #34 and #16 (parent #1). The approved design (`design-reference/`) shows the Marketing board as six columns: Waiting on you, Ideas, Planned, In progress, Live, Done. The product had nine stages, one column each.

## Context

The nine stages carry rules: an approval starts when a card enters the review stage and ends with a decision; a rejection sends the card back to writing or design; an approval moves it to approved, then scheduled when it has a date; only the people who manage a Company move a card after review; Agents create and move cards through the API by stage. Merging the stages would rewrite those rules and every card.

## Decision

- A stage keeps all its rules. Each stage now names the column it is shown in (`work_stages.board_column`), and the board groups cards by it. No card changes stage.
- The mapping of the nine default stages:

  | Stage | Column |
  | --- | --- |
  | أفكار (Ideas) | Ideas |
  | بريف جاهز (Brief ready) | Planned |
  | كتابة (Writing) | In progress |
  | تصميم ومونتاج (Design and editing) | In progress |
  | مراجعة (Review) | Waiting on you |
  | معتمد (Approved) | Planned |
  | مجدول للنشر (Scheduled) | Planned |
  | منشور (Published) | Live |
  | إعلانات شغالة (Running ads) | Live |
  | خلص (Done), added | Done |

- A renamed or added stage is placed by what it is: Ideas and review by their kind, a keyed stage (writing, design, approved, scheduled) by its key, another stage before review is Planned when it comes before writing and In progress after it, and any other stage after review is Live. Only the review stage is "Waiting on you".
- Every Company gets a «خلص» (Done) stage after the others. It is after review, so, as for every stage after review, only Owners and Managers move a card there.
- A card moved on the board names a column (`move_work_card_to_column`). It goes to that column's stage of the card's own kind when there is one (Live back to Planned is Approved, so an approved card stays approved), otherwise to the column's first stage. The move runs as the person, so every stage rule and row-level security apply, and it is logged like any stage change.
- Version approval stays a decision inside a Card. A card waiting for a decision shows in "Waiting on you"; it leaves the column by the decision, not by a drag, and the board does not drop a card into the column (a card is sent for approval from the Card).
- "Waiting on you" is one list per person (`waiting_list(company)`), newest first: the approvals this person holds, then any item addressed to them in `waiting_items`, of any kind (the first kind is an Agent's question). An item leaves the list when its person replies in its Conversation or changes its Card. Later kinds are new rows of their own kind and need no change to the list or its screen. Items are added by the server only and never notify anyone outside gtmworks.

Migrations: `supabase/migrations/20261206000000_board_columns.sql`, `supabase/migrations/20261206000001_waiting_list.sql`, `supabase/migrations/20261206000002_board_column_guard.sql` (a stage's column never changes once made, and no stage before review is made in Live or Done).

## Consequences

- The stage list in Work settings and the "Move to list" control inside a Card still show the nine stages and Done; the board shows six columns.
- The previous app version still runs against the database: it reads stages and cards as before and shows Done as a tenth list.
- An Agent filter on the board filters by the Card's assigned Agent identity (ADR 0006).
- Nothing in this change adds an Agent question. The engine contract (ADR 0009) reports a run as running, completed, failed, stopped or lost, with no state for "the Agent asks the person", and guessing a question from the reply text would invent one. Agent questions arrive with the work that gives an Agent a way to ask: an Agent request made in a Conversation (#17) and the Agent's own work and log (#20). That server code calls `public.add_waiting_item(company, person, 'question', title, body, card, conversation, asker)` as the service role, and the item appears in the list with no change to the list or its screen. Until then the list holds approvals and items a test adds through the same function.
