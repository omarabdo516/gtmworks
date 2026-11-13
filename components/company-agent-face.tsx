import { agentFace } from '@/lib/agent-face.mjs';
import type { CompanyAgent } from '@/lib/sidebar.mjs';

// The reference's pastel fills and their ink (design-reference/app.js, LOOK_COLORS), the same in both themes.
const looks = [['#D7E9E6', '#0B3D39'], ['#E1E5EB', '#1E293B'], ['#E4E7DF', '#2A3520'], ['#E6E3E9', '#33263D'], ['#DCE7F0', '#123047'], ['#E4E4E2', '#262626']] as const;
// The reference's marks (FACES and LOOK_SHAPES), drawn on its 32px circle: brows, an antenna, a headset, spiky hair.
const accessories = [
 <path key="a" d="M9.5 11.2l4.2.7M18.5 11l4-1.8" fill="none" strokeWidth="1.6" strokeLinecap="round"/>,
 <g key="a"><path d="M16 4.5v3" fill="none" strokeWidth="1.6" strokeLinecap="round"/><circle cx="16" cy="4" r="1.4" stroke="none"/></g>,
 <g key="a"><path d="M8.6 12.2a7.4 7.4 0 0 1 14.8 0" fill="none" strokeWidth="1.6" strokeLinecap="round"/><path d="M23.4 12.2v4.6c0 1.7-1.3 2.8-3 2.8" fill="none" strokeWidth="1.4" strokeLinecap="round"/></g>,
 <path key="a" d="M11 9.5V8M14 9.5V6.5M17 9.5V7.5M20 9.5V5.5" fill="none" strokeWidth="1.6" strokeLinecap="round"/>,
];
const mouths = ['M11.5 20c2.5 2.6 6.5 2.6 9 0', 'M13 22h6', 'M12 21.2c1.8 1 6.2 1 8 0', 'M12.6 21.4c1.9 1.4 4.6 1.4 6.4 0'];

// A company's real Agent wears the reference's face (a pastel circle with ink features) in the sidebar's grid, its
// chat and its details. Every feature comes from lib/agent-face.mjs keyed by the Hermes connection, so one Agent never
// looks like two, and two Agents look different exactly when their connections draw different faces.
export function CompanyAgentFace({agent,size}:{agent:Pick<CompanyAgent,'connection_id'|'name'>,size:number}) {
 const face=agentFace(agent.connection_id);
 const gap=[21,22,23].indexOf(face.eyeX), eye=[1.6,1.8,2][[3.6,4.2,4.8].indexOf(face.pupilRadius)];
 const [fill,ink]=looks[(face.shape*7+gap*5+face.mouth*3+face.accessory)%looks.length];
 const spread=[3.6,4,4.4][gap]+(face.shape===2?1.25:0);
 const eyes=[16-spread,16+spread];
 return <svg className="agent-face" role="img" aria-label={agent.name} viewBox="0 0 32 32" style={{width:size,height:size,color:ink}}>
  <g fill={fill}><circle cx="16" cy="16" r="16"/></g>
  <g fill="currentColor" stroke="currentColor">
   {accessories[face.accessory]}
   {eyes.map(x=>face.shape===1?<rect key={x} x={x-eye} y={15-eye} width={eye*2} height={eye*2} rx=".8" stroke="none"/>:face.shape===2?<g key={x}><rect x={x-3.25} y="12.5" width="6.5" height="5" rx="2" fill="none" strokeWidth="1.5"/><circle cx={x} cy="15" r={eye*.6} stroke="none"/></g>:<circle key={x} cx={x} cy="15" r={eye} stroke="none"/>)}
   {face.shape===2&&<path d={`M${eyes[0]+3.25} 14.5H${eyes[1]-3.25}`} fill="none" strokeWidth="1.5"/>}
   <path d={mouths[face.mouth]} fill="none" strokeWidth="1.8" strokeLinecap="round"/>
  </g>
 </svg>;
}
