import { companyEngine } from './engine/handle.mjs';
import { isMainAgentProfile } from './agent-toolsets.mjs';

// gtmworks's plugin of the main Agent's profile (#884, spec #865) kept in place on each Company's Engine by the worker.
// The plugin's files ship with this release (lib/engine/gtmworks-plugin/) and the Engine handle writes them through the
// Engine's own management listener (lib/engine/plugin.mjs); the Engine image is not changed, and the Engine reaches
// nothing of the install. For each main Agent's profile the database names (engine_tools_due, the profiles its Agents
// run on), the worker:
//  - reads whether the profile holds this release's plugin, file for file, with its name enabled; when it does not (the
//    profile is new, or a release changed the plugin), writes what differs;
//  - restarts the Engine once after writing it, since the Engine loads a profile's plugins only when it starts, and
//    waits for a moment when the Engine works no turn, so the restart stops no Run;
//  - finds the plugin's toolset offered to the profile's Runs at this release's revision (lib/engine/plugin.mjs
//    pluginRevision), and then leaves the profile alone a while.
// Every Engine start is met the same way: the worker reads each profile again when it starts, so an update, whose new
// worker starts beside the new Engine, and a restore, which brings back the plugin with the Engine's volume, each find it
// and restart nothing. A profile whose plugin is still not offered after its restart is not restarted again by this
// worker; its next start tries again.

// How long a profile found with its plugin offered is left before it is read again, and how long an Engine is given to
// start again after its restart before the profile is read.
const recheck=10*60000;
const starting=20000;
const waits={offered:recheck,stuck:recheck,restarted:starting,restart:0};

/** @typedef {{state:'offered'|'restart'|'restarted'|'stuck',at:number}} Kept */

/** @param {any} db @param {{kept?:Map<string,Kept>,now?:()=>number}} [options] */
export async function keepMainAgentPlugins(db,{kept=new Map(),now=Date.now}={}) {
 const done={placed:0,restarted:0,offered:0};
 const {data:due,error}=await db.rpc('engine_tools_due');
 if(error) throw new Error(error.message);
 const seen=new Set();
 for(const {company_id:company,profile} of due||[]) {
  if(!isMainAgentProfile(profile)||seen.has(profile)) continue;
  seen.add(profile);
  const last=kept.get(profile);
  if(last&&now()-last.at<waits[last.state]) continue;
  const on=(await companyEngine(company))?.on(profile);
  if(!on) continue;
  try { await keepOne(on,{profile,kept,now,done}); }
  catch(failure) { console.error('Main Agent plugin not kept:',profile,failure?.message||'unknown error'); }
 }
 return done;
}

/** @param {any} on @param {{profile:string,kept:Map<string,Kept>,now:()=>number,done:any}} options */
async function keepOne(on,{profile,kept,now,done}) {
 const read=await on.plugin.read();
 const state=kept.get(profile)?.state;
 // Files written in this pass are restarted for; a restart still owed from an earlier pass is checked first, since a
 // restart whose answer was lost may have loaded them already.
 let written=false;
 if(read.state==='differs') {
  if((await on.plugin.place(read)).state!=='placed') return;
  done.placed++;
  written=true;
 } else if(read.state!=='placed') return;
 if(!written) {
  // Offered at this release's revision, so the running Engine loaded these files and not an earlier release's: a worker
  // that stopped after writing them and before the restart leaves the earlier revision offered, which is restarted.
  const offered=await on.plugin.offered();
  if(offered.state!=='found') return;
  if(offered.current) { kept.set(profile,{state:'offered',at:now()}); done.offered++; return; }
  // Restarted once by this worker and still not offered: the Engine did not load it. It is not restarted again here.
  if(state==='restarted'||state==='stuck') {
   if(state==='restarted') console.error('Main Agent plugin not offered after its Engine restarted:',profile);
   kept.set(profile,{state:'stuck',at:now()});
   return;
  }
  // Placed and not offered: placed before an Engine that never restarted since (a worker stopped between the two), or
  // a restart owed from an earlier pass.
 }
 kept.set(profile,{state:'restart',at:now()});
 if(await on.plugin.busy()) return;
 if((await on.plugin.restart()).state!=='restarting') return;
 kept.set(profile,{state:'restarted',at:now()});
 done.restarted++;
}
