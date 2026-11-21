// Open Design's daemon for one Agent, in the work sandbox (#544, ADR 0025). `open-design-mcp` runs this before it starts
// Open Design's MCP command: it keeps the Agent's route to the Company's Engine where hermes-engine.mjs reads it, starts
// the Agent's daemon unless one already answers, and prints the daemon's address.
//
//   node daemon.mjs <design profile> <key>     (from the Agent's own folder, /work/<agent>)
//
// One daemon per Agent: its data folder is `open-design` in the Agent's own folder of the Company's work folder, so a
// design it makes is beside that Agent's other work and in the Library. It listens on loopback only, on a port of its
// own kept beside the route. The route (the socket the Engine's ssh session forwards, the design profile and its key) is
// in the work user's home, never in the work folder the Library shows.
import { mkdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync, rmSync, renameSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

export const openDesign='/opt/open-design';
export const runtime='/usr/local/lib/gtmworks/open-design/hermes-engine.mjs';
const profileName=/^[a-z0-9][a-z0-9_-]{0,63}$/;

// The Agent whose folder this is, and the files kept for it.
/** @param {string} cwd */
export function agentPaths(cwd,home=homedir()) {
 const found=/^\/work\/([a-z0-9][a-z0-9_-]{0,63})$/.exec(cwd);
 if(!found) return null;
 const agent=found[1];
 const keep=`${home}/.gtmworks/open-design`;
 return {agent,data:`${cwd}/open-design`,route:`${keep}/${agent}.json`,port:`${keep}/${agent}.port`,lock:`${keep}/${agent}.lock`,
  log:`${keep}/${agent}.log`,socket:`${home}/.gtmworks/engine-${agent}.sock`};
}

// The socket the Engine's ssh session forwarded for this Agent is moved to a name of this session's own before the MCP
// server starts. Every session forwards to the same path (lib/open-design.mjs), and a second one, such as the Owner's
// Test while the Agent's own session is connected, would otherwise replace the first one's socket and take it away when
// it ends. hermes-engine.mjs tries this Agent's sockets newest first and drops one that no longer answers.
/** @param {string} socket */
export function adoptSocket(socket,now=Date.now(),pid=process.pid) {
 if(!existsSync(socket)) return null;
 const kept=`${socket.slice(0,-'.sock'.length)}-${String(now).padStart(15,'0')}-${pid}.sock`;
 try { renameSync(socket,kept); return kept; } catch { return null; }
}

/** @param {number} port */
async function answers(port) {
 try {
  const response=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(2000)});
  return response.ok&&(await response.json())?.ok===true;
 } catch { return false; }
}
const freePort=()=>new Promise((resolve,reject)=>{
 const server=createServer();
 server.once('error',reject);
 server.listen(0,'127.0.0.1',()=>{ const {port}=/** @type {import('node:net').AddressInfo} */(server.address()); server.close(()=>resolve(port)); });
});
const readPort=file=>{ try { const port=Number(readFileSync(file,'utf8').trim()); return Number.isInteger(port)&&port>0&&port<65536?port:null; } catch { return null; } };

// One start at a time for an Agent: a second caller waits for the first's lock file to go. A lock is broken only when
// the process that took it is gone (a start killed part way), never while its holder still waits for its daemon.
const alive=pid=>{ try { process.kill(pid,0); return true; } catch(failure) { return /** @type {any} */(failure)?.code==='EPERM'; } };
async function locked(file,work) {
 for(;;) {
  try { writeFileSync(file,`${process.pid}\n`,{flag:'wx'}); break; }
  catch {
   const holder=Number.parseInt((()=>{ try { return readFileSync(file,'utf8'); } catch { return ''; } })(),10);
   if(Number.isInteger(holder)&&holder>0&&!alive(holder)) rmSync(file,{force:true});
   else await sleep(500);
  }
 }
 try { return await work(); } finally { rmSync(file,{force:true}); }
}

/** @param {{profile:string,key:string,cwd?:string,home?:string}} given */
export async function ensureDaemon({profile,key,cwd=process.cwd(),home=homedir()}) {
 const paths=agentPaths(cwd,home);
 if(!paths) throw new Error('Open Design starts in an Agent\'s own folder of the work folder.');
 if(!profileName.test(profile)||typeof key!=='string'||!/^[A-Za-z0-9_-]{32,200}$/.test(key)) throw new Error('Open Design was given no route to the Engine.');
 mkdirSync(`${home}/.gtmworks/open-design`,{recursive:true,mode:0o700});
 writeFileSync(paths.route,`${JSON.stringify({profile,key})}\n`,{mode:0o600});
 adoptSocket(paths.socket);
 return locked(paths.lock,async()=>{
  const known=readPort(paths.port);
  if(known&&await answers(known)) return `http://127.0.0.1:${known}`;
  mkdirSync(paths.data,{recursive:true});
  // The design runtime is the Company's Engine (hermes-engine.mjs); a project starts with it chosen.
  const config=`${paths.data}/app-config.json`;
  if(!existsSync(config)) writeFileSync(config,`${JSON.stringify({agentId:'hermes'})}\n`);
  const port=await freePort();
  const log=openSync(paths.log,'a');
  const child=spawn(`${openDesign}/node`,[`${openDesign}/app/dist/cli.js`,'--no-open','--host','127.0.0.1','--port',String(port)],{
   cwd:paths.data,detached:true,stdio:['ignore',log,log],
   env:{...process.env,HOME:home,OD_DATA_DIR:paths.data,OD_PORT:String(port),OD_BIND_HOST:'127.0.0.1',HERMES_BIN:runtime}});
  child.unref();
  closeSync(log);
  writeFileSync(paths.port,`${port}\n`);
  for(let waited=0;waited<120;waited++) {
   if(await answers(port)) return `http://127.0.0.1:${port}`;
   if(child.exitCode!==null) break;
   await sleep(500);
  }
  throw new Error(`Open Design's daemon did not start; its log is ${paths.log}.`);
 });
}

if(import.meta.url===`file://${process.argv[1]}`) {
 const [profile,key]=process.argv.slice(2);
 ensureDaemon({profile,key}).then(url=>process.stdout.write(`${url}\n`),failure=>{ console.error(failure instanceof Error?failure.message:failure); process.exit(1); });
}
