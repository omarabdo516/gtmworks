// Every Company the every-Engine check runs (#386, ADR 0018), decided from what the database says about it: a Company
// whose main Agent exists and whose Engine record answers is one to run. A Company made straight in the database by a
// proof (no main Agent) is left alone. A Company that has a main Agent and no readable Engine is a broken install: it
// fails the check rather than being skipped, or the check would pass on an install where a Company lost its Engine
// (#378, C2).

/**
 * @param {{company:{id:string,name:string},agent:{id?:string,profile?:string}|null|undefined,
 *  engine:{address:string,key:string}|null|undefined,managementPort?:number}} input
 * @returns {{company:string,name:string,agent:string,profile:string,engine:{address:string,key:string},
 *  code:string,management:string}|null} null when the Company has no main Agent yet
 */
export function engineTarget({company,agent,engine,managementPort=9119}) {
 if(!agent?.profile) return null;
 if(!engine?.address||!engine?.key) throw new Error(`${company.name} has a main Agent and no Engine record that answers for it`);
 return {company:company.id,name:company.name,agent:agent.id,profile:agent.profile,engine,
  code:`backup-${company.id.replaceAll('-','')}`,management:engine.address.replace(/:\d+$/,'')+`:${managementPort}`};
}
