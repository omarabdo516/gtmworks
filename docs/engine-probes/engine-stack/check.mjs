// The throwaway Engine's own check (#823): one Run answers at once, one is held open by the slow fake model.
import {engine,main,startRun,readRun,sleep,fail} from './engine.mjs';

await main(async()=>{
 const quick=await startRun(null,'one quick Run\nREPLY the fake model answered');
 const slow=await startRun(null,'one slow Run\nDELAY 20\nREPLY the slow answer');
 await sleep(5000);
 const [a,b]=[await readRun(null,quick.run_id),await readRun(null,slow.run_id)];
 console.log(`quick Run at 5 s: ${a.status} "${a.output}"`);
 console.log(`slow Run (20 s) at 5 s: ${b.status}`);
 if(a.status!=='completed'||a.output!=='the fake model answered') fail('the quick Run ends completed with the fake reply',JSON.stringify(a));
 if(b.status!=='running') fail('the slow Run is still running at 5 s',JSON.stringify(b));
 console.log(`engine ${engine.image}: both Runs as asked`);
});
