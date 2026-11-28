
// The engine contract (ADR 0009): everything gtmworks asks of the agent engine that runs a conversation, and nothing
// more. An engine starts a run for a conversation (the same idempotency key is the same run, so a retry never starts a
// second one), reads a run's state, and stops a run. A run may carry instructions for that run alone (the sender's own
// note, lib/run-parts.mjs); the engine does not keep them in the conversation or in memory. Starting returns
// the run, null when the engine refused it, { state: 'notReached' } when the request never reached the engine (nothing
// could connect: it is not running), or { state: 'unknown' } when it may have started and the answer was lost: the
// caller then asks again with the same idempotency key and the same body, marked as a retry (`retry`), until the outcome
// is known; a retry is never answered null or notReached, since nothing can prove the first start did not happen. A
// start that never reached the engine is no attempt (#413): the caller hands its attempt back, so the next start is a
// first one again, whose refusal still ends the start. Only a driver talks to its engine; Hermes is the first driver
// (the Engine driver, lib/engine/), and later drivers (Codex, Claude Code) speak this same contract.
//
// A run's state is one of: running, completed (with the reply), failed, stopped, lost (the engine no longer knows the
// run), unreachable (the engine could not be asked; the run may still finish). A failed run says when it failed because
// the engine has no model provider to answer with (`noModel`, #422) or could not reach its model for a cause a retry
// cannot fix (`modelRefused`: no credit, a refused key or sign-in, or a model the provider does not have, #457), so its
// person is told what to fix rather than to send again. A Run whose every account ran out (`access`, #622) carries when
// the usage resets (`resetsAt`, an ISO time) when the engine names it (#642). Usage is the input and output tokens the engine reported, or
// null when it reported none (unknown, never zero).
//
// A run may carry the conversation's history as [{role, content}], role user or assistant, oldest first, for that run
// alone: gtmworks's record of the conversation when the engine's own context of it is elsewhere (an Agent moved to its
// own profile, #121). The engine then answers from that history instead of its own.
//
// A run's input is the person's message: its text, or when they attached images (#155) messages whose last one holds
// the text and one image part per file. The pinned Engine reads images through its vision preparation and refuses a
// file or document part, so gtmworks sends only image parts, and only for the image kinds it proves the Engine reads.
//
// A running run may wait on its person (#138): it then carries the question it asks (`question`: an opaque id, the text,
// the choices as plain texts, none for an open-ended question, and whether several may be picked), one at a time, and
// waits until it is answered or the engine stops waiting (its own time limit, a stop); either way the same run then
// goes on. A waiting run is running, never ended. Answering sends the text as written, or for a question where several
// may be picked the texts of the picked choices (#648), and is one of: answered (the run
// took it, or already had an answer), gone (the run no longer waits for that question) or unreachable (ask again with
// the same answer). An empty answer is no answer: the engine tells the model it went unanswered.
//
// A running run may instead wait on its person's consent before an action (#163): it then carries the request
// (`permission`: an opaque id, the engine's description and command, either possibly blank, and the choices it takes,
// once and deny always among them, and always when the engine offers to allow it from then on), one at a time, and
// waits until it is answered or the engine stops waiting (its own time limit, a stop, the run's end), which counts as not
// allowed; either way the same run then goes on. A waiting run is running, never ended. Answering sends one of the
// choices and is one of: answered (the run took it), gone (the run no longer waits for that request, or it is not one
// the engine takes) or unreachable (ask again with the same choice).
// A request that offers always also says what an always answer keeps (`allows`, #166): the entries it adds to the
// Agent's standing permissions.
//
// An Agent's standing permissions (#166) are what its own profile may do without asking again: every action a person
// answered with always, one entry each, as the engine keeps it. They are read (found, refused, unreachable, failed) and
// one is revoked (revoked once read back without it, gone when it was not there, or refused, unreachable, failed); a
// revoked entry asks again at the next such action, with no restart. gtmworks keeps no copy of the list.
//
// A run may offer tools (a name, a description and the JSON Schema of the arguments) for that run alone. A completed
// run lists the calls its model made (an id, the tool's name and its arguments), and every other state lists none. The
// engine only carries a call: gtmworks decides whether it is allowed and carries it out (lib/agent-tools.mjs).
//
// A conversation's session (#346) is read as its turns, oldest first: each person's message starts one, at the time
// the engine stamped on it, with the tool calls the engine made in it in order (the tool's name, the engine's preview
// of the call or none, and started, done or failed) and its length in whole seconds on the engine's clock. Reading is
// found, missing (the engine keeps no such session for the profile), refused or unreachable. gtmworks keeps none of it.
//
// A conversation's session is marked archived while its Conversation is, and unmarked when it is restored (#674): marked,
// missing (the engine keeps no such session for the profile, so there is nothing to mark), refused or unreachable. The
// mark changes nothing else of the session, and nothing of the Agent's memory. gtmworks keeps the Conversation's own
// archive itself; the engine's mark follows it whenever the engine answers.
//
// While a run works, its tool calls are read as they happen (`steps`, #646): every call the engine made in it so far,
// then each new one, in order: a call starting (its id, its tool and the engine's preview of it, cleaned as a session
// step's is) or ending (done or failed); a loss when older calls are gone; and one end last: ended (the run's events are
// complete), closed (the read stopped before that), gone (the engine keeps no events of the run) or unreachable. A call
// the engine gives no id has its start's number as its id, and its end none. gtmworks passes them to the reader and
// keeps none of them; once the reply is in, the session's turn is the record of the run's steps.
//
// An engine also creates and reads an Agent (name, instructions, model) with the same error shape: outcomes are values,
// never thrown. Creating is one of: created (with the Agent), exists (the name is taken; the Agent there is left as
// it was), refused (the key), unreachable, failed. Reading is found (with the Agent), missing, refused or unreachable.
// A found Agent is ready when a Run can start for it, and carries the Engine's name for it, its About and its title
// (displayName, description, descriptionAuto, botTitle) as the profile holds them (#161).
//
// An Agent Lead makes gets a profile of its own under a name reserved for it (ADR 0016), so providing one finishes a
// profile already there under that name rather than leaving it held. Providing is one of: provided (its instructions are
// its soul, its tools are the one fixed set every Agent gets and read back offer nothing that must stay off, and the
// engine has a model this profile can answer with), noModel (made, but it cannot answer), forbidden (made, but it still
// offers a tool that must stay off), failed (a step failed), refused (the key), unreachable. Removing an Agent's profile
// is one of: removed, missing, refused (the key, or a name that is no profile name or is the engine's default, which is
// never sent) or unreachable; gtmworks removes only a profile it made for an Agent that was then never made.
//
// A run may carry a model for that run alone (#158): a provider and a model from the list the engine gives for the
// Agent's profile (`models`: found, with the profile's own provider and model as current, or refused or unreachable,
// with none). The Agent's own model is left as it is; a run with no model runs on it. A start the engine refuses for
// its model is null, as any refusal is.
// A completed run names the model that answered it (`served`) and the model it named (`chosen`), none when it ran on
// the Agent's own model (#644): they differ once the engine moved the request to the Company's Fallback model.
//
// An engine may also read which model providers a Company's shared space holds a key for (`readKeys`, #299): found, with
// each provider, its label and whether its key is set, never the key itself, or refused, unreachable or failed. gtmworks
// reads it only to settle a key set the engine never answered.
//
// An engine turns one recording into text for an Agent (#160): a base64 audio data URL and its MIME type in, and the
// transcript out. It is transcribed on the Agent's own profile, in the language the profile listens in (`dictation`:
// found with that language, or refused, unreachable or failed). An empty transcript is silence, not an error.
// `unavailable` is the engine saying it has no speech-to-text provider to use. The recording is stored nowhere and
// logged nowhere: the driver returns its words only.
//
// An Agent's profile has a Screen (#712, ADR 0018): a desktop and a browser in its Company's work sandbox, which the
// Agent wakes by itself when it needs it and the engine puts to sleep when idle. It is read (`screen`) as found, with its
// state (none where the engine offers no Screen for the profile, asleep, awake), who controls it (the Agent, or a person)
// and why a start would be refused (`missing`: the sandbox lacks what the desktop needs), or as missing (no such
// profile) or unreachable. Waking it (`wakeScreen`) is awake, with that state, or notStarted with why (missing, or failed:
// it did not come up, as when another profile's Screen holds the sandbox's one display), missing or unreachable; waking
// is no state of the engine's, only a start in flight. One picture (`screenPicture`) is found (its image type and
// bytes), asleep (no picture while it sleeps), withheld (while a person controls it, since it may show what they type),
// failed (the engine sent something that is no picture), missing or unreachable. The engine's address, its words and
// its key never leave the driver; a picture reaches a browser only through gtmworks (ADR 0011).
//
// A person watches and takes control of a Screen through a viewer (`screenViewer`, #713): open while its large view is
// open, or asleep (no Screen running to watch), missing or unreachable. The viewer reads who controls the Screen as it
// sees it (`control`: the Agent, this viewer, another viewer, or gone when the engine stopped answering), takes control
// for itself (`take`: taken, or held while another viewer has it, which the engine itself would let it steal), gives it
// back (`giveBack`; with `force`, control another viewer left behind), opens the live stream (`stream`: an open
// WebSocket of raw RFB on a single-use ticket, whose keyboard and pointer input the engine lets through only while this
// viewer holds control), and closes (`close`), giving back what it holds. The stream reaches a browser only through
// gtmworks (ADR 0011, ADR 0029).

/** @param {unknown} result */
export const startOutcomeUnknown=result=>!!result&&typeof result==='object'&&/** @type {{state?:string}} */(result).state==='unknown';
/** @param {unknown} result */
export const startOutcomeNotReached=result=>!!result&&typeof result==='object'&&/** @type {{state?:string}} */(result).state==='notReached';


// How a run's state ends, before its cause is read (endOf); null while it may still finish. A completed run with a
// blank reply failed.
/** @param {{state:string,reply:string|null}} run */
function outcomeOf({state,reply}) {
 if(state==='running'||state==='unreachable') return null;
 if(state==='lost'||state==='stopped') return state;
 return state==='completed'&&reply?.replaceAll('\u0000','').trim()?'completed':'failed';
}

// The same end, with a failure a retry cannot fix kept apart by its cause: no model provider at all (no_model, #422),
// or a model call refused for no credit, a refused key or sign-in, or a model the provider does not have (no_credit,
// key_refused, model_missing, #457). A Conversation, a channel, a handover and a Card note each say what to fix, rather
// than that the reply failed (#428, #530).
const refusedEnds={credit:'no_credit',key:'key_refused',model:'model_missing',access:'no_access'};
/** @param {{state:string,reply:string|null,noModel?:boolean,modelRefused?:'credit'|'key'|'model'|'access'}} run */
export function endOf(run) {
 const ended=outcomeOf(run);
 if(ended!=='failed') return ended;
 if(run.noModel) return 'no_model';
 return run.modelRefused?refusedEnds[run.modelRefused]??'failed':'failed';
}
