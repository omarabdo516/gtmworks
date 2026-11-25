---
status: accepted
date: 2026-11-24
---

# An Agent hands a file in its reply by a MEDIA line in its own work folder

Issue #708. An Agent made a PDF report in its work folder and could only quote its path; asked for the file, it turned the report into nine JPGs and replied with nine `MEDIA:` lines, which the chat showed as raw sandbox paths.

## Context

- gtmworks reads a reply from the Engine's Runs API (`lib/hermes.mjs` `readRun`), which rewrites nothing: a `MEDIA:<path>` tag reaches gtmworks as text (`docs/engine-probes/work-sandbox-ssh.md` §4, row 8c).
- The Engine's own `api_server` platform hint tells the model that image `MEDIA:` tags are inlined and other files are not. That is untrue for the Runs API, and it is why the Agent turned a PDF into images.
- An Agent's work folder is `/work/<profile>/` in the Company's work sandbox (ADR 0018), and the Library already reads one file of it through a guarded download of at most 25 MB (`downloadAgentFile`: the work root only, the folder listed first, every path part a plain name).
- A person's files already have a home: `conversation_attachments` and `channel_attachments`, bytes in the place's private folder of the `creatives` bucket, served by `/c/<slug>/files/<place>/<id>`, which shows a raster image inline and downloads anything else.

## Decision

- **The Agent names a file by a `MEDIA:` line**, the Engine's own convention, with the file's path in its own work folder: `MEDIA:/work/<profile>/<path>`, or a path relative to that folder. A path from a folder may hold spaces up to its file's extension; words after `MEDIA:` that name no file are no tag. Every Run gtmworks starts carries one instruction saying so, last in its instructions (the Hermes driver, `withFileDelivery`): any kind of file up to 25 MB is attached, it replaces any other note on which files come through, and a file is never turned into images.
- **gtmworks reads the tags of a finished Run** (`lib/reply-files.mjs`) before it closes the Run: each tag is resolved inside that Agent's own work folder only and read through the Library's guarded download, its bytes are written to the place's folder at a path built from the Run (`reply-<md5 of the Run>-<n>`), and every tag leaves the text. At most ten files go with one reply.
- **The close stores the reply with its files** (`close_conversation_run` and `close_channel_run`, each with an overload taking the files): rows of the same files table a person's messages use, linked to the Agent's message, at paths the database builds itself. A reply of files alone is a whole reply. A closer that runs again writes the same bytes to the same paths and stores nothing twice.
- **A tag gtmworks cannot serve is never shown.** A path outside the Agent's own folder (the Engine's files, `..`, a hidden name, another Agent's folder), a file that is not there, an empty one, one past 25 MB or past the tenth is kept by its name alone on the message (`missed_files`, at most twenty), and the reply says that file could not be attached. A tag still in any reply's text when it is shown (a reply kept before this decision, a handover's words) is taken out and named the same way, and a Card note's reply keeps the file's name in place of its tag.
- **The reply shows its files as a person's message does**: the same file chip, on the Agent's side, with a raster image drawn as a thumbnail above its chip. The Agent's details "Files" tab lists them with the Conversation's other files.

## Considered options

- **Read the tag in the Hermes driver and return files on the engine contract.** Rejected: a reply of files alone would read as an empty, failed reply to every reader that hands no file on (handovers, Card notes), and a file is only kept where a reply has a place to keep it. The convention is gtmworks's own now, so its reader is too.
- **Tell the Agent to put files in a special folder that gtmworks sweeps.** Rejected: the Agent cannot say which reply a file belongs with, and a file made for itself would reach the person.
- **Give the Agent a gtmworks tool to attach a file.** Rejected for now: the Engine already writes `MEDIA:` tags by its own habit, and the tool would still need the same guarded read.

## Consequences

- Every Run's request body gains one fixed line of instructions. A start the previous release sent without it, whose answer was lost, is retried by this release under the same key: Hermes refuses the new body for that key (409 `idempotency_key_conflict`), and the driver then sends the earlier body once more, which replays the Run it started.
- A handover's answer and a Card note's reply hand no file on yet: their tags are named as files that could not be attached, or by the file's name in a Card note.
- The Agent's details "Files" tab lists the files of the reader's own Conversations; a file handed over in a channel is read in the channel only.
- A reply of files alone keeps an empty text, which a later Run's history carries as an empty turn, as a person's message of images alone already is.
- A file kept for a Run whose close then failed is left in the bucket with no row; the next closer writes the same path again.
- A person's own send keeps its 20 MB limit; the tables now take up to 25 MB for a file an Agent hands over.
