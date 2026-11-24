// Archiving Cards (#670, #671, #672), Conversations (#674) and team channels (#675) asks and answers in one shape.
//
// One thing archiving would stop: the Agent working (`run`), what it waits on people for (a question, a permission
// request, a handed step), or the approval a Card waits for. `about` is what it is in (a Card's id, a Conversation's
// id or the channel's); `title` names it in the one confirmation (the Card's or the Conversation's title, or the words
// of what a channel waits on; none for a channel's Agent at work). `agent` and `agent_id` are null for an Agent hidden
// from the reader, whom the confirmation calls "An Agent".
export type ArchiveStopKind='run'|'question'|'permission'|'hand'|'approval';
export type ArchiveStop={about:string,kind:ArchiveStopKind,title:string,agent:string|null,agent_id:string|null};
// What each archive action is asked: what archiving would stop, the archive itself, or the restore.
export type ArchiveIntent='stops'|'archive'|'restore';
// How each answers: what would stop; the ones it archived or restored (one left as it was, because it changed meanwhile
// or the person may not change it, is not among them), with the archive's `version` where its Undo names it (Cards:
// an Undo restores only what that archive archived); or refused, when none changed.
export type ArchiveAnswer<Id>={state:'stops',stops:ArchiveStop[]}|{state:'done',done:Id[],version?:string}|{state:'refused'};
export const archiveIntents:readonly ArchiveIntent[]=['stops','archive','restore'];
