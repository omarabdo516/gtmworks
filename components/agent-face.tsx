import { agentFace } from '@/lib/agent-face.mjs';
import { roleAgents } from '@/lib/role-agents';

export function AgentFace({id,role,name,size=24}:{id:string,role:string,name:string,size?:number}) {
 const face=agentFace(id);
 const eyes=[face.eyeX,64-face.eyeX];
 return <svg className="agent-face" role="img" aria-label={name} viewBox="0 0 64 64" style={{width:size,height:size}}>
  <g fill={roleAgents.find(agent=>agent.key===role)?.color}>
   {face.shape===0?<circle cx="32" cy="36" r="27"/>:face.shape===1?<rect x="5" y="9" width="54" height="54" rx="19"/>:<rect x="3" y="13" width="58" height="50" rx="25"/>}
  </g>
  <g fill="#1f1f1f" stroke="#1f1f1f" strokeWidth="2.4" strokeLinecap="round">
   {face.accessory===1&&<><path d="M32 9V3" fill="none"/><circle cx="32" cy="3" r="2.6" stroke="none"/></>}
   {face.accessory===2&&<g opacity=".7" stroke="none"><rect x="0" y="31" width="4" height="12" rx="2"/><rect x="60" y="31" width="4" height="12" rx="2"/></g>}
   {face.accessory===3&&<path d="M25 10c2-7 12-7 14 0" fill="none"/>}
  </g>
  {eyes.map(center=><g key={center}>
   <circle cx={center} cy="35" r={face.eyeRadius} fill="#fff"/>
   <circle cx={center} cy="35" r={face.pupilRadius} fill="#1f1f1f"/>
   <circle cx={center+1.3} cy="33.4" r="1.2" fill="#fff"/>
  </g>)}
  <g stroke="#1f1f1f" strokeWidth="2.4" strokeLinecap="round" fill="#1f1f1f">
   {face.mouth===2?<ellipse cx="32" cy="52" rx="2.6" ry="2.2"/>:<path d={['M25 52q7 5 14 0','M26 52h12','','M25 51q8 6 15-1'][face.mouth]} fill="none"/>}
  </g>
 </svg>;
}
