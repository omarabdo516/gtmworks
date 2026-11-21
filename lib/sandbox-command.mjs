// A command MCP server runs in the Company's work sandbox (#459, ADR 0024), never in the Engine's own container (ADR 0018).
//
// The Engine starts a stdio server as a child process of its own (tools/mcp_tool_transport.py). gtmworks therefore never
// hands the Engine the Owner's command: it hands it `ssh`, with the same route, user, port, key and pinned host key the
// terminal backend uses (scripts/engine-managed.yml, scripts/install.sh), and the Owner's command and arguments become
// the one remote command that ssh runs inside the sandbox. The prefix is gtmworks's alone, ssh's options end (`--`) before
// the host, and the Owner's words are one argument after it, each quoted for the sandbox's shell, so nothing an Owner
// types is read by ssh as an option or by a shell as more than one word. The command starts in the Agent's own work
// folder, made by the sandbox's login shell from the same `builtin cd -- <folder>` the terminal backend sends
// (sandbox/work-shell), so a file it writes lands in that Agent's part of the Company's work folder.
//
// The Engine profile is the only record (ADR 0016, ADR 0021): what the Owner typed is read back from these arguments.

import { workFolder } from './agent-toolsets.mjs';

// The route the terminal backend uses, pinned in the Engine's managed config and seeded by the install: the Engine's own
// key, the known_hosts that holds the sandbox's host key (StrictHostKeyChecking=yes: a swapped sandbox is refused).
export const sandboxRoute=Object.freeze([
 '-T','-i','/opt/data/ssh/id_ed25519',
 '-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=/opt/data/.ssh/known_hosts',
 '-o','LogLevel=ERROR','-o','ConnectTimeout=10','-o','ServerAliveInterval=30',
 '-p','2222','--','pn@sandbox',
]);

const profileName=/^[a-z0-9][a-z0-9_-]{0,63}$/;
// A command is one program name or path, the way a person types it in a terminal; an argument is any one line of text.
const commandOk=value=>typeof value==='string'&&value.length>0&&value.length<=500&&!/[\s\u0000-\u001f\u007f]/.test(value);
const argOk=value=>typeof value==='string'&&value.length<=2000&&!/[\u0000-\u001f\u007f]/.test(value);

/** @param {string} word */
const quote=word=>`'${word.replaceAll("'","'\\''")}'`;

// Whether the Owner's command and arguments can be run as they were typed.
/** @param {unknown} command @param {unknown} args @returns {args is string[]} */
export function sandboxCommandOk(command,args) {
 return commandOk(command)&&Array.isArray(args)&&args.length<=50&&args.every(argOk);
}

// The Engine's server entry for the Owner's command, run in the sandbox from the Agent's own folder.
/** @param {{profile:string,command:string,args:string[]}} given @returns {{command:'ssh',args:string[]}|null} */
export function sandboxServer({profile,command,args}) {
 if(typeof profile!=='string'||!profileName.test(profile)||!sandboxCommandOk(command,args)) return null;
 const remote=`builtin cd -- ${workFolder}/${profile} || exit 126; exec ${[command,...args].map(quote).join(' ')}`;
 return {command:'ssh',args:[...sandboxRoute,remote]};
}

// The Owner's command and arguments, read back from a server entry gtmworks wrote; null for any other entry (a remote
// server, or a command that does not run in the sandbox).
/** @param {unknown} server @returns {{command:string,args:string[]}|null} */
export function sandboxCommandOf(server) {
 const entry=/** @type {{command?:unknown,args?:unknown}|null} */(server&&typeof server==='object'?server:null);
 if(entry?.command!=='ssh'||!Array.isArray(entry.args)||entry.args.length!==sandboxRoute.length+1) return null;
 if(!sandboxRoute.every((word,at)=>entry.args[at]===word)) return null;
 const remote=entry.args[sandboxRoute.length];
 const found=typeof remote==='string'?remote.match(/^builtin cd -- \/work\/[a-z0-9][a-z0-9_-]{0,63} \|\| exit 126; exec ((?:'(?:[^']|'\\'')*' ?)+)$/):null;
 if(!found) return null;
 const words=[...found[1].matchAll(/'((?:[^']|'\\'')*)'/g)].map(word=>word[1].replaceAll("'\\''","'"));
 const [command,...args]=words;
 return sandboxCommandOk(command,args)?{command,args}:null;
}
