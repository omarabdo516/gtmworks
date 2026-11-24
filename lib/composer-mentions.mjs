// The "@" and "/" tokens the composer's suggestion list follows (#154; design-reference: tokenAtCaret, pickPop). It
// starts at the message's start or after a space, so the "@" inside an email address opens nothing, and holds no space,
// "@" or "/", so a space typed after it closes the list. A query compares folded only: Arabic keeps its letters.

// The job commands beside "/agent" (#159; design-reference: CMDS, classifyWork): each belongs to the Agent a Member sees
// that was made from one ready-made role (lib/role-templates.mjs), and its line names that Agent. `label` is the
// catalogue key, with the Agent's name where the words hold "{0}".
const jobCommands = Object.freeze([
 { command: '/campaign', role: 'meta', label: 'plusCommandCampaign' },
 { command: '/report', role: 'numbers', label: 'plusCommandReport' },
 { command: '/review', role: 'hook', label: 'plusCommandReview' },
 { command: '/article', role: 'writer', label: 'plusCommandArticle' },
]);
const agentCommand = Object.freeze({ command: '/agent', label: 'plusCommandAgent' });

// The Commands the composer offers (#159): a job command only when an Agent the Member sees was made from its role, in
// the reference's order, then "/agent" last. Two Agents from one role: the first the Member's list draws answers, as the
// sidebar draws them. A hidden Agent never reaches here: the server lists only the Agents this Member may see.
/** @param {{name:string,role?:string|null}[]} agents @returns {{command:string,label:string,agent?:string}[]} */
export function commandList(agents) {
 const list = [];
 for (const job of jobCommands) {
  const agent = agents.find(agent => agent.role === job.role);
  if (agent) list.push({ command: job.command, label: job.label, agent: agent.name });
 }
 return [...list, agentCommand];
}

// The job command a message begins with, and the Agent of its role this person sees (#358): the same rule as the list
// above, so a command the composer offers is the one the send path hands over. Null for words that begin with no listed
// command, or with one that carries no job after it (that message is plain text, as one typed where it is not listed is).
/** @param {string} message @param {{name:string,role?:string|null}[]} agents @returns {{command:string,role:string,agent:string,goal:string}|null} */
export function jobCommandIn(message, agents) {
 const text = String(message ?? '').replace(/^\s+/, '');
 const job = jobCommands.find(({ command }) => text.toLowerCase().startsWith(command) && (text.length === command.length || /\s/.test(text[command.length])));
 const agent = job && agents.find(agent => agent.role === job.role);
 const goal = job ? text.slice(job.command.length).trim() : '';
 return agent && goal ? { command: job.command, role: job.role, agent: agent.name, goal } : null;
}

// The token under the caret, or null when there is none.
export function tokenAtCaret(value, caret) {
 const before = String(value ?? '').slice(0, caret);
 const match = before.match(/(^|\s)([@/])([^\s@/]*)$/);
 return match ? { type: match[2], q: match[3].toLowerCase(), start: caret - match[3].length - 1, end: caret } : null;
}

// Picking an entry puts its text in place of the token, one space after it, and leaves the caret after that space.
export function insertToken(value, token, insert) {
 const at = token.start + insert.length;
 return { value: value.slice(0, token.start) + insert + value.slice(token.end), caret: at };
}

// The Agent a message calls (#153), read as a channel reads one (public.channel_mention): "@" and an Agent's name, in
// any case, after the start, a space or a punctuation mark and before the end, a space or a punctuation mark (Arabic
// ، ؛ ؟ count). `agents` are the ones the sender sees. Several: the earliest wins; at one place the longest name; the
// same name: the main Agent, then by id. None: null.
const edge=/[\s\p{P}\p{S}]/u;
/** @param {string} message @param {{id:string,name:string,is_default?:boolean}[]} agents @returns {string|null} */
export function mentionedAgent(message,agents) {
 const text=message.toLowerCase(); let best=null, bestAt=0, bestLength=0;
 const ordered=[...agents].sort((a,b)=>Number(!!b.is_default)-Number(!!a.is_default)||(a.id<b.id?-1:a.id>b.id?1:0));
 for(const agent of ordered) {
  const handle=`@${agent.name.trim().toLowerCase()}`; if(handle==='@') continue;
  for(let from=0;;) {
   const at=text.indexOf(handle,from); if(at<0) break;
   const end=at+handle.length;
   if((at===0||edge.test(text[at-1]))&&(end>=text.length||edge.test(text[end]))) {
    if(best===null||at<bestAt||(at===bestAt&&handle.length>bestLength)) { best=agent.id; bestAt=at; bestLength=handle.length; }
    break;
   }
   from=at+1;
  }
 }
 return best;
}

// Every Agent a message names after "@" by the same rule, each on its own (#152, #700): a channel's message calls each
// of them, and each listens while it is being written.
/** @param {string} message @param {{id:string,name:string}[]} agents @returns {string[]} */
export const calledAgents=(message,agents)=>agents.filter(agent=>mentionedAgent(message,[agent])!==null).map(agent=>agent.id);
