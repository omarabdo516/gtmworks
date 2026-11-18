'use client';
import { lazy, Suspense, type ComponentProps } from 'react';
import type { AgentLevel as Level, CompanySubscriptions as Subscriptions } from './company-engine-client';
import type Knowledge from './company-knowledge-client';

// Parts of the settings overlay that only one of its sections shows, loaded on demand so they stay out of the page chunk
// every company route loads (page weight, #55): the Agent level and the company sign-in (Company section), the member's
// note (Your account), the Company knowledge's editor and edit time, and an Agent's About and save bar (#161), which
// later settings fields join. The server still draws them, and React replays a click made before their code arrives; the
// note form stays read-only until it is hydrated (member-note.tsx).
const LazyLevel=lazy(()=>import('./company-engine-client').then(module=>({default:module.AgentLevel})));
const LazySubscriptions=lazy(()=>import('./company-engine-client').then(module=>({default:module.CompanySubscriptions})));
const LazyNote=lazy(()=>import('./member-note'));
const LazyKnowledge=lazy(()=>import('./company-knowledge-client'));
const LazyEditedAt=lazy(()=>import('./company-knowledge-client').then(module=>({default:module.KnowledgeEditedAt})));
const LazyAbout=lazy(()=>import('./settings-agent-form').then(module=>({default:module.AgentAbout})));
const LazySkills=lazy(()=>import('./settings-agent-form').then(module=>({default:module.AgentSkills})));
const LazyInstructions=lazy(()=>import('./settings-agent-form').then(module=>({default:module.AgentInstructions})));
const LazyInstructionsRead=lazy(()=>import('./settings-agent-form').then(module=>({default:module.AgentInstructionsReadOnly})));
const LazySaveBar=lazy(()=>import('./settings-agent-form').then(module=>({default:module.AgentSaveBar})));
export function AgentLevel(props:ComponentProps<typeof Level>) { return <Suspense fallback={null}><LazyLevel {...props}/></Suspense>; }
export function CompanySubscriptions(props:ComponentProps<typeof Subscriptions>) { return <Suspense fallback={null}><LazySubscriptions {...props}/></Suspense>; }
export function MemberNote(props:{company:string,note:string}) { return <Suspense fallback={null}><LazyNote {...props}/></Suspense>; }
export function KnowledgeEditor(props:ComponentProps<typeof Knowledge>) { return <Suspense fallback={null}><LazyKnowledge {...props}/></Suspense>; }
export function KnowledgeEditedAt(props:{at:string}) { return <Suspense fallback={null}><LazyEditedAt {...props}/></Suspense>; }
/** @param {{agent:string,name:string,description:string}} props */
export function AgentAbout(props:{agent:string,name:string,description:string}) { return <Suspense fallback={null}><LazyAbout {...props}/></Suspense>; }
/** @param {{agent:string,name:string,skills:import('./settings-agent-form').AgentSkillRow[]|null,editable:boolean}} props */
export function AgentSkills(props:{agent:string,name:string,skills:import('./settings-agent-form').AgentSkillRow[]|null,editable:boolean}) { return <Suspense fallback={null}><LazySkills {...props}/></Suspense>; }
/** @param {{agent:string,name:string,instructions:string,sectionChars:number,limit:number}} props */
export function AgentInstructions(props:{agent:string,name:string,instructions:string,sectionChars:number,limit:number}) { return <Suspense fallback={null}><LazyInstructions {...props}/></Suspense>; }
/** @param {{instructions:string,empty:string}} props */
export function AgentInstructionsReadOnly(props:{instructions:string,empty:string}) { return <Suspense fallback={null}><LazyInstructionsRead {...props}/></Suspense>; }
/** @param {{company:string,agent:string,name:string}} props */
export function AgentSaveBar(props:{company:string,agent:string,name:string}) { return <Suspense fallback={null}><LazySaveBar {...props}/></Suspense>; }
