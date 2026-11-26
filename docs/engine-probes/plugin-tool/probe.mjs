// Probe C of spec #822 (#828, #829): a tool an Engine plugin registers, called natively in a Run, that knows whether its
// Conversation is an Owner's, with the Engine's network closed to all but the fake model. Run it through run.sh beside
// it. It reads the Engine over HTTP; the host side only places the plugin's files in the data volume, restarts the
// Engine, and replaces its container as an update does.
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {engine,main,fail,must,manage,api,runs,makeProfile,startRun,waitRun,sleep,docker,restartEngine} from '../engine-stack/engine.mjs';

const PLUGIN='gtmworks-people';
const TOOL='gtmworks_make_agent';
const LEAD='lead';
const here=fileURLToPath(new URL('.',import.meta.url));
const say=line=>console.log(line);
const route=(profile,path='')=>`/api/plugins/${PLUGIN}/owner-sessions${path}?profile=${profile}`;
const mark=(profile,session,person='owner-1')=>must(`mark ${session} as an Owner's`,manage(route(profile),{method:'POST',body:{session_id:session,person}}));
const unmark=(profile,session)=>must(`take the mark off ${session}`,manage(route(profile,`/${encodeURIComponent(session)}`),{method:'DELETE'}));

// The plugin's files go into the profile's own folder in the data volume, owned by the Engine's user, as a person or the
// install would place them; nothing in the image changes.
function placePlugin(profile) {
 const target=`/opt/data/profiles/${profile}/plugins`;
 docker('exec','-u','10000',engine.container,'mkdir','-p',target);
 docker('cp',`${here}plugin`,`${engine.container}:${target}/${PLUGIN}`);
 docker('exec','-u','0',engine.container,'chown','-R','10000:10000',`${target}/${PLUGIN}`);
}

// One Run API Run that asks for the tool through the Engine's tool_call bridge, its event stream read whole.
async function callTool(profile,session,args,{direct=false}={}) {
 const call=direct?`CALL ${TOOL} ${JSON.stringify(args)}`:`CALL tool_call ${JSON.stringify({name:TOOL,arguments:args})}`;
 const run=await startRun(profile,`Please make an Agent.\n${call}\nREPLY done`,{session_id:session});
 const response=await fetch(`${engine.run}${runs(profile)}/${run.run_id}/events`,{headers:{Authorization:`Bearer ${engine.key}`},signal:AbortSignal.timeout(60000)});
 const text=await response.text();
 const events=text.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
 const tools=events.filter(event=>event.event?.startsWith('tool.')).map(event=>`${event.event} ${event.tool}${event.event==='tool.completed'?` error=${event.error}`:''}`);
 const result=await toolResult(profile,session);
 return {tools,result,events};
}
// What the tool answered, as the Engine stored it in the session.
// What the tool answered, as the Engine stored it in the session: the newest tool message that is this tool's answer
// (it carries `told`), else the newest tool message at all.
async function toolResult(profile,session) {
 const page=await must(`read ${session}`,manage(`/api/sessions/${encodeURIComponent(session)}/messages?profile=${profile}&order=latest&limit=30`));
 const parsed=page.messages.filter(message=>message.role==='tool').map(message=>{ try { return JSON.parse(message.content); } catch { return {raw:message.content}; } });
 return parsed.findLast(one=>one?.told)??parsed.at(-1)??null;
}
const named=(answer)=>answer.tools.includes(`tool.started ${TOOL}`)&&answer.tools.some(one=>one.startsWith(`tool.completed ${TOOL}`));
const short=result=>JSON.stringify(result?.success===undefined?result:{success:result.success,made:result.made,error:result.error});

await main(async()=>{
 say(`engine ${engine.image}`);
 say(`date ${new Date().toISOString().slice(0,10)}`);
 // --- the Engine's network --------------------------------------------------------------------------------------------
 const network=JSON.parse(docker('network','inspect',process.env.ENGINE_NETWORK))[0];
 const members=Object.values(network.Containers||{}).map(one=>one.Name).sort();
 say(`network ${network.Name}: internal=${network.Internal}, holds ${members.join(', ')}`);
 if(!network.Internal||members.length!==2) fail('the Engine\'s network holds only the Engine and the fake model, with no route out',JSON.stringify({internal:network.Internal,members}));
 // A stand-in for an install, on a network of its own: the Engine cannot open a connection to it.
 const install=`${engine.container.replace(/-engine$/,'')}-install`;
 docker('network','create',`${install}-net`);
 docker('run','-d','--name',install,'--network',`${install}-net`,'node:22.14.0-alpine3.21','node','-e',"require('http').createServer((q,s)=>s.end('install')).listen(8080)");
 const installIp=JSON.parse(docker('inspect',install))[0].NetworkSettings.Networks[`${install}-net`].IPAddress;
 const reach=docker('exec',engine.container,'/opt/hermes/.venv/bin/python','-c',
  `import socket\ns=socket.socket(); s.settimeout(4)\ntry:\n    s.connect(('${installIp}',8080)); print('open')\nexcept Exception as e:\n    print(type(e).__name__)`);
 say(`the Engine reaching an install stand-in at ${installIp}:8080: ${reach}`);
 if(reach==='open') fail('the Engine cannot reach an install','open');

 // --- the plugin in place -------------------------------------------------------------------------------------------
 await makeProfile(LEAD);
 placePlugin(LEAD);
 await must('enable the plugin on the profile',manage(`/api/config?profile=${LEAD}`,{method:'PUT',body:{config:{plugins:{enabled:[PLUGIN]}}}}));
 const before=await callTool(LEAD,'before-restart',{name:'ag-early',job:'Tries before the restart.'});
 say(`before an Engine restart: the route ${(await manage(route(LEAD))).status}, the tool ${short(before.result)}`);
 await restartEngine();
 const offered=await must('the profile\'s toolsets',api(`/p/${LEAD}/v1/toolsets`));
 const toolset=(offered.toolsets||offered.data||[]).find(one=>one.name==='gtmworks');
 say(`after the restart: toolset gtmworks on the Run API: ${JSON.stringify(toolset&&{name:toolset.name,enabled:toolset.enabled})}`);

 // --- the route is the Engine's own, behind its key -----------------------------------------------------------------
 for(const [label,key] of [['no key',''],['a wrong key',`probe-${randomUUID()}`]]) {
  const answer=await manage(route(LEAD),{key,method:'POST',body:{session_id:'forged',person:'nobody'}});
  say(`the plugin's route with ${label}: ${answer.status} ${answer.text.slice(0,80)}`);
  if(answer.status!==401) fail(`the plugin's route refuses ${label}`,`${answer.status} ${answer.text}`);
 }

 // --- the pass line: the Owner's session succeeds, another refuses --------------------------------------------------
 const owner='conversation-owner', other='conversation-manager';
 say(`mark ${owner}: ${JSON.stringify(await mark(LEAD,owner))}`);
 const deferred=await callTool(LEAD,owner,{name:'ag-direct',job:'Named directly.'},{direct:true});
 say(`the tool named directly in a Run: events ${JSON.stringify(deferred.tools)}, answer ${JSON.stringify(deferred.result).slice(0,200)}`);
 const yes=await callTool(LEAD,owner,{name:'ag-made',job:'Writes the ads.'});
 const no=await callTool(LEAD,other,{name:'ag-refused',job:'Should not be made.'});
 say(`Owner's session: events ${JSON.stringify(yes.tools)}, answer ${short(yes.result)}`);
 say(`other session: events ${JSON.stringify(no.tools)}, answer ${short(no.result)}`);
 say(`what the handler was told: ${JSON.stringify(yes.result?.told)}`);
 if(!named(yes)||!named(no)) fail('the Run\'s events name the tool',JSON.stringify({yes:yes.tools,no:no.tools}));
 if(yes.result?.success!==true||no.result?.success!==false||!/Owner/.test(no.result?.error||'')) fail('the tool succeeds for the Owner and refuses with a reason otherwise',JSON.stringify({yes:yes.result,no:no.result}));
 if(!yes.result.told.HERMES_SESSION_PLATFORM||yes.result.told.session_id!==owner) fail('the handler knows its session and platform',JSON.stringify(yes.result.told));

 // --- the job: the profile the tool made takes a Run at once --------------------------------------------------------
 const listed=(await must('list profiles',manage('/api/profiles')));
 const names=(Array.isArray(listed)?listed:listed.profiles).map(one=>one.name);
 const first=await startRun('ag-made','Hello, new Agent.\nREPLY the new Agent answers');
 const firstDone=await waitRun('ag-made',first.run_id);
 say(`the profile the tool made: listed=${names.includes('ag-made')}; a Run on it right after: ${firstDone.status} "${firstDone.output}"`);
 if(firstDone.status!=='completed') fail('the new profile answers a Run with no restart',JSON.stringify(firstDone));

 // --- a board worker's Run ------------------------------------------------------------------------------------------
 const card=async(markIt,agent)=>{
  const body=`Make an Agent.\nCALL tool_call ${JSON.stringify({name:TOOL,arguments:{name:agent,job:'Made from the board.'}})}\nCALL kanban_complete {"summary":"asked for ${agent}"}\nREPLY done`;
  // Made with no assignee so the dispatcher leaves it until it is marked, then given to the main Agent.
  const made=(await must('make a Card',manage('/api/plugins/kanban/tasks',{method:'POST',body:{title:`Make ${agent}`,body}}))).task;
  if(markIt) await mark(LEAD,`card:${made.id}`);
  await must('give the Card to the main Agent',manage(`/api/plugins/kanban/tasks/${made.id}`,{method:'PATCH',body:{assignee:LEAD}}));
  await must('dispatch',manage('/api/plugins/kanban/dispatch',{method:'POST'}));
  const until=Date.now()+180000;
  for(;;) {
   const task=(await must('read the Card',manage(`/api/plugins/kanban/tasks/${made.id}`))).task;
   if(['done','blocked','review'].includes(task.status)) break;
   if(Date.now()>until) fail(`Card ${made.id} ends`,JSON.stringify(task).slice(0,400));
   await sleep(2000);
  }
  const worker=(await must('list the worker sessions',manage(`/api/sessions?profile=${LEAD}&source=kanban&order=recent&limit=20`))).sessions;
  for(const session of worker) {
   const result=await toolResult(LEAD,session.id);
   if(result?.told?.HERMES_KANBAN_TASK===made.id) return {card:made.id,session:session.id,result};
  }
  fail(`the worker of ${made.id} called the tool`,JSON.stringify(worker.map(one=>one.id)));
 };
 const boardYes=await card(true,'ag-board');
 const boardNo=await card(false,'ag-board-refused');
 say(`board worker, Card marked: session ${boardYes.session}, answer ${short(boardYes.result)}`);
 say(`board worker, Card not marked: answer ${short(boardNo.result)}`);
 say(`what a board worker's handler was told: ${JSON.stringify(boardYes.result.told)}`);
 if(boardYes.result.success!==true||boardNo.result.success!==false) fail('the board worker\'s call follows the Card\'s mark',JSON.stringify({boardYes,boardNo}));

 // --- staying: a restart, and an update's new container on the same volume ------------------------------------------
 await restartEngine();
 const afterRestart=await callTool(LEAD,owner,{name:'ag-after-restart',job:'After a restart.'});
 say(`after an Engine restart: marks ${JSON.stringify((await must('marks',manage(route(LEAD)))).sessions.map(one=>one.session_id))}, the tool ${short(afterRestart.result)}`);
 if(afterRestart.result?.success!==true) fail('the plugin and its marks survive a restart',JSON.stringify(afterRestart.result));
 // An update pulls a new image and recreates the Engine's container on the same data volume (scripts/install.sh);
 // the image here is the same pin, so this shows the container's own files going and the volume staying.
 const inspect=JSON.parse(docker('inspect',engine.container))[0];
 const env=inspect.Config.Env.flatMap(value=>['-e',value]);
 docker('rm','-f',engine.container);
 docker('run','-d','--name',engine.container,'--network',process.env.ENGINE_NETWORK,'--ip',inspect.NetworkSettings.Networks[process.env.ENGINE_NETWORK].IPAMConfig.IPv4Address,
  ...env,'-v',`${process.env.ENGINE_VOLUME}:/opt/data`,engine.image,'sh','-ec','exec hermes gateway run');
 await restartEngine();
 const afterUpdate=await callTool(LEAD,owner,{name:'ag-after-update',job:'After a new container.'});
 say(`after a new Engine container on the same volume: the tool ${short(afterUpdate.result)}; plugin files at /opt/data/profiles/${LEAD}/plugins/${PLUGIN}: ${docker('exec',engine.container,'ls',`/opt/data/profiles/${LEAD}/plugins/${PLUGIN}`).split('\n').join(' ')}; marks in /opt/data/profiles/${LEAD}/plugin-data/${PLUGIN}: ${docker('exec',engine.container,'ls',`/opt/data/profiles/${LEAD}/plugin-data/${PLUGIN}`).split('\n').join(' ')}`);
 if(afterUpdate.result?.success!==true) fail('the plugin survives a new container on the same volume',JSON.stringify(afterUpdate.result));

 // --- ending: how long a session stays an Owner's after the mark is taken off ---------------------------------------
 let longest=0;
 for(let i=0;i<5;i++) {
  const session=`ending-${i}`;
  await mark(LEAD,session);
  const kept=await callTool(LEAD,session,{name:`ag-end-${i}`,job:'While marked.'});
  if(kept.result?.success!==true) fail('a marked session succeeds',JSON.stringify(kept.result));
  await unmark(LEAD,session);
  const removedAt=performance.now();
  const after=await callTool(LEAD,session,{name:`ag-end-${i}-late`,job:'After the mark.'});
  const startedAfter=(performance.now()-removedAt)/1000;
  if(after.result?.success!==false) fail('the first call after the mark is taken off is refused',JSON.stringify(after.result));
  longest=Math.max(longest,startedAfter);
 }
 say(`ending: in 5 tries the first call after the mark was taken off was refused each time; the longest that call took from the route's answer to the refusal in the session: ${(longest*1000).toFixed(0)} ms, and no call in between succeeded`);
 // --- the setting that puts the tool in a Run's own list, not behind the bridge -------------------------------------
 await must('turn tool search off on the profile',manage(`/api/config?profile=${LEAD}`,{method:'PUT',body:{config:{tools:{tool_search:{enabled:'off'}}}}}));
 const eager=await callTool(LEAD,owner,{name:'ag-eager',job:'Named directly with tool search off.'},{direct:true});
 say(`with tools.tool_search.enabled: off on the profile, the tool named directly: events ${JSON.stringify(eager.tools)}, answer ${short(eager.result)}`);
 if(!named(eager)||eager.result?.success!==true) fail('with tool search off the tool is in the Run\'s own list',JSON.stringify(eager));
 docker('rm','-f',install);
 docker('network','rm',`${install}-net`);
 say('probe complete');
});
