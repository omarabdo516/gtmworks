---
status: accepted
date: 2026-11-19
---

# One access question at install, and people join by invite link; the install sends no email

Omar's decisions of 2026-11-19. Not built yet: the spec that builds it follows this record. [ADR 0012](0012-no-agency-layer-the-company-owner-manages-the-company.md) still holds: nobody sees every Company.

## Context

Serving an install on a public address took hand edits to `.env.install` and a proxy the server's owner set up alone. Invitations and password resets were emails that went to a local mailbox inside the install, which a person then had to open on the server. The person who installs gtmworks is a marketer, not an engineer.

## Decision

### Access

- The install has one gateway, Caddy, which replaces the nginx gateway. It is never put in front of it.
- At install one command asks one question: where will your team come in from? The answer is the install's access kind, and the install owner changes it later with a `gtmworks` command.
- Three kinds:
  - **A domain of mine.** The install gets HTTPS by itself, after it checks that the domain points at this server and that ports 80 and 443 are free.
  - **A proxy already on this server.** The install prints the line to put in that proxy and stays on the loopback address.
  - **Private.** The server itself, or a private network such as Tailscale.
- The project runs no relay service for installs. Access is built as kinds so that another kind is an addition; a temporary address for a server with no domain is the first one left for later.

### Joining and passwords

- A new Person joins a Company through an invite link an Owner makes. The link carries the Company, the Role and the Agents the Member will see, and the Owner labels it with the person's name. It works once, ends after 7 days and can be cancelled before use. Whoever opens it types their name, email and password, and joining is written in the Company's log.
- An invite link never gives the Owner role. An Owner makes an existing Member an Owner.
- A Company made after first-run gets its first Owner through a first-Owner link, printed by the command that makes the Company and used once, like the setup link. The install owner so never enters a Company that is not theirs.
- A Person who is already a Member of another Company the same Owner owns is added from the Team page with a Role, with no link.
- A Member who forgot their password gets a single-use password link from an Owner or a Manager of their Company. A Company's last Owner gets theirs from a `gtmworks` command on the server.
- Every such link keeps its secret after `#` in the address, as the setup link does, is kept hashed, and is used up by sending the form, never by opening the page, so a link preview cannot spend it.
- The local mailbox leaves the install, and the product has no email setting.

### The install owner

The install owner is whoever runs the install's commands on its server. The product has no install owner role and no install pages yet; both are additions for later.

## Considered options

- **Email as a second way to send the same link.** Rejected: two paths for one thing, built and tested twice, and the person installing would not set up a mail account.
- **A relay service run by the project.** Rejected for now: every install would pass through a service the project must run and answer for.
- **The install owner as every new Company's first Owner.** Rejected: they would enter Companies that are not theirs.

## Consequences

- An invite link works for whoever holds it. Single use, the 7 days and the bar on the Owner role bound that.
- Changing the install's address ends the links made before it; they are made again.
- Adding a Company needs a command on the server until the browser path is built.
