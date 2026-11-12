export function agentFace(identity) {
 // agents.id is a global people identity (ADR 0006), not a company grant, role assignment or translated name.
 let hash=2166136261;
 for(let index=0;index<identity.length;index++) {
  hash^=identity.charCodeAt(index);
  hash=Math.imul(hash,16777619);
 }
 hash>>>=0;
 const gap=(hash>>>3)%3;
 return {shape:hash%3,eyeX:[21,22,23][gap],eyeRadius:[8,8.8,9.4][gap],pupilRadius:[3.6,4.2,4.8][(hash>>>6)%3],mouth:(hash>>>9)%4,accessory:(hash>>>12)%4};
}
