import { hermesEngine } from './hermes.mjs';

// The engine contract (ADR 0009): everything gtmworks asks of the agent engine that runs a conversation, and nothing
// more. An engine starts a run for a conversation (the same idempotency key is the same run, so a retry never starts a
// second one), reads a run's state, and stops a run. A run may carry instructions for that run alone (the sender's own
// note, lib/conversation-runs.mjs); the engine does not keep them in the conversation or in memory. Starting returns
// the run, null when it definitely did not start, or { state: 'unknown' } when it may have started and the answer was
// lost: the caller then asks again with the same idempotency key and the same body, marked as a retry (`retry`), until
// the outcome is known; a retry is never answered null, since nothing can prove the first start did not happen. Only a driver talks to its engine; Hermes is the first driver
// (lib/hermes.mjs), and later drivers (Codex, Claude Code) speak this same contract.
//
// A run's state is one of: running, completed (with the reply), failed, stopped, lost (the engine no longer knows the
// run), unreachable (the engine could not be asked; the run may still finish). Usage is the input and output tokens
// the engine reported, or null when it reported none (unknown, never zero).
//
// A run may carry the conversation's history as [{role, content}], role user or assistant, oldest first, for that run
// alone: gtmworks's record of the conversation when the engine's own context of it is elsewhere (an Agent moved to its
// own profile, #121). The engine then answers from that history instead of its own.
//
// A running run may wait on its person (#138): it then carries the question it asks (`question`: an opaque id, the text,
// the choices as plain texts, none for an open-ended question, and whether several may be picked), one at a time, and
// waits until it is answered or the engine stops waiting (its own time limit, a stop); either way the same run then
// goes on. A waiting run is running, never ended. Answering sends the text as written and is one of: answered (the run
// took it, or already had an answer), gone (the run no longer waits for that question) or unreachable (ask again with
// the same answer). An empty answer is no answer: the engine tells the model it went unanswered.
//
// A run may offer tools (a name, a description and the JSON Schema of the arguments) for that run alone. A completed
// run lists the calls its model made (an id, the tool's name and its arguments), and every other state lists none. The
// engine only carries a call: gtmworks decides whether it is allowed and carries it out (lib/agent-tools.mjs).
//
// An engine also creates and reads an Agent (name, instructions, model) with the same error shape: outcomes are values,
// never thrown. Creating is one of: created (with the Agent), exists (the name is taken; the Agent there is left as
// it was), refused (the key), unreachable, failed. Reading is found (with the Agent), missing, refused or unreachable.
// A found Agent is ready when a Run can start for it.
//
// An Agent Lead makes gets a profile of its own under a name reserved for it (ADR 0016), so providing one finishes a
// profile already there under that name rather than leaving it held. Providing is one of: provided (its instructions are
// its soul, its tools are the level's and read back offer nothing that must stay off, and the engine has a model this
// profile can answer with), noModel (made, but it cannot answer), forbidden (made, but it still offers a tool that must
// stay off), failed (a step failed), refused (the key), unreachable. Removing an Agent's profile is one of: removed,
// missing, refused (the key, or a name that is no profile name or is the engine's default, which is never sent) or
// unreachable; gtmworks removes only a profile it made for an Agent that was then never made.
//
// An engine may also read which model providers a Company's shared space holds a key for (`readKeys`, #299): found, with
// each provider, its label and whether its key is set, never the key itself, or refused, unreachable or failed. gtmworks
// reads it only to settle a key set the engine never answered.

/** @param {unknown} result */
export const startOutcomeUnknown=result=>!!result&&typeof result==='object'&&/** @type {{state?:string}} */(result).state==='unknown';

/** @param {{address:string,profile:string,key:string,managementAddress?:string}} connection */
export function engineFor(connection) { return hermesEngine(connection); }

// How a run's state ends in the conversation record (the outcomes of conversation_usage); null while it may still
// finish. A completed run with a blank reply failed.
/** @param {{state:string,reply:string|null}} run */
export function outcomeOf({state,reply}) {
 if(state==='running'||state==='unreachable') return null;
 if(state==='lost'||state==='stopped') return state;
 return state==='completed'&&reply?.replaceAll('\u0000','').trim()?'completed':'failed';
}
