import { createAgent, giveProviders, provideAgent, readAgent, removeAgent } from './agents.mjs';
import { readApps } from './apps.mjs';
import { readModels } from './models.mjs';
import { readProviderKeys } from './providers.mjs';
import { answerRun, keyConflict, permitRun, readRun, readRunEvents, startRun, startUnknown, stopRun, takeToolCalls, withFileDelivery, withTools } from './runs.mjs';
import { openScreenViewer, readScreen, readScreenPicture, wakeScreen } from './screen.mjs';
import { markSession, pausedWords, readSession } from './sessions.mjs';
import { readDictation, transcribe } from './speech.mjs';

// The Hermes driver of the engine contract (lib/engine.mjs): one conversation is one Hermes session, and Hermes's
// cancelled and interrupted runs are the contract's stopped. Only this driver talks to Hermes.
export function hermesEngine(connection) {
 return {
  // Every Run carries how its Agent hands a file in its reply (#708). A start the previous release sent without it and
  // lost the answer to is retried here under the same key: Hermes holds that key for the earlier body and refuses this
  // one (409), so the retry sends that earlier body once more, which replays the Run it started.
  start:async({conversation,input,idempotencyKey,instructions,tools,history,model,retry})=>{
   const sent={...connection,input,history,model,sessionKey:conversation,idempotencyKey,retry:retry===true};
   const started=await startRun({...sent,instructions:withFileDelivery(withTools(instructions,tools),connection.profile)});
   if(started!==keyConflict) return started;
   if(retry!==true) return null;
   const earlier=await startRun({...sent,instructions:withTools(instructions,tools)});
   return earlier===keyConflict?startUnknown:earlier;
  },
  transcribe:audio=>transcribe(connection,audio),
  dictation:()=>readDictation(connection),
  models:()=>readModels(connection),
  read:async run=>{
   const {status,output,session,usage,question,permission,noModel,modelRefused,resetsAt,served,chosen}=await readRun({...connection,run});
   const {reply,toolCalls}=output===null?{reply:null,toolCalls:[]}:takeToolCalls(output);
   const said=(question||permission)&&session?await pausedWords(connection,session):null;
   return {state:status==='cancelled'||status==='interrupted'?'stopped':status,reply,session,usage,toolCalls,...(question?{question}:{}),...(permission?{permission}:{}),...(said?{said}:{}),...(noModel?{noModel}:{}),...(modelRefused?{modelRefused}:{}),...(resetsAt?{resetsAt}:{}),...(served?{served}:{}),...(chosen?{chosen}:{})};
  },
  stop:run=>stopRun({...connection,run}),
  answer:(run,question,text)=>answerRun({...connection,run,question,text}),
  permit:(run,permission,choice)=>permitRun({...connection,run,permission,choice}),
  session:session=>readSession(connection,session),
  markSession:(session,archived)=>markSession(connection,session,archived),
  steps:(run,{signal}={})=>readRunEvents({...connection,run,signal}),
  createAgent:agent=>createAgent(connection,agent),
  readAgent:name=>readAgent(connection,name),
  provideAgent:agent=>provideAgent(connection,agent),
  giveProviders:target=>giveProviders(connection,target),
  removeAgent:name=>removeAgent(connection,name),
  readKeys:space=>readProviderKeys(connection,{space,profiles:[]}),
  apps:()=>readApps(connection),
  screen:()=>readScreen(connection),
  wakeScreen:()=>wakeScreen(connection),
  screenPicture:()=>readScreenPicture(connection),
  screenViewer:()=>openScreenViewer(connection),
 };
}
