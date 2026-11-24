---
status: accepted
date: 2026-11-23
---

# One board, in gtmworks, working the way Hermes's Kanban does

Omar's decision of 2026-11-23 (grill on the Card). He wants a Card, its details and its way of working to be like a task on Hermes's Kanban. It supersedes [ADR 0013](0013-the-board-shows-six-columns-over-the-stages.md) where they differ, and the two layers of work in `PRODUCT.md` (a marketing board in gtmworks, agent work on Hermes's own board), whose second layer was never built. Not built yet; the code and the other records describe today's Card until its spec lands.

## Decision

- gtmworks keeps its own Cards and takes Hermes's method: one status, at most one assignee, comments everyone reads, a Card that waits for another, a block with one question, a review, a summary at the end. Each attempt is a Run on the Engine.
- The six columns are the Card's status. The stages under them, the approval steps and the Work settings page go. Publishing needs no gate: an Approval is a record of one Version, and people move Cards freely; an Agent never approves.
- A Card has at most one assignee, an Agent or a Member; none is required in any column, and a Card with none is worked by nobody. Assigned to an Agent, outside Ideas and waiting for nothing, it starts by itself. A Card stopped on a question, a failure or a review starts again only by the answer, Continue or the decision.
- An Agent reads, makes, assigns, moves, comments on, stops, sends for review and finishes Cards through gtmworks's own tools in its Runs. No Card is made by itself from a chat, a channel or a Handover.
- Cards, Conversations and team channels are archived and restored, never deleted. Archiving a Card stops the Agent working on it and releases the Cards that wait for it, as finishing it does; restoring it makes nobody wait again and starts nothing.
- A Card's description is one Markdown text, with to-do items ticked in place, because Markdown is what the Engine's Agents read and write. Nothing is offered that Markdown cannot hold.
- The look is the approved prototype in `design-reference-card/`: symbols for states, each with its name in a tooltip, and words only where a person must read to act.

## Considered options

- **Hermes's own board as the store, shown by gtmworks** (ADR 0022 asks first). Rejected: it holds no people, Roles, dates or Approvals, and anyone with its one token may do anything; its worker turns use another toolset and approval policy than the Runs gtmworks starts; its workspaces and attachments are on the Engine's disk, not in the work sandbox, and its tools read a path the Agent chooses there, which [ADR 0020](0020-full-power-first-limits-only-after-a-real-problem.md) keeps off (Hermes v0.23.0: `hermes_cli/kanban_db_workspace.py`, `tools/kanban_tools.py`, `hermes_cli/kanban_db_dispatch.py`).
- **Keep two layers** (a marketing Card, with Hermes tasks shown inside). Rejected: two places say who works on what and how far it is.
- **Permanent delete.** Rejected: the product promises that nothing in the log is ever deleted, and archiving clears the board without losing anything.

## Consequences

- Removing the stages and the old fields is staged (ADR 0023). Old values are written into the Card's description first. What the previous release writes between the first step and the cutover (a move, a field, a label) survives it: the spec chooses between writing both shapes in that window and reconciling before the drop, and proves it.
- Answering in a Card makes its stopped Agent go on, which Hermes's board does not do (a comment there wakes nobody until Unblock).
