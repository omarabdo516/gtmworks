// Probe A of spec #822 (#824, #825): how fast the pinned Engine gives back a long Conversation, quiet and busy, and
// three answers about a session. Run it through run.sh beside it; it reads the Engine over HTTP only.
import {randomUUID} from 'node:crypto';
import {engine,main,fail,must,manage,api,runs,makeProfile,startRun,waitRun,readRun,percentile,timed,sleep,
 cores,loadAverage,loadCores,restartEngine} from '../engine-stack/engine.mjs';

const READS=Number(process.env.PROBE_READS||200);
const PAGE=50;
const lines=[];
const say=line=>{ console.log(line); lines.push(line); };
const s=seconds=>`${(seconds*1000).toFixed(0)} ms`;
const step='CALL skills_list {"category":"none"}';

// --- the seed: every message is one a Run stored ------------------------------------------------------------------
// One turn is a person's message, the Agent's tool call, the tool's answer and the Agent's reply.
async function turn(profile,session,index) {
 const run=await startRun(profile,`Message ${index} of this Conversation.\n${step}\nREPLY Reply ${index}.`,{session_id:session});
 const done=await waitRun(profile,run.run_id);
 if(done.status!=='completed') fail(`seed turn ${index} of ${session}`,JSON.stringify(done).slice(0,400));
}
const sessionRow=(profile,session)=>must(`read session ${session}`,manage(`/api/sessions/${encodeURIComponent(session)}?profile=${profile}`));
async function seedSession(profile,session,messages) {
 let index=0;
 for(;;) {
  const row=await sessionRow(profile,session).catch(()=>({message_count:0}));
  if((row.message_count||0)>=messages) return row.message_count;
  await turn(profile,session,index++);
 }
}
// Workers that share a queue, kept under the Engine's own cap of ten Runs at once.
async function pool(items,width,work) {
 const queue=[...items];
 await Promise.all(Array.from({length:width},async()=>{ for(let item;(item=queue.shift())!==undefined;) await work(item); }));
}

// --- what is timed -------------------------------------------------------------------------------------------------
// A page of 50 from the newest back, offset messages in; a page past the start holds what is left (none for the 50
// before the last 50 of a session of 50).
const held={};
async function readPage(profile,session,offset) {
 const got=await manage(`/api/sessions/${encodeURIComponent(session)}/messages?profile=${profile}&order=latest&limit=${PAGE}&offset=${offset}`);
 if(got.status!==200) fail(`read ${PAGE} messages at offset ${offset} of ${session}`,`${got.status} ${got.text.slice(0,400)}`);
 const expected=Math.max(0,Math.min(PAGE,(held[session]??Infinity)-offset));
 if(got.json.messages.length!==expected) fail(`read ${expected} messages at offset ${offset} of ${session}`,`${got.json.messages.length} messages: ${got.text.slice(0,300)}`);
 return got.json.messages;
}
async function timeReads(label,fn) {
 const times=[];
 for(let i=0;i<READS;i++) times.push((await timed(fn)).seconds);
 return {label,p50:percentile(times,50),p95:percentile(times,95)};
}
// From starting a Run to its first event on the Run's stream, and from its final event to the reply in the session.
async function timeRun(profile) {
 const session=`probe-${randomUUID()}`;
 const reply=`Reply ${randomUUID().slice(0,8)}.`;
 const start=performance.now();
 const run=await startRun(profile,`A timed Run.\nREPLY ${reply}`,{session_id:session});
 const response=await fetch(`${engine.run}${runs(profile)}/${run.run_id}/events`,{headers:{Authorization:`Bearer ${engine.key}`},signal:AbortSignal.timeout(60000)});
 if(response.status!==200) fail(`open the events of ${run.run_id}`,`${response.status} ${await response.text()}`);
 let first=null, final=null, buffer='', firstEvent=null;
 const decoder=new TextDecoder();
 for await (const chunk of response.body) {
  buffer+=decoder.decode(chunk,{stream:true});
  let at;
  while((at=buffer.indexOf('\n\n'))>=0) {
   const block=buffer.slice(0,at); buffer=buffer.slice(at+2);
   const data=block.split('\n').find(line=>line.startsWith('data: '));
   if(!data) continue;
   const event=JSON.parse(data.slice(6));
   if(first===null) { first=performance.now(); firstEvent=event.event; }
   if(['run.completed','run.failed','run.cancelled'].includes(event.event)) { final=performance.now(); if(event.event!=='run.completed') fail(`Run ${run.run_id} completes`,data); }
  }
  if(final!==null) break;
 }
 if(final===null) fail(`Run ${run.run_id} sends its final event`,'a stream that closed first');
 for(;;) {
  // The Engine stores a session_meta row too; the reply is the newest assistant message among the last few.
  const page=await must('read the reply in the session',manage(`/api/sessions/${session}/messages?profile=${profile}&order=latest&limit=5`));
  const last=page.messages.findLast(message=>message.role==='assistant');
  if(String(last?.content??'').trim()===reply) break;
  if(performance.now()-final>30000) fail(`the reply of ${run.run_id} is in its session`,JSON.stringify(page).slice(0,400));
  await sleep(5);
 }
 return {firstEvent:(first-start)/1000,readable:(performance.now()-final)/1000,firstEventName:firstEvent};
}
async function timeRuns(profile,count) {
 const a=[],b=[],names=new Set();
 for(let i=0;i<count;i++) { const one=await timeRun(profile); a.push(one.firstEvent); b.push(one.readable); names.add(one.firstEventName); }
 return {first:{p50:percentile(a,50),p95:percentile(a,95)},readable:{p50:percentile(b,50),p95:percentile(b,95)},names:[...names]};
}

// PROBE_QUICK=1 shrinks the seed tenfold to try the probe itself; a record is never made from it.
const scale=process.env.PROBE_QUICK?10:1;
const sessions=[['conv-50',50],['conv-500',500],['conv-2000',2000]].map(([name,count])=>[name,count/scale]);
const lists=[['list-10',10],['list-100',100],['list-1000',1000]].map(([name,count])=>[name,Math.ceil(count/scale)]);

async function measure(mode) {
 const out={};
 const titled={};
 for(const [session] of sessions) {
  out[`${session} last`]=await timeReads(`${session} last ${PAGE}`,()=>readPage('conv',session,0));
  out[`${session} before`]=await timeReads(`${session} ${PAGE} before`,()=>readPage('conv',session,PAGE));
 }
 for(const [profile,count] of lists) {
  out[profile]=await timeReads(`${profile} list`,async()=>{
   const got=await must(`list the sessions of ${profile}`,manage(`/api/sessions?profile=${profile}&order=recent&limit=${PAGE}`));
   if(got.total!==count||got.sessions.length!==Math.min(PAGE,count)||!got.sessions.every(row=>row.last_activity_at)) fail(`the list of ${profile} gives ${count} sessions with their last activity`,JSON.stringify({total:got.total,returned:got.sessions.length,first:got.sessions[0]}).slice(0,600));
   titled[profile]=got.sessions.filter(row=>row.title).length;
  });
 }
 out.runs=await timeRuns('timed',Math.max(20,Math.round(READS)));
 say(`measured ${mode}; rows of the first list page with a title: ${lists.map(([profile])=>`${profile} ${titled[profile]}`).join(', ')}`);
 return out;
}

await main(async()=>{
 say(`engine ${engine.image}`);
 say(`date ${new Date().toISOString().slice(0,10)}, host ${cores()} cores`);
 // --- seed ----------------------------------------------------------------------------------------------------------
 const have=(await must('list profiles',manage('/api/profiles')));
 const haveNames=new Set((Array.isArray(have)?have:have.profiles).map(one=>one.name));
 for(const profile of ['conv','timed','busy','answers',...lists.map(([name])=>name)]) if(!haveNames.has(profile)) await makeProfile(profile);
 const seeded=performance.now();
 const counts={};
 await Promise.all([
  pool(sessions,3,async([session,messages])=>{ counts[session]=await seedSession('conv',session,messages); }),
  // A session already there is not made again, so a run on a kept stack (KEEP=1) starts where it stopped.
  pool(lists.flatMap(([profile,count])=>Array.from({length:count},(_,i)=>[profile,i])),5,async([profile,i])=>{
   if((await manage(`/api/sessions/${profile}-${i}?profile=${profile}`)).status===200) return;
   await turn(profile,`${profile}-${i}`,0);
  }),
 ]);
 // What the messages route counts for each session, read in pages of 500 (its own cap).
 for(const [session] of sessions) {
  let total=0;
  for(let offset=0;;offset+=500) {
   const page=await must(`count ${session}`,manage(`/api/sessions/${session}/messages?profile=conv&order=oldest&limit=500&offset=${offset}`));
   total+=page.messages.length;
   if(page.messages.length<500) break;
  }
  held[session]=total;
 }
 say(`seeded by Runs against the fake model in ${((performance.now()-seeded)/1000).toFixed(0)} s: ${sessions.map(([session])=>`${session} holds ${held[session]} messages (${counts[session]} on its session row)`).join(', ')}; ${lists.map(([p,c])=>`${p} holds ${c} sessions`).join(', ')}`);
 // One stored message of each kind, as the Engine gives it back.
 const sample=(await must('read the oldest page of conv-2000',manage(`/api/sessions/conv-2000/messages?profile=conv&order=oldest&limit=8`))).messages;
 for(const role of ['user','assistant','tool']) {
  for(const message of sample.filter(one=>one.role===role).slice(0,role==='assistant'?2:1)) {
   const kept=Object.fromEntries(Object.entries(message).filter(([,v])=>v!==null&&v!==0&&v!=='').map(([k,v])=>[k,typeof v==='string'&&v.length>80?`${v.slice(0,80)}…`:v]));
   say(`stored ${role}: ${JSON.stringify(kept)}`);
  }
 }
 // The two pages join: the 50 before end where the last 50 begin, with no gap and no overlap.
 const [last,before]=[await readPage('conv','conv-2000',0),await readPage('conv','conv-2000',PAGE)];
 if(!(before.at(-1).id<last[0].id)) fail('the 50 before come before the last 50',`${before.at(-1).id} then ${last[0].id}`);
 say(`pages of conv-2000: the last ${PAGE} are rows ${last[0].id}-${last.at(-1).id}, the ${PAGE} before are ${before[0].id}-${before.at(-1).id}`);

 // --- quiet, then busy ----------------------------------------------------------------------------------------------
 const quiet=await measure('quiet');
 const heldRuns=[];
 for(let i=0;i<8;i++) heldRuns.push((await startRun('busy',`Held open.\nDELAY 3600\nREPLY held ${i}`,{session_id:`busy-${i}`})).run_id);
 const stopLoad=await loadCores();
 const loadBefore=loadAverage();
 let busy;
 try {
  busy=await measure('busy');
 } finally {
  const loadAfter=loadAverage();
  const open=[];
  for(const run of heldRuns) open.push((await readRun('busy',run)).status);
  stopLoad();
  say(`busy: ${open.filter(status=>status==='running').length} of 8 held Runs still running at the end (${open.join(', ')}); load average ${loadBefore.toFixed(2)} when the busy reads began, ${loadAfter.toFixed(2)} when they ended, on ${cores()} cores`);
  if(open.some(status=>status!=='running')) fail('the eight held Runs stay open through the busy reads',open.join(', '));
  for(const run of heldRuns) await api(`${runs('busy')}/${run}/stop`,{method:'POST'});
 }

 say('');
 say(`| Read | Quiet p50 | Quiet p95 | Busy p50 | Busy p95 |`);
 say(`| --- | --- | --- | --- | --- |`);
 for(const key of Object.keys(quiet).filter(key=>key!=='runs')) say(`| ${quiet[key].label} | ${s(quiet[key].p50)} | ${s(quiet[key].p95)} | ${s(busy[key].p50)} | ${s(busy[key].p95)} |`);
 say(`| start a Run to its first event (${quiet.runs.names.join(', ')}) | ${s(quiet.runs.first.p50)} | ${s(quiet.runs.first.p95)} | ${s(busy.runs.first.p50)} | ${s(busy.runs.first.p95)} |`);
 say(`| final event to the reply readable in the session | ${s(quiet.runs.readable.p50)} | ${s(quiet.runs.readable.p95)} | ${s(busy.runs.readable.p50)} | ${s(busy.runs.readable.p95)} |`);
 const line=busy['conv-2000 last'].p95;
 const verdict=line<0.5?'PASS':line<=1?'OMAR DECIDES':'FAIL';
 say(`pass line: the last ${PAGE} of conv-2000, busy, p95 ${s(line)}: ${verdict}`);

 // The list has no filter by session id: an ids parameter is not one of its own and is ignored.
 const ids=['list-100-1','list-100-2'];
 const narrowed=await must('list with ids',manage(`/api/sessions?profile=list-100&order=recent&limit=${PAGE}&ids=${ids.join(',')}&id=${ids[0]}`));
 say(`the list narrowed to two ids (ids=, id=): total ${narrowed.total}, ${narrowed.sessions.length} rows returned, so the parameters are ignored; one session read by id: GET /api/sessions/<id> answers its title and last_activity_at`);

 // --- three answers -------------------------------------------------------------------------------------------------
 say('');
 // 1. A session id the caller chose before its first Run.
 const chosen=`gtmworks-${randomUUID()}`;
 const before404=await manage(`/api/sessions/${chosen}?profile=answers`);
 const first=await startRun('answers',`First message of a chosen session.\nREPLY chosen reply`,{session_id:chosen});
 const firstDone=await waitRun('answers',first.run_id);
 const row=await sessionRow('answers',chosen);
 say(`answer 1, a caller chooses the session id: before its first Run GET /api/sessions/<id> answered ${before404.status} ${before404.text.slice(0,80)}; POST /v1/runs with session_id answered ${JSON.stringify(first)}; the Run ended ${firstDone.status} with session_id ${firstDone.session_id}; the session row has id ${row.id}, source ${row.source}, ${row.message_count} messages`);
 if(firstDone.status!=='completed'||firstDone.session_id!==chosen||row.id!==chosen) fail('a chosen session id takes its first Run',JSON.stringify(firstDone));

 // 2. A compacted session: the profile compacts early so a few long turns cross its line.
 if(!haveNames.has('compact')) await makeProfile('compact');
 await must('set compact early',manage('/api/config?profile=compact',{method:'PUT',body:{config:{compression:{threshold_tokens:20000,protect_last_n:4}}}}));
 const long='words '.repeat(2500);
 for(let i=0;i<10;i++) {
  const run=await startRun('compact',`Long message ${i}. ${long}\n${step}\nREPLY Long reply ${i}.`,{session_id:'compacted'});
  await waitRun('compact',run.run_id);
 }
 const plain=await must('read the compacted session',manage('/api/sessions/compacted/messages?profile=compact&order=oldest&limit=500'));
 const whole=await must('read the compacted session with its compacted messages',manage('/api/sessions/compacted/messages?profile=compact&order=oldest&limit=500&include_compacted=true'));
 const compactedRows=whole.messages.filter(message=>message.compacted);
 say(`answer 2, a compacted session: GET …/messages answered ${plain.messages.length} messages, the first ${plain.messages[0].role} "${String(plain.messages[0].content).slice(0,60)}…"; with include_compacted=true ${whole.messages.length} messages, ${compactedRows.length} of them compacted: 1, the first ${whole.messages[0].role} "${String(whole.messages[0].content).slice(0,40)}…"; session id the same (${whole.session_id})`);
 if(!compactedRows.length||!String(whole.messages[0].content).startsWith('Long message 0')) fail('a compacted session gives back its older messages when asked',JSON.stringify(whole.messages.slice(0,2)).slice(0,500));

 // 3. A second message to a working session, and how many may wait.
 const working=await startRun('answers',`A working Run.\nDELAY 15\nREPLY first answer`,{session_id:'queue'});
 await sleep(2000);
 const second=await startRun('answers',`A second message.\nREPLY second answer`,{session_id:'queue'});
 await sleep(500);
 const secondState=await readRun('answers',second.run_id);
 const extra=[];
 for(let i=0;i<40;i++) extra.push(await api(runs('answers'),{method:'POST',body:{input:`Waiting ${i}.\nREPLY waiting ${i}`,session_id:'queue'}}));
 const refused=extra.findIndex(answer=>answer.status!==202);
 const firstEnd=await waitRun('answers',working.run_id), secondEnd=await waitRun('answers',second.run_id);
 const order=(await must('read the queue session',manage('/api/sessions/queue/messages?profile=answers&order=oldest&limit=20'))).messages.filter(m=>m.role==='assistant').map(m=>m.content.trim());
 say(`answer 3, default cap: the second message answered ${JSON.stringify(second)} and read ${secondState.status} while the first ran; the first ended ${firstEnd.status}, the second ${secondEnd.status}; replies stored in order ${JSON.stringify(order.slice(0,2))}; of 40 more messages, number ${refused+3} counting the first two was refused: ${extra[refused]?.status} ${extra[refused]?.text.slice(0,160)}`);
 if(secondState.status!=='queued'||order[0]!=='first answer'||order[1]!=='second answer') fail('a second message waits its turn and runs after the first',JSON.stringify({secondState,order}));
 if(refused+3!==11||extra[refused].status!==429) fail('the 11th Run at once is refused by the Engine\'s cap of 10',`${refused+3} ${extra[refused]?.status}`);
 for(const answer of extra.filter(one=>one.status===202)) await waitRun('answers',answer.json.run_id).catch(()=>{});
 // The same with the Engine's cap of concurrent Runs off (gateway.api_server.max_concurrent_runs: 0), to reach the
 // session's own queue limit.
 await must('switch the concurrent-run cap off',manage('/api/config',{method:'PUT',body:{config:{gateway:{api_server:{max_concurrent_runs:0}}}}}));
 await restartEngine();
 const working2=await startRun('answers',`A working Run.\nDELAY 30\nREPLY first answer`,{session_id:'queue-2'});
 await sleep(2000);
 const waiting=[];
 for(let i=1;i<=40;i++) waiting.push(await api(runs('answers'),{method:'POST',body:{input:`Waiting ${i}.\nREPLY waiting ${i}`,session_id:'queue-2'}}));
 const refused2=waiting.findIndex(answer=>answer.status!==202);
 const states=[];
 for(const answer of waiting.filter(one=>one.status===202)) states.push((await readRun('answers',answer.json.run_id)).status);
 const tally=Object.entries(states.reduce((all,state)=>({...all,[state]:(all[state]||0)+1}),{})).map(([k,v])=>`${v} ${k}`).join(', ');
 say(`answer 3, cap off: of 40 messages to a working session ${waiting.filter(one=>one.status===202).length} were taken (${tally}); the first refused was waiting message ${refused2<0?'none':refused2+1}: ${refused2<0?'-':`${waiting[refused2].status} ${waiting[refused2].text.slice(0,200)}`}`);
 if(refused2!==32||waiting[refused2].status!==409||waiting[refused2].json?.error?.code!=='queue_full') fail('with the cap off, 32 messages wait and the 33rd is refused',`${refused2+1} ${waiting[refused2]?.status} ${waiting[refused2]?.text}`);
 await api(`${runs('answers')}/${working2.run_id}/stop`,{method:'POST'});
 say('probe complete');
});
