---
status: accepted
date: 2026-11-24
---

# An Agent's look is kept on the Agent, and one face draws it

Omar's decisions of 2026-11-24 (grill on the Agent's face). Today's pastel faces are replaced by an animated gradient orb: the approved prototype in `design-reference-orb/`. Not built yet; the code and the other records describe today's face until its spec lands.

## Decision

- An Agent's look is its shape, its colour and its temperament. It is given once, when the Agent is made, and kept; it is never computed from a name or an id when a face is drawn. Each of the three is automatic until the Owner picks it.
- Automatic: the main Agent is indigo and calm. Any other Agent takes the colour its Company's Agents use least; its temperament is the one Lead gives when it makes the Agent, else its ready-made role's, else the one the Company's Agents use least. Shape starts as the circle.
- The look belongs to the Agent's id and outlives the Agent, so records of a removed Agent keep its face. It names nobody and tells nothing about the Agent's work, so every Member of the Company may read every look, a hidden Agent's included: that Agent's face already shows in shared channels.
- One component draws every Agent's face, at every size. A face moves from 24px up, only while on screen, and never with reduced motion, where its expressions still change.
- A face shows what gtmworks knows about its Agent now, and never invents it. The status dot and words say the same, so nothing is told by the face alone.

## Considered options

- **Compute the look from the name or the connection**, as the prototype and today's face do. Rejected: with eight colours, two of six Agents share one in 92% of teams; a connection id changes when an Agent moves profile, so a face people know changes by itself; and the gallery's face is not the one the made Agent gets.
- **Let people upload or generate a picture.** Rejected for now: a picture has no eyes, and the expressions are the point.

## Consequences

- Every record of an Agent keeps the Agent's id, and a finished Handover outlives its Agents (#702). As an Agent is removed its name is kept beside its look, readable as the look is: a removed Agent hides nothing, and nothing of it but its name and look becomes readable. A living Agent is never named there.
- The four legacy role agents lose their drawing; they are removed whole by their own spec.
- The role identity colours of `DESIGN.md` give way to the eight look colours as the hues an Agent may carry; orange stays "waiting on you".
