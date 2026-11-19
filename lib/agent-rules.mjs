import { writeSoulRules } from './hermes.mjs';
import { engineOf } from './bundled-hermes.mjs';

// The team's lasting rules (#18) live in each Agent's profile SOUL.md, in the section gtmworks owns (#345), not in each
// Run. Who may give and remove them, and their log, stay in the database; it lists each Agent profile on the bundled
// Engine with its team's rules in force, oldest first (agent_soul_rules_work), and the worker writes each section from
// that list on every pass, so a rule given, approved or removed, or a profile the Engine made again, is in step within
// a pass. A section already right is only read. Each row names its Company, and asks that Company's Engine (#380).
/** @param {any} db @param {{hermes?:{address:string,profile:string,key:string,managementAddress?:string}|null,engine?:(company:string|null|undefined)=>object|null,write?:typeof writeSoulRules}} options */
export async function keepAgentRules(db,{hermes,engine=engineOf,write=writeSoulRules}) {
 const done={written:0};
 // No bundled Engine at all (a hosted install, or a caller that says so): nothing to write.
 if(hermes===null) return done;
 const {data:work,error}=await db.rpc('agent_soul_rules_work');
 if(error) throw new Error(error.message);
 for(const {company_id:company,profile,rules} of work||[]) {
  const at=hermes??await engine(company);
  if(!at) continue;
  const written=await write(at,{profile,rules});
  if(written.state==='written') done.written++;
  else if(written.state!=='unchanged'&&written.state!=='missing') console.error('Agent rules not written:',profile,written.state);
 }
 return done;
}
