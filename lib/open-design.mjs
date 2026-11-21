// The Open Design app (#544, ADR 0025): a ready-made app whose MCP command runs in the Company's work sandbox, and whose
// designs are drawn by the Company's own Engine.
//
// Open Design's daemon draws a design by starting an agent CLI. In the sandbox that CLI is gtmworks's `hermes` runtime
// (sandbox/open-design/hermes-engine.mjs), which holds no model credential: each design is one Run on the Agent's design
// profile, `od-<Agent's profile>`, a profile of the Agent's own on the Company's Engine with a Run API key of its own and
// no other. The Engine answers it with the Company's model access, a subscription sign-in as well as an API key.
//
// The sandbox cannot reach the Engine's listeners (they bind the install network's address alone, #390), so the Engine
// reaches out: the ssh session in which it runs Open Design's MCP command for the Agent forwards one socket in the work
// user's home to its own Run API. The route is the terminal backend's own (lib/sandbox-command.mjs) with that forward
// added, and the remote command is gtmworks's `open-design-mcp` with the design profile and its key, so the sandbox holds
// only a key that runs that one profile.

import { randomBytes } from 'node:crypto';
import { sandboxRoute, quote } from './sandbox-command.mjs';
import { toolConfig, workFolder } from './agent-toolsets.mjs';

export const openDesignApp='open-design';
const agentProfile=/^(?:co|ag)-[0-9a-f]{32}$/;
const hostName=/^[a-z0-9][a-z0-9.-]{0,252}$/;
const designKey=/^[A-Za-z0-9_-]{32,200}$/;
// The Engine's Run API port inside its own container (scripts/engine-template.yml API_SERVER_PORT).
const runApiPort=8642;

/** @param {unknown} profile @returns {string|null} */
export const designProfileOf=profile=>typeof profile==='string'&&agentProfile.test(profile)?`od-${profile}`:null;
// The socket the Engine's session forwards for an Agent, where the sandbox's daemon takes it (daemon.mjs agentPaths).
/** @param {string} profile */
export const engineSocket=profile=>`/home/pn/.gtmworks/engine-${profile}.sock`;
// A design profile's Run API key: 32 random bytes, which no other profile holds.
export const newDesignKey=()=>randomBytes(32).toString('base64url');
// The design profile's tools and folder are the Agent's: it writes the design into the Agent's own folder of the work
// folder, through the same sandbox, and gets no tool an Agent never gets.
/** @param {string} profile */
export const designProfileConfig=profile=>toolConfig({profile});

const remoteOf=(/** @type {string} */ profile,/** @type {string} */ key)=>`builtin cd -- ${workFolder}/${profile} || exit 126; exec ${['open-design-mcp',/** @type {string} */(designProfileOf(profile)),key].map(quote).join(' ')}`;
const forwardAt=sandboxRoute.indexOf('-p');

// The Engine's server entry for one Agent's Open Design: ssh into the sandbox with the Run API forwarded. `engine` is the
// Engine's own name on the install network, which its Run API answers at.
/** @param {{profile:string,engine:string,key:string}} given @returns {{command:'ssh',args:string[]}|null} */
export function openDesignServer({profile,engine,key}) {
 if(!designProfileOf(profile)||typeof engine!=='string'||!hostName.test(engine)||typeof key!=='string'||!designKey.test(key)) return null;
 const forward=['-o','ExitOnForwardFailure=yes','-R',`${engineSocket(profile)}:${engine}:${runApiPort}`];
 return {command:'ssh',args:[...sandboxRoute.slice(0,forwardAt),...forward,...sandboxRoute.slice(forwardAt),remoteOf(profile,key)]};
}

// The design key of an entry gtmworks wrote for this Agent, or null for any other entry.
/** @param {unknown} server @param {string} profile @returns {string|null} */
export function openDesignKeyOf(server,profile) {
 const entry=/** @type {{command?:unknown,args?:unknown}|null} */(server&&typeof server==='object'?server:null);
 if(entry?.command!=='ssh'||!Array.isArray(entry.args)||!designProfileOf(profile)) return null;
 const remote=entry.args.at(-1);
 const key=typeof remote==='string'?/'([A-Za-z0-9_-]{32,200})'$/.exec(remote)?.[1]:undefined;
 if(!key) return null;
 const forward=entry.args[entry.args.indexOf('-R')+1];
 const engine=typeof forward==='string'?forward.slice(engineSocket(profile).length+1,-`:${runApiPort}`.length):'';
 const expected=openDesignServer({profile,engine,key});
 return expected&&JSON.stringify(expected.args)===JSON.stringify(entry.args)?key:null;
}
