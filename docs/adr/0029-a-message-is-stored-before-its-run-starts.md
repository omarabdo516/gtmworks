---
status: superseded by ADR 0033 (spec #864, #883); a Channel's message keeps this rule until Channels leave (#921)
date: 2026-11-25
---

# A person's message is stored before its Run starts

[ADR 0033](0033-an-interface-and-a-gatekeeper-over-hermes.md) (Omar, 2026-11-26): a Conversation's messages are kept in the Engine only. Spec #864 built that, and #883 switched this record's way off for a Conversation: a message is one Run on its Engine session, and one the Engine did not take stays in the box with "not sent" and "Try again", since no message exists in gtmworks without a Run. A Channel's message still follows the decision below until Channels leave the product (#921). The rest of this record is kept as it was decided.

Omar's decision of 2026-11-25 (vault decision 0071), after issue #756 and the audit of the same day.

## Context

A sent message was stored only after the Engine accepted its Run: `sendMessage` (`lib/conversation-runs.mjs`) made 17 to 18 database round trips and then started the Run, with a 10 second timeout and two attempts, before `send_conversation_message` wrote the row. A person's own words waited on the Engine: 0.3 to 0.8 seconds on a quiet server, 5 to 15 seconds on a busy one. A second copy of "start a Run for a turn" already existed for queued turns (`startQueuedTurn`), started by the worker.

## Decision

Sending is one database call that stores the message as a turn of its Conversation and answers. Starting the Run comes after it, by one starter: the request kicks it once the answer is sent, and the worker starts any turn left waiting. The claim on a turn keeps the two from starting it twice. A Channel's message follows the same rule.

If the Engine refuses the Run, or cannot be reached within the attempts, the message stays in the Conversation with "not sent" under it and a "Try again" button. The text does not go back to the box.

## Considered options

- **Draw the message in the browser before the POST answers, and leave the order of the send as it is** (#756 as written). The person sees their words at once, but the Agent still starts only after every round trip, a refusal arrives after the message is drawn, and closing the page inside the wait loses the message. Kept as the browser half of this decision, not as the whole of it.

## Consequences

- A message can exist with no Run. Every reader of a Conversation treats a waiting turn and a failed turn as states of a message, not as errors of the send.
- The send answers before the Engine is asked, so its answer no longer says whether the Agent started. That is read from the turn.
- #756's acceptance line "shows the existing failure state (text back in the box) if it is refused" is replaced by the failed-turn line above. A refusal the database itself gives (not a writer, a spent send key) still answers the POST and still returns the text to the box, because nothing was stored.
