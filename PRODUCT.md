# Product

<!-- impeccable:product-schema 1 -->

Source: Omar's init answers of 2026-11-09 (issue #212), updated by his direction change on #184 and the ticket list approved on 2026-11-11 (#246). Product words and existing contracts come from `GLOSSARY.md`, `docs/adr/`, `AGENTS.md` and `DESIGN.md`.

## Platform

web

## Users

Company members (Owner, Manager, Contributor, Viewer) direct, approve and read the numbers for their own Company. One person may be a member of several companies and run the marketing of each. They talk to agents, starting with the Company's main Agent, follow the agents' work and approve it. They work mostly on desktop and on mobile for quick approvals.

Each person installs gtmworks, and Hermes comes inside it (ADR 0010). The first person to set it up is the Owner of its first Company. Members use that installation according to their role in each Company; nobody outside a Company's members enters it (ADR 0012).

## Product Purpose

A Company uses its Hermes agents for marketing, sales analysis and strategy. gtmworks shows the marketing work, conversations, approvals and results. People direct the work, approve exact versions and read results.

## Positioning

gtmworks is open source and self-hosted. It is built on Hermes only and runs no model itself. Hermes, shipped inside the install, is the agent engine (ADR 0010); gtmworks supplies the Company's marketing workflow and the record people use to follow it.

Agents take on ongoing work, keep working when a person steps away and bring back what needs attention. Each Company gets its main Agent on the bundled Hermes with no connection step; the Company's Owner may connect another Hermes profile instead and choose which existing agents work in each Company. Agent settings, skills and memory stay in Hermes.

## Operating Context

Each installation runs Hermes inside it, on its private network, with gtmworks calling Hermes directly through the engine contract (ADR 0008, 0009, 0010).

Omar's installation starts with RS Learning; R&S Consultations, Aleem and others follow on the same structure. One installation can serve several companies. Each Company's data stays isolated, and a person's role in one Company grants no access to another.

There are two layers of work. The marketing board, stages, dates and named approvals belong in gtmworks. Agent work belongs to Hermes's own board and is shown from Hermes inside a Card and on the Agent work page. gtmworks builds no separate task engine.

## Capabilities and Constraints

- The dashboard and its worker run no model and hold no model credentials. Hermes executes agent work; gtmworks starts Hermes runs and relays their events. The older agent API remains transitional (ADR 0006, 0007, 0008).
- A Hermes profile key is a connection credential, not a model credential. gtmworks stores it encrypted and calls Hermes directly; the saved key is never shown again (ADR 0008).
- Agents never approve, reject, publish or spend. Approval belongs to an authorized person and applies to one exact Version. A changed Version needs a new Approval. No answer is never yes.
- Terms follow `GLOSSARY.md`: Company, Person, Member, Agent, main Agent, Card, Version and Approval. The permission roles are Owner, Manager, Contributor and Viewer.

### One owner for each kind of data

| Owner | Data it owns |
| --- | --- |
| Hermes | Agents, their settings, skills, scheduled work, connections and memory. Its board owns agent work. |
| gtmworks | Companies, members, marketing cards and stages, versions, approvals, the library, results and its own append-only record of each conversation as people saw it. |

Showing Hermes data in gtmworks does not make gtmworks a second owner. Agent work is read from Hermes; gtmworks keeps the marketing record and the conversation people actually saw. These boundaries follow the direction change on #184 and ADR 0008.

## Brand Commitments

- The look is Paperclip's, per `DESIGN.md`. Existing screens are refined inside that identity.
- New screens that Paperclip does not have (conversation, agent face, agent page) have full design freedom within the same tokens.
- English-first, with a complete shipped Arabic translation. The interface Arabic is Egyptian, worded as in the approved reference's Arabic version (`design-reference/`); this replaces the earlier Modern Standard Arabic rule. Direction follows the language; authored content keeps its own direction.
- Every new interface string belongs in both message catalogues.

## Accessibility & Inclusion

- WCAG AA contrast.
- 44px touch targets on mobile.
- Reduced motion respected.

These are existing contracts in `DESIGN.md`.
