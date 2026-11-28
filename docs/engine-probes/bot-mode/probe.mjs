// Probe of #969: how much of Hermes's Bot Mode can gtmworks use from a server, with no Desktop program? It builds
// nothing in the product: it asks six questions of a throwaway Engine of `engine-stack/` (#823), started by run.sh with
// the install's managed configuration and a Work sandbox, through the Engine's own routes only (the Run API, the
// management listener's REST routes and its JSON-RPC socket `/api/ws`), and the fake model's record of what it was sent.
// It ends with one verdict for each of the three parts, and exits non-zero when an answer differs from the record
// (docs/engine-probes/bot-mode.md).
import {randomUUID} from 'node:crypto';
import {engine,main,fail,must,manage,api,runs,makeProfile,startRun,waitRun,readRun,sleep} from '../engine-stack/engine.mjs';

const ALPHA='alpha', BETA='beta', GAMMA='gamma';
const TITLE='Bot Chat';
const say=line=>console.log(line);
const answers={};
const record=(question,ok,why)=>{ answers[question]=ok; say(`${ok?'YES':'NO '} question ${question}: ${why}`); };
const q=profile=>`?profile=${encodeURIComponent(profile)}`;
const seconds=ms=>`${(ms/1000).toFixed(1)} s`;
const mark=()=>randomUUID().slice(0,8);

// --- the Engine's JSON-RPC socket, as the Desktop speaks it ---------------------------------------------------------
// A single-use ticket from the management listener (POST /api/auth/ws-ticket, the Engine's own key), then one JSON-RPC
// call on /api/ws (hermes_cli/web_routers/chat_ws.py:650, tui_gateway/ws.py).
async function rpc(method,params={}) {
 const {ticket}=await must('mint a socket ticket',manage('/api/auth/ws-ticket',{method:'POST',body:{}}));
 const socket=new WebSocket(`${engine.manage.replace(/^http/,'ws')}/api/ws?ticket=${encodeURIComponent(ticket)}`);
 return await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{ socket.close(); reject(new Error(`${method}: no answer on /api/ws in 30 s`)); },30000);
  socket.onopen=()=>socket.send(JSON.stringify({jsonrpc:'2.0',id:1,method,params}));
  socket.onmessage=frame=>{ const data=JSON.parse(frame.data); if(data.id!==1) return; clearTimeout(timer); socket.close(); if(data.error) reject(new Error(`${method}: ${JSON.stringify(data.error)}`)); else resolve(data.result); };
  socket.onerror=()=>{ clearTimeout(timer); reject(new Error(`${method}: the socket failed`)); };
 });
}

// --- reads ----------------------------------------------------------------------------------------------------------
const sessions=async profile=>(await must(`list ${profile}'s sessions`,manage(`/api/sessions${q(profile)}&order=recent&limit=50`))).sessions;
const botChat=async profile=>(await sessions(profile)).find(row=>row.title===TITLE)??null;
// The session routes spec #864 reads a Conversation with (lib/engine/sessions.mjs).
const messages=async(profile,session)=>(await must(`read ${session}'s messages`,manage(`/api/sessions/${encodeURIComponent(session)}/messages${q(profile)}&order=oldest&limit=200&inline_images=false`))).messages;
const sessionRow=(profile,session)=>must(`read session ${session}`,manage(`/api/sessions/${encodeURIComponent(session)}${q(profile)}`));
const requests=()=>fetch(`${process.env.MODEL_ADDRESS}/requests`).then(response=>response.json());
// How many kept model requests hold `text` anywhere in their body, the system prompt included.
const mentions=text=>fetch(`${process.env.MODEL_ADDRESS}/requests?contains=${encodeURIComponent(text)}`).then(response=>response.json());
// The newest model request that offered tools and whose newest user message names `marker`.
async function sentFor(marker) {
 const hit=[...await requests()].reverse().find(one=>one.tools.length&&String(one.users.at(-1)??'').includes(marker));
 if(!hit) fail(`the fake model saw the turn ${marker}`,'no request');
 return hit;
}
const until=async(step,fn,{timeout=90000,every=500}={})=>{
 const end=Date.now()+timeout;
 for(;;) { const value=await fn(); if(value) return value; if(Date.now()>end) fail(step,`nothing within ${timeout/1000} s`); await sleep(every); }
};
const turn=async(profile,input,extra)=>{ const run=await startRun(profile,input,extra); return {run,done:await waitRun(profile,run.run_id)}; };
const firstLine=text=>String(text??'').split('\n')[0];

await main(async()=>{
 say(`engine ${engine.image}`);
 say(`managed configuration mounted: terminal backend ssh to the Work sandbox (${process.env.SANDBOX_HOSTNAME})`);
 for(const name of [ALPHA,BETA,GAMMA]) await makeProfile(name);

 // --- 1. Making a Bot Chat, with no Desktop and no shell in the Engine's container -----------------------------------
 const listed=await rpc('profiles.list');
 say(`question 1: /api/ws profiles.list answers bot_mode_protocol ${listed.bot_mode_protocol}; ${ALPHA}'s canonical_session ${JSON.stringify(listed.profiles.find(row=>row.name===ALPHA)?.canonical_session)}`);
 // The Desktop's Bots editor marks a profile with `profiles.configure` (tui_gateway/methods_profiles.py:386): it merges
 // ui_meta into the profile's profile.yaml. Only alpha and beta are marked; gamma is left as an ordinary profile.
 for(const [name,title] of [[ALPHA,'Alpha Writer'],[BETA,'Beta Analyst']]) {
  const configured=await rpc('profiles.configure',{name,ui_meta:{'hermes-bots':{title}},description:`${title}: the probe's ${name}`});
  if(configured.ok!==true||configured.applied?.ui_meta!==true) fail(`mark ${name} as Bot-Mode-managed`,JSON.stringify(configured));
 }
 const marked=(await rpc('profiles.list')).profiles.find(row=>row.name===ALPHA);
 say(`question 1: profiles.configure wrote ${ALPHA}'s profile.yaml: ui_meta ${JSON.stringify(marked.ui_meta)}, revisions ${JSON.stringify(marked.ui_meta_revisions)}`);
 // The Bot Chat is made on the Run API, as `hermes peer dm` makes one (gateway/platforms/api_server_bot_chat.py:34).
 const made=await api(`/p/${ALPHA}/api/sessions`,{method:'POST',body:{title:TITLE}});
 if(made.status!==201) fail(`make ${ALPHA}'s Bot Chat`,`${made.status} ${made.text.slice(0,300)}`);
 const chat=made.json.session;
 const again=await api(`/p/${ALPHA}/api/sessions`,{method:'POST',body:{title:TITLE}});
 const extra=await api(`/p/${ALPHA}/api/sessions`,{method:'POST',body:{title:TITLE,system_prompt:'x'}});
 const canonical=(await rpc('profiles.list')).profiles.find(row=>row.name===ALPHA).canonical_session;
 say(`question 1: POST /p/${ALPHA}/api/sessions {title:"${TITLE}"} answered ${made.status}: id ${chat.id}, source ${chat.source}, user_id ${chat.user_id}; a second create ${again.status} ${again.json?.error?.code}; a create with a system prompt ${extra.status} ${extra.json?.error?.code}; profiles.list now names canonical_session ${canonical?.id}`);
 record(1,made.status===201&&chat.id.startsWith('local-')&&again.status===400&&again.json?.error?.code==='invalid_title'
  &&extra.status===400&&extra.json?.error?.code==='bot_chat_parameters_unsupported'&&canonical?.id===chat.id,
  'a profile is marked with /api/ws profiles.configure (ui_meta in its profile.yaml) and its one Bot Chat is made with POST /api/sessions on the Run API, both on the Engine\'s own routes');

 // --- 2. A turn in it ---------------------------------------------------------------------------------------------
 const m2=mark();
 const first=await turn(ALPHA,`Hello from a person ${m2}.\nREPLY hello back ${m2}`,{session_id:chat.id,author:{id:'member:mona',name:'Mona'}});
 const sent2=await sentFor(m2);
 const m2b=mark();
 const second=await turn(ALPHA,`A second message ${m2b}.\nREPLY second reply ${m2b}`,{session_id:chat.id});
 const sent2b=await sentFor(m2b);
 const history=sent2b.users.some(text=>text.includes(m2));
 // The same profile, an ordinary session: what a gtmworks Conversation is today.
 const m2c=mark();
 const plain=await turn(ALPHA,`An ordinary Conversation ${m2c}.\nREPLY plain ${m2c}`,{session_id:`probe-plain-${m2c}`});
 const sentPlain=await sentFor(m2c);
 // gamma is not marked, but the gate is any profile on the install (tools/bot_mode_probe.py:139).
 const gammaChat=(await must(`make ${GAMMA}'s Bot Chat`,api(`/p/${GAMMA}/api/sessions`,{method:'POST',body:{title:TITLE}}))).session;
 const m2d=mark();
 await turn(GAMMA,`To the unmarked profile ${m2d}.\nREPLY gamma ${m2d}`,{session_id:gammaChat.id});
 const sentGamma=await sentFor(m2d);
 const row2=await sessionRow(ALPHA,chat.id);
 const read2=await messages(ALPHA,chat.id);
 // The Run's own event stream, which carries a Conversation's live stream today (ADR 0029), for a Bot Chat turn and for
 // an ordinary one.
 const streamed=async(session,marker)=>{
  const run=await startRun(ALPHA,`Stream ${marker}.\nCALL skills_list {"category":"none"}\nREPLY streamed ${marker}`,{session_id:session});
  const response=await fetch(`${engine.run}${runs(ALPHA)}/${run.run_id}/events`,{headers:{Authorization:`Bearer ${engine.key}`},signal:AbortSignal.timeout(60000)});
  const text=await response.text();
  await waitRun(ALPHA,run.run_id);
  return [...text.matchAll(/^data: (.*)$/gm)].map(([,data])=>{ try { return JSON.parse(data).event; } catch { return '?'; } });
 };
 const chatEvents=await streamed(chat.id,mark());
 const plainEvents=await streamed(`probe-plain-${m2c}`,mark());
 // Stop, as a Conversation's Stop asks it (lib/engine/runs.mjs stopRun): the Run's own stop route, mid-turn.
 const m2s=mark();
 const slow=await startRun(ALPHA,`A slow turn ${m2s}.\nDELAY 8\nREPLY slow reply ${m2s}`,{session_id:chat.id});
 await sleep(2000);
 const stop=await api(`${runs(ALPHA)}/${slow.run_id}/stop`,{method:'POST',body:{}});
 const stopped=await waitRun(ALPHA,slow.run_id);
 const finished=await until('the stopped turn\'s reply',async()=>(await messages(ALPHA,chat.id)).some(one=>one.role==='assistant'&&String(one.content).includes(`slow reply ${m2s}`)),{timeout:30000}).catch(()=>false);
 const stoppedEnd=await until('the stopped Run settles',async()=>{ const read=await readRun(ALPHA,slow.run_id); return read.status==='stopping'?null:read; },{timeout:30000});
 say(`question 2: a Run with session_id ${chat.id} ended ${first.done.status} (session ${first.done.session_id}, delivery_id ${first.done.delivery_id}), output "${first.done.output}"`);
 say(`question 2: the model was offered message_agent: ${sent2.tools.includes('message_agent')}; its prompt's sections: ${sent2.headings.join(' | ')}; its roster: ${sent2.roster.join(' ')}`);
 say(`question 2: the next turn's request held the first turn (history): ${history}; the session's title is still "${row2.title}", ${read2.length} messages read back on GET /api/sessions/<id>/messages: ${read2.map(one=>`${one.role}${one.display_kind?`(${one.display_kind})`:''}`).join(', ')}`);
 say(`question 2: an ordinary session of the same profile: message_agent offered ${sentPlain.tools.includes('message_agent')}, sections ${sentPlain.headings.join(' | ')}`);
 say(`question 2: the unmarked profile ${GAMMA}'s Bot Chat: message_agent offered ${sentGamma.tools.includes('message_agent')}, "Messaging other agents" ${sentGamma.headings.includes('## Messaging other agents')}`);
 say(`question 2: the Run's event stream: a Bot Chat turn sent ${JSON.stringify(chatEvents)}; an ordinary turn sent ${plainEvents.length} events (${[...new Set(plainEvents)].join(', ')})`);
 say(`question 2: Stop mid-turn on a Bot Chat Run: the stop route answered ${stop.status}, the Run read ${stopped.status} and then ended ${stoppedEnd.status}, and the turn ${finished?'still finished in the Bot Chat (its reply is there)':'left no reply'}`);
 record(2,first.done.status==='completed'&&first.done.session_id===chat.id&&second.done.status==='completed'&&plain.done.status==='completed'
  &&sent2.tools.includes('message_agent')&&sent2.headings.includes('## Messaging other agents')&&history&&row2.title===TITLE
  &&!sentPlain.tools.includes('message_agent')&&!sentPlain.headings.includes('## Messaging other agents'),
  'a Run in the Bot Chat is a Bot Chat turn: title and history kept, the section and message_agent offered, read back on the session routes; but its event stream carries only run.completed');
 answers['2-stream']=chatEvents.length===1&&chatEvents[0]==='run.completed'&&plainEvents.length>1;
 answers['2-install-wide']=sentGamma.tools.includes('message_agent');
 answers['2-stop-reaches-turn']=!(stop.status===200&&stoppedEnd.status==='cancelled'&&finished);

 // --- 3. Who is speaking ------------------------------------------------------------------------------------------
 const firstUser=read2.find(one=>one.role==='user'&&String(one.content).includes(m2));
 const storedJSON=JSON.stringify(read2)+JSON.stringify(row2);
 const runJSON=JSON.stringify(await readRun(ALPHA,first.run.run_id));
 const told=await mentions('Mona');
 say(`question 3: author {name:"Mona"} on the Run: model requests whose whole body (system prompt included) names Mona: ${told.count} of ${told.of}; the session's messages and row name Mona ${storedJSON.includes('Mona')}; the Run's read-back names Mona ${runJSON.includes('Mona')}`);
 say(`question 3: the stored user message carries platform_message_id ${firstUser?.platform_message_id} and message_uid ${firstUser?.message_uid}; the Run answered delivery_id ${first.done.delivery_id}`);
 const joins=firstUser?.platform_message_id===`bot:${first.done.delivery_id}`;
 record(3,told.count===0&&!storedJSON.includes('Mona')&&!runJSON.includes('Mona')&&joins,
  'the Engine keeps no person\'s name: the model is not told it, the session does not store it and no read gives it back; the Run\'s delivery_id is the stored message\'s platform_message_id "bot:<delivery_id>", so gtmworks keeps one row per message (delivery_id, Member)');

 // --- 4. Several people at once -----------------------------------------------------------------------------------
 const [mm,mk]=[mark(),mark()];
 const t4=Date.now();
 const [mona,karim]=await Promise.all([
  api(runs(ALPHA),{method:'POST',body:{input:`From Mona ${mm}.\nDELAY 4\nREPLY to Mona ${mm}`,session_id:chat.id,author:{id:'member:mona',name:'Mona'}}}),
  api(runs(ALPHA),{method:'POST',body:{input:`From Karim ${mk}.\nDELAY 1\nREPLY to Karim ${mk}`,session_id:chat.id,author:{id:'member:karim',name:'Karim'}}})]);
 say(`question 4: two Runs started at once in ${ALPHA}'s Bot Chat: Mona's answered ${mona.status} ${mona.json?.status}, Karim's ${karim.status} ${karim.json?.status}`);
 if(mona.status!==202||karim.status!==202) fail('both Runs are accepted',`${mona.text} ${karim.text}`);
 const [dm,dk]=await Promise.all([waitRun(ALPHA,mona.json.run_id),waitRun(ALPHA,karim.json.run_id)]);
 const ends=[['Mona',dm],['Karim',dk]].sort((a,b)=>a[1].updated_at-b[1].updated_at);
 const gap=Math.abs(dm.updated_at-dk.updated_at);
 const later=ends[1][0]==='Mona'?4:1;
 const read4=(await messages(ALPHA,chat.id)).filter(one=>String(one.content).includes(mm)||String(one.content).includes(mk));
 say(`question 4: Mona's ended ${dm.status} "${dm.output}", Karim's ${dk.status} "${dk.output}"; ${ends[0][0]}'s ended first, the other ${gap.toFixed(1)} s later (its model took ${later} s); all done ${seconds(Date.now()-t4)} after the start`);
 say(`question 4: the Bot Chat holds them in this order: ${read4.map(one=>`${one.role}:${firstLine(one.content)}`).join(' / ')}`);
 const serial=gap>=later-0.3&&read4.length===4&&read4[0].role==='user'&&read4[1].role==='assistant'&&read4[2].role==='user'&&read4[3].role==='assistant';
 record(4,dm.status==='completed'&&dk.status==='completed'&&dm.output===`to Mona ${mm}`&&dk.output===`to Karim ${mk}`&&serial,
  'queued: both callers get 202 and a Run of their own; the Bot Chat runs them one after the other, each turn whole, and each caller reads back its own reply');

 // --- 5. A Routine's result ---------------------------------------------------------------------------------------
 const routine=async(name,prompt,more={})=>{
  const before=(await messages(ALPHA,chat.id)).length;
  const job=await must(`make Routine ${name}`,manage(`/api/cron/jobs${q(ALPHA)}`,{method:'POST',body:{name,prompt,schedule:'every 12h',deliver:'bot-chat',...more}}));
  const started=Date.now();
  await must(`run Routine ${name} now`,manage(`/api/cron/jobs/${job.id}/trigger${q(ALPHA)}`,{method:'POST',timeout:30000}));
  return {job,before,started};
 };
 const settled=async(job)=>until(`Routine ${job.id} records its run`,async()=>{
  const read=await must('read the Routine',manage(`/api/cron/jobs/${job.id}${q(ALPHA)}`));
  return read.last_run_at?read:null;
 });
 // A result's way into the Bot Chat: the cron worker queues the send, and the gateway drains its delivery queue on its
 // housekeeping tick (60 s) or as soon as its watch sees the queue change (gateway/run_delivery_queue_watch.py). So two
 // results in a row: the first on a profile the watch may not watch yet, the second once it does.
 const delivered=async()=>{
  const m5=mark();
  const brief=await routine(`brief-${m5}`,`Write the brief.\nREPLY Today: three leads came in ${m5}.`);
  const arrived=await until('the result arrives in the Bot Chat',async()=>{
   const all=await messages(ALPHA,chat.id);
   const at=all.findIndex((one,index)=>index>=brief.before&&one.role==='user'&&String(one.content).includes(m5));
   return at>=0&&all.slice(at+1).some(one=>one.role==='assistant')?{all,at,ms:Date.now()-brief.started}:null;
  },{timeout:150000});
  const job=await settled(brief.job);
  // Timed from the run's own end on the Engine's clock (the job's last_run_at and the message's timestamp).
  const afterRun=Number(arrived.all[arrived.at].timestamp)-Date.parse(job.last_run_at)/1000;
  return {brief,arrived,job,afterRun,turn:arrived.all[arrived.at],answer:arrived.all.slice(arrived.at+1).find(one=>one.role==='assistant')};
 };
 const r5a=await delivered();
 const r5b=await delivered();
 const turn5=r5a.turn, briefJob=r5a.job;
 const briefRuns=await must('read the Routine\'s runs',manage(`/api/cron/jobs/${r5a.brief.job.id}/runs${q(ALPHA)}&limit=3`));
 say(`question 5: a Routine with deliver "bot-chat", run now: its result is in the Bot Chat as a ${turn5.role} message (display_kind ${turn5.display_kind}, platform_message_id ${String(turn5.platform_message_id).slice(0,16)}…): ${JSON.stringify(String(turn5.content).slice(0,200))}`);
 say(`question 5: timings: the first result ${seconds(r5a.arrived.ms)} after the trigger, ${r5a.afterRun.toFixed(1)} s after its run was recorded; the second ${seconds(r5b.arrived.ms)} after the trigger, ${r5b.afterRun.toFixed(1)} s after its run`);
 say(`question 5: the Agent answered it in the Bot Chat: ${JSON.stringify(r5a.answer?.content)}; the job: last_status ${briefJob.last_status}, last_delivery_queued ${JSON.stringify(briefJob.last_delivery_queued)}; its own run session is still listed (${briefRuns.runs?.[0]?.source} ${String(briefRuns.runs?.[0]?.id).slice(0,16)}…)`);
 const silentBefore=(await messages(ALPHA,chat.id)).length;
 const silent=await routine(`silent-${mark()}`,'Nothing new today.\nREPLY [SILENT]');
 const silentJob=await settled(silent.job);
 await sleep(15000);
 const silentAfter=(await messages(ALPHA,chat.id)).length;
 say(`question 5: a Routine that answers [SILENT]: last_status ${silentJob.last_status}, ${silentAfter-silentBefore} new messages in the Bot Chat 15 s after its run`);
 const m5f=mark();
 // A run that fails: a base_url with no provider is refused by the Engine's own safety check before the model is called.
 const broken=await routine(`broken-${m5f}`,'This run fails.',{base_url:'http://fake-model:9/v1'});
 const notice=await until('the failure notice arrives',async()=>{
  const all=await messages(ALPHA,chat.id);
  return all.slice(broken.before).find(one=>one.role==='user'&&String(one.content).includes(`broken-${m5f}`))??null;
 });
 const brokenJob=await settled(broken.job);
 say(`question 5: a Routine that fails: last_status ${brokenJob.last_status}; its notice is in the Bot Chat as a user message, display_metadata ${JSON.stringify(notice.display_metadata)}: ${JSON.stringify(String(notice.content).slice(0,220))}`);
 record(5,turn5.role==='user'&&String(turn5.content).startsWith('[Cronjob "')&&briefJob.last_status==='ok'&&r5b.job.last_status==='ok'&&Math.max(r5a.afterRun,r5b.afterRun)<65&&silentAfter===silentBefore
  &&brokenJob.last_status==='error'&&notice.display_metadata?.notification_category==='diagnostic',
  'the result arrives by itself as a Bot Chat turn within one housekeeping tick (60 s) of the run and the Agent answers it; [SILENT] leaves nothing; a failure notice arrives in the same Bot Chat as a diagnostic turn');

 // --- 6. Agent to Agent -------------------------------------------------------------------------------------------
 // First, the Agent's own terminal in its Bot Chat: the managed backend sends it to the Work sandbox, which holds no Hermes.
 const m6t=mark();
 await turn(ALPHA,`Where is my terminal ${m6t}?\nCALL terminal {"command":"hostname; command -v hermes || echo no-hermes-here"}\nREPLY looked ${m6t}`,{session_id:chat.id});
 const terminalOut=(await messages(ALPHA,chat.id)).filter(one=>one.role==='tool'&&one.tool_name==='terminal').at(-1);
 const inSandbox=String(terminalOut?.content).includes(process.env.SANDBOX_HOSTNAME)&&String(terminalOut?.content).includes('no-hermes-here');
 say(`question 6: the Agent's terminal in its Bot Chat answered ${JSON.stringify(String(terminalOut?.content).slice(0,160))} (the Work sandbox is ${process.env.SANDBOX_HOSTNAME})`);
 const betaBefore=await botChat(BETA);
 const m6=mark();
 const before6=(await messages(ALPHA,chat.id)).length;
 const t6=Date.now();
 const asked=await turn(ALPHA,`Ask beta for the numbers ${m6}.\nCALL message_agent {"target":"beta","message":"Send me the lead count ${m6}.\\nREPLY beta says 42 leads ${m6}"}\nREPLY asked beta ${m6}`,{session_id:chat.id,author:{id:'member:mona',name:'Mona'}});
 const ack=(await messages(ALPHA,chat.id)).slice(before6).find(one=>one.role==='tool'&&one.tool_name==='message_agent');
 const back=await until('the reply comes back to alpha\'s Bot Chat',async()=>{
  const all=(await messages(ALPHA,chat.id)).slice(before6);
  const note=all.find(one=>one.role==='user'&&one.display_kind==='process_complete'&&String(one.content).includes(`beta says 42 leads ${m6}`));
  return note?{note,ms:Date.now()-t6}:null;
 },{timeout:120000});
 // Does anything wake alpha to act on the reply? A model request that carries the completion notice (its "Background
 // process" text with beta's reply) would be alpha woken. 60 s covers a housekeeping tick.
 const heard=async()=>(await requests()).filter(one=>one.users.some(text=>text.includes('Background process')&&text.includes(`beta says 42 leads ${m6}`))).length;
 await sleep(60000);
 const woken=await heard()>0;
 const answered=(await messages(ALPHA,chat.id)).slice(before6).filter(one=>one.role==='assistant').length;
 // The named change: the caller starts a Run in alpha's Bot Chat once the reply is there, and alpha's model gets it.
 const m6w=mark();
 const wake=await turn(ALPHA,`Beta has answered ${m6w}.\nREPLY relayed ${m6w}`,{session_id:chat.id});
 const sentWake=await sentFor(m6w);
 const wakeSees=sentWake.users.at(-1).includes(`beta says 42 leads ${m6}`);
 const betaChat=await botChat(BETA);
 const betaRead=await messages(BETA,betaChat.id);
 const betaTurn=betaRead.find(one=>one.role==='user'&&String(one.content).includes(m6));
 const command=/Command: (.*)/.exec(String(back.note.content))?.[1]??'';
 say(`question 6: alpha's turn ended ${asked.done.status}; message_agent answered ${String(ack?.content).slice(0,240)}`);
 say(`question 6: beta had no Bot Chat before (${betaBefore===null}); beta's Bot Chat ${betaChat.id} now holds ${JSON.stringify(firstLine(betaTurn?.content))} and its reply ${JSON.stringify(betaRead.at(-1)?.content)}`);
 say(`question 6: the reply came back into alpha's Bot Chat ${seconds(back.ms)} after the turn started, as a ${back.note.display_kind} message; the delivery ran on the Engine as: ${command.replace(/\/tmp\/hermes-dm-\S+/,'<dm file>')}`);
 say(`question 6: 60 s later alpha had been woken to act on it: ${woken} (alpha's answers since the hand-off: ${answered}, its own "asked beta" only); a Run started then in alpha's Bot Chat ended ${wake.done.status}, and its model got the reply folded into that turn's message: ${wakeSees}`);
 // The same hand-off with nothing on the Engine but the Run API: gtmworks starts a Run in beta's Bot Chat, attributed to
 // alpha, and reads the reply back itself.
 const m6r=mark();
 const relayed=await turn(BETA,`Message from alpha ${m6r}.\nREPLY beta answers by the Run API ${m6r}`,{session_id:betaChat.id,author:{id:`bot:${ALPHA}`,name:ALPHA,is_bot:true}});
 say(`question 6: a Run started by the caller in beta's Bot Chat, author bot:${ALPHA}: ${relayed.done.status} "${relayed.done.output}"`);
 record(6,inSandbox&&asked.done.status==='completed'&&/"status": "queued"/.test(String(ack?.content))&&betaBefore===null&&betaTurn&&String(betaTurn.content).startsWith('Message from 🤖 Alpha Writer (@alpha): ')
  &&command.includes('bot_mode_dm.py --run-delivery')&&relayed.done.status==='completed',
  'delivered and answered under the managed backend: the delivery is a Hermes process on the Engine itself, not the Agent\'s terminal, so the sandbox needs no Hermes; a Run in the other Bot Chat is a second way that needs only the Run API');
 answers['6-woken']=woken;
 answers['6-wake-run']=wake.done.status==='completed'&&wakeSees;

 // --- verdicts ----------------------------------------------------------------------------------------------------
 say('');
 say('VERDICT shared permanent chat with names: usable with a named change — the Engine makes, keeps and queues one Bot Chat per Agent with no Desktop, but keeps no person\'s name (gtmworks keeps delivery_id → Member per message), streams nothing live for a Bot Chat turn (only run.completed: the screen reads the turn from the session) and cannot stop one (Stop cancels the Run, the turn finishes)');
 say('VERDICT a Routine\'s result in the chat: usable as shipped — deliver "bot-chat" instead of "local": the result arrives by itself within a minute of the run, [SILENT] leaves nothing, a failure notice arrives as a diagnostic turn; each result costs one more model turn, the Agent\'s answer to it');
 say('VERDICT Agent-to-Agent messages: usable with a named change — message_agent is delivered and answered under the install\'s managed ssh backend (its delivery runs on the Engine, never in the Work sandbox), and the reply is written into the sender\'s Bot Chat at once, but with no Desktop nothing wakes the sender: gtmworks starts a Run in the sender\'s Bot Chat when the reply lands');
 // The recorded result. An answer that differs means the Engine changed or the record is stale.
 const expected={1:true,2:true,3:true,4:true,5:true,6:true,'2-stream':true,'2-install-wide':true,'2-stop-reaches-turn':false,'6-woken':false,'6-wake-run':true};
 const changed=Object.entries(expected).filter(([key,value])=>answers[key]!==value);
 if(changed.length) fail('the Engine answered differently than the recorded result',changed.map(([key])=>`question ${key}`).join(', '));
});
