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
import { mkdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync, rmSync, renameSync, linkSync, statSync } from 'node:fs';
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

// One start at a time for an Agent: a second caller waits for the first's lock to go. The lock is a file holding its
// holder's pid, written whole before it is linked into place, so a lock never exists without its pid. It is broken only
// when that process is gone (a start killed part way), never while its holder still waits for its daemon; a lock that
// still cannot be read (left by an older start) is broken once it is older than a start can take.
const alive=pid=>{ try { process.kill(pid,0); return true; } catch(failure) { return /** @type {any} */(failure)?.code==='EPERM'; } };
const startLimit=120_000;
/** @param {string} file @param {()=>Promise<string>} work */
export async function locked(file,work) {
 const mine=`${file}.${process.pid}`;
 writeFileSync(mine,`${process.pid}\n`);
 try {
  for(;;) {
   try { linkSync(mine,file); break; }
   catch {
    const holder=Number.parseInt((()=>{ try { return readFileSync(file,'utf8'); } catch { return ''; } })(),10);
    const age=(()=>{ try { return Date.now()-statSync(file).mtimeMs; } catch { return 0; } })();
    if(Number.isInteger(holder)&&holder>0?!alive(holder):age>startLimit) rmSync(file,{force:true});
    else await sleep(500);
   }
  }
 } finally { rmSync(mine,{force:true}); }
 try { return await work(); } finally { rmSync(file,{force:true}); }
}

// A daemon is stopped whole: its process group is asked to end, waited for a bounded time, and killed if any of it is still
// there, so a start's lock never goes while the old daemon could still take the port (#634).
/** @param {number} pid */
export const groupAlive=pid=>{ try { process.kill(-pid,0); return true; } catch(failure) { return /** @type {any} */(failure)?.code==='EPERM'; } };
// Answers whether the group is gone.
/** @param {import('node:child_process').ChildProcess} child @param {{grace?:number}} [options] @returns {Promise<boolean>} */
export async function stopGroup(child,{grace=10_000}={}) {
 const pid=child.pid;
 if(!pid) return true;
 const signal=name=>{ try { process.kill(-pid,name); } catch { try { child.kill(name); } catch {} } };
 signal('SIGTERM');
 for(const until=Date.now()+grace;Date.now()<until;) { if(!groupAlive(pid)) return true; await sleep(50); }
 signal('SIGKILL');
 for(const until=Date.now()+5000;Date.now()<until;) { if(!groupAlive(pid)) return true; await sleep(50); }
 return false;
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
  for(let waited=0;waited*500<startLimit;waited++) {
   if(await answers(port)) return `http://127.0.0.1:${port}`;
   if(child.exitCode!==null) break;
   await sleep(500);
  }
  // A daemon that never answered is stopped whole, a child it left included, before the lock goes, so the next start
  // makes the only one.
  const stopped=await stopGroup(child);
  rmSync(paths.port,{force:true});
  throw new Error(`Open Design's daemon did not start${stopped?'':' and could not be stopped'}; its log is ${paths.log}.`);
 });
}

if(import.meta.url===`file://${process.argv[1]}`) {
 const [profile,key]=process.argv.slice(2);
 ensureDaemon({profile,key}).then(url=>process.stdout.write(`${url}\n`),failure=>{ console.error(failure instanceof Error?failure.message:failure); process.exit(1); });
}
