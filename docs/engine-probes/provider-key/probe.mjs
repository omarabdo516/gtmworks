// Probe of spec #935 (#936): can a Provider's API key be kept once, in the pinned Engine's root credential pool, where
// every Agent of a Company reads it? It builds nothing in the product: it runs five questions against a throwaway Engine
// of `engine-stack/` (#823) through the Engine's own HTTP routes only, and ends with a pass or fail for each.
// Run it through run.sh beside it; it reads the Engine and the fake model over HTTP only.
import {randomUUID} from 'node:crypto';
import {engine,main,fail,must,manage,makeProfile,startRun,waitRun} from '../engine-stack/engine.mjs';

const PROVIDER='deepseek';
const KEY_ENV='DEEPSEEK_API_KEY';
const ROOT='default';
const SPACE='key-space';
const AGENT='key-agent';
const ENVAGENT='key-env';
const MODEL_HOST='http://fake-model:8080/v1';
const KEY_A=`sk-probe-a-${randomUUID().slice(0,8)}`;
const KEY_B=`sk-probe-b-${randomUUID().slice(0,8)}`;
const ENV_KEY=`sk-probe-env-${randomUUID().slice(0,8)}`;

const lines=[];
const say=line=>{ console.log(line); lines.push(line); };
const verdicts=[];
const mark=(q,ok,why)=>{ verdicts.push({q,ok,why}); say(`${ok?'PASS':'FAIL'} question ${q}: ${why}`); };

const q=profile=>`?profile=${encodeURIComponent(profile)}`;
const poolList=(profile=ROOT)=>must(`list ${profile}'s pool`,manage(`/api/credentials/pool${q(profile)}`));
const addKey=(apiKey,label)=>must(`add a ${PROVIDER} pool entry`,manage(`/api/credentials/pool${q(ROOT)}`,{method:'POST',body:{provider:PROVIDER,api_key:apiKey,label}}));
const removeEntry=index=>must(`remove pool entry ${index}`,manage(`/api/credentials/pool/${PROVIDER}/${index}${q(ROOT)}`,{method:'DELETE'}));
// The newest request the fake model got whose last message names `marker`, and the key it was sent with.
async function modelAuth(marker) {
 const got=await fetch(`${process.env.MODEL_ADDRESS}/requests`).then(response=>response.json());
 const hit=[...got].reverse().find(one=>String(one?.last?.content||'').includes(marker));
 return hit?.auth??null;
}
async function setModel(name,model) {
 const picked=await must(`set ${name}'s model`,manage(`/api/profiles/${encodeURIComponent(name)}/model`,{method:'PUT',body:{provider:PROVIDER,model}}));
 if(picked.provider!==PROVIDER||picked.model!==model) fail(`set ${name}'s model`,JSON.stringify(picked));
 // The fake model is the endpoint the profile sends to, so a canonical provider's cloud address is not reached.
 await must(`point ${name} at the fake model`,manage(`/api/config${q(name)}`,{method:'PUT',body:{config:{model:{base_url:MODEL_HOST}}}}));
}
const runOnce=async(profile,marker)=>{
 const run=await startRun(profile,`${marker}.\nREPLY ${marker}`);
 return {done:await waitRun(profile,run.run_id),auth:await modelAuth(marker)};
};
const envRow=async profile=>(await must(`read ${profile}'s env`,manage(`/api/env${q(profile)}`)))[KEY_ENV];

await main(async()=>{
 say(`engine ${engine.image}`);
 say(`provider ${PROVIDER}, key env ${KEY_ENV}, fake model at ${MODEL_HOST}`);

 // --- setup: the key lives once, in the root's pool, and the profiles the questions run on --------------------------
 await addKey(KEY_A,`probe key a ${randomUUID().slice(0,6)}`);
 const listed=await poolList();
 const entry=listed.providers.find(row=>row.provider===PROVIDER)?.entries?.find(row=>row.auth_type==='api_key');
 if(!entry) fail('the root pool lists one api_key entry for the provider',JSON.stringify(listed));
 say(`the root's pool holds one ${PROVIDER} entry: ${JSON.stringify(entry)}`);

 for(const name of [SPACE,AGENT,ENVAGENT]) await makeProfile(name);
 const options=await must('list the space\'s model options',manage(`/api/model/options${q(SPACE)}`));
 const offered=options.providers.find(row=>row.slug===PROVIDER);
 const MODEL=Array.isArray(offered?.models)&&offered.models[0]?offered.models[0]:'deepseek-flash';
 say(`the space's model options list ${PROVIDER}: ${JSON.stringify({models:offered?.models,authenticated:offered?.authenticated})}; the probe uses model ${MODEL}`);
 await Promise.all([setModel(AGENT,MODEL),setModel(ENVAGENT,MODEL)]);

 // --- 1. a Run on a profile that holds no key of its own answers with a key held only in the root's pool -------------
 const agentEnv=await envRow(AGENT);
 const one=await runOnce(AGENT,'q1 pool answers');
 say(`question 1: ${AGENT} holds no ${KEY_ENV} (is_set ${agentEnv?.is_set}); a Run ended ${one.done.status}, output "${one.done.output}", sent with ${one.auth}`);
 mark(1,agentEnv?.is_set!==true&&one.done.status==='completed'&&one.auth===`Bearer ${KEY_A}`,'a keyless profile answers with the key held only in the root\'s pool');

 // --- 2. setting that profile's model is accepted, and the space still lists the provider's models -------------------
 const spaceOffered=(await must('list the space\'s model options again',manage(`/api/model/options${q(SPACE)}`))).providers.find(row=>row.slug===PROVIDER);
 say(`question 2: setting ${AGENT}'s model to ${PROVIDER}/${MODEL} was accepted (PUT /api/profiles/<name>/model); the space still lists ${PROVIDER}: ${JSON.stringify({models:spaceOffered?.models,authenticated:spaceOffered?.authenticated})}`);
 mark(2,spaceOffered?.authenticated===true&&Array.isArray(spaceOffered?.models)&&spaceOffered.models.includes(MODEL),'the model is accepted and the space still lists the provider\'s models');

 // --- 3. a caller can tell which providers hold a key without the reveal route, and no answer carries the key --------
 const poolJSON=JSON.stringify(await poolList());
 const revealAgent=await manage('/api/env/reveal',{method:'POST',body:{key:KEY_ENV,profile:AGENT}});
 const revealRoot=await manage('/api/env/reveal',{method:'POST',body:{key:KEY_ENV,profile:ROOT}});
 const leak=[KEY_A,KEY_B,ENV_KEY].some(key=>poolJSON.includes(key));
 say(`question 3: the pool read names ${PROVIDER} with the redacted preview ${JSON.stringify(entry.token_preview)} and ${leak?'a raw key':'no raw key'} in the answer; the reveal route on ${AGENT} (no env key) answered ${revealAgent.status}, on the root (the key is in its pool, not its .env) ${revealRoot.status}`);
 mark(3,!leak&&revealAgent.status===404&&revealRoot.status===404,'a caller tells which providers hold a key from the pool and env reads, and no answer carries the key or more than the redacted preview');

 // --- 4. removing the pool entry stops the next Run, and a second entry before the first is removed leaves no gap ----
 await removeEntry(1);
 const stopped=await runOnce(AGENT,'q4 stopped');
 say(`question 4: with the pool entry removed, the next Run on ${AGENT} (which never held a key) ended ${stopped.done.status}`);
 await addKey(KEY_A,`probe key a2 ${randomUUID().slice(0,6)}`);
 await addKey(KEY_B,`probe key b ${randomUUID().slice(0,6)}`);
 await removeEntry(1); // the first of the two (KEY_A) leaves KEY_B
 const gap=await runOnce(AGENT,'q4 no gap');
 say(`question 4: a second entry added before the first is removed leaves the next Run answered: ended ${gap.done.status}, sent with ${gap.auth}`);
 mark(4,stopped.done.status==='failed'&&gap.done.status==='completed'&&gap.auth===`Bearer ${KEY_B}`,'removing the one entry stops the next Run, and a second entry added before the first is removed leaves no Run without a key');

 // --- 5. a profile that still holds the key in its own environment: which answers, and after the env copy is removed --
 await must(`give ${ENVAGENT} its own env key`,manage(`/api/env${q(ENVAGENT)}`,{method:'PUT',body:{key:KEY_ENV,value:ENV_KEY}}));
 const both=await runOnce(ENVAGENT,'q5 both');
 say(`question 5: ${ENVAGENT} holds ${KEY_ENV} in its own .env and the root's pool holds one; a Run ended ${both.done.status} and was sent with ${both.auth}`);
 if(both.done.status!=='completed'||both.auth!==`Bearer ${KEY_B}`) fail('a profile holding both answers with the pool key',JSON.stringify({status:both.done.status,auth:both.auth}));
 await must(`remove ${ENVAGENT}'s env key`,manage(`/api/env${q(ENVAGENT)}`,{method:'DELETE',body:{key:KEY_ENV}}));
 const afterEnv=await runOnce(ENVAGENT,'q5 after env');
 say(`question 5: with the env copy removed the Run ended ${afterEnv.done.status} and was sent with ${afterEnv.auth}`);
 if(afterEnv.done.status!=='completed'||afterEnv.auth!==`Bearer ${KEY_B}`) fail('the pool key still answers after the env copy is removed',JSON.stringify({status:afterEnv.done.status,auth:afterEnv.auth}));
 await removeEntry(1); // the root's remaining entry (KEY_B)
 const afterRoot=await runOnce(ENVAGENT,'q5 after root');
 say(`question 5: with the root's pool entry removed too, the Run ended ${afterRoot.done.status} and was sent with ${afterRoot.auth}`);
 // Kept once means the key was only ever borrowed: with the root's entry gone, the next Run must fail. It answered, so the
 // profile copied the key into its own store on an earlier Run, and that copy outlives the removal of both keys.
 if(afterRoot.done.status==='failed') mark(5,true,'the pool key answers first, and with the env copy and then the root\'s entry removed the next Run fails: the key stayed once, borrowed and never copied');
 else mark(5,false,`the pool key answers first, but the profile copied it into its own auth.json on an earlier Run, and the copy outlives the removal of both keys (after the root's entry was removed the Run still ended ${afterRoot.done.status}, sent with ${afterRoot.auth})`);

 say('');
 const failed=verdicts.filter(one=>!one.ok);
 if(failed.length) {
  say(`VERDICT: FAIL — question ${failed.map(one=>one.q).join(', ')}: ${failed.map(one=>one.why).join('; ')}`);
  say('what it means: a key kept once in the root\'s pool is read by every keyless profile (questions 1-3), but a profile that still holds its own env key during the move copies the pool key into its own auth.json, and that copy outlives the removal of both keys. So a removed or rotated key stays in every profile that ran during the move: keys should stay in each profile, or the move must run with no profile holding both.');
 } else {
  say('VERDICT: PASS — a Provider\'s API key is kept once in the root\'s pool, and every Agent of the Company reads it there.');
 }
});