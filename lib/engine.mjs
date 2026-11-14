import { hermesEngine } from './hermes.mjs';

// The engine contract (ADR 0009): everything gtmworks asks of the agent engine that runs a conversation, and nothing
// more. An engine starts a run for a conversation (the same idempotency key is the same run, so a retry never starts a
// second one), reads a run's state, and stops a run. A run may carry instructions for that run alone (the sender's own
// note, lib/conversation-runs.mjs); the engine does not keep them in the conversation or in memory. Only a driver talks to its engine; Hermes is the first driver
// (lib/hermes.mjs), and later drivers (Codex, Claude Code) speak this same contract.
//
// A run's state is one of: running, completed (with the reply), failed, stopped, lost (the engine no longer knows the
// run), unreachable (the engine could not be asked; the run may still finish). Usage is the input and output tokens
// the engine reported, or null when it reported none (unknown, never zero).
//
// An engine also creates and reads an Agent (name, instructions, model) with the same error shape: outcomes are values,
// never thrown. Creating is one of: created (with the Agent), exists (the name is taken; the Agent there is left as
// it was), refused (the key), unreachable, failed. Reading is found (with the Agent), missing, refused or unreachable.
// A found Agent is ready when a Run can start for it.

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
