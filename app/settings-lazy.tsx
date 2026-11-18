'use client';
import { lazy, Suspense, type ComponentProps } from 'react';
import type { AgentLevel as Level, CompanySubscriptions as Subscriptions } from './company-engine-client';
import type Knowledge from './company-knowledge-client';
import type { CompanyLearningMode as CompanyMode, AgentLearningMode as AgentMode, RuleActions as RuleAction } from './settings-learning-client';

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
const LazySaveBar=lazy(()=>import('./settings-agent-form').then(module=>({default:module.AgentSaveBar})));
const LazyCompanyMode=lazy(()=>import('./settings-learning-client').then(module=>({default:module.CompanyLearningMode})));
const LazyAgentMode=lazy(()=>import('./settings-learning-client').then(module=>({default:module.AgentLearningMode})));
const LazyRuleActions=lazy(()=>import('./settings-learning-client').then(module=>({default:module.RuleActions})));
export function AgentLevel(props:ComponentProps<typeof Level>) { return <Suspense fallback={null}><LazyLevel {...props}/></Suspense>; }
export function CompanySubscriptions(props:ComponentProps<typeof Subscriptions>) { return <Suspense fallback={null}><LazySubscriptions {...props}/></Suspense>; }
export function MemberNote(props:{company:string,note:string}) { return <Suspense fallback={null}><LazyNote {...props}/></Suspense>; }
export function KnowledgeEditor(props:ComponentProps<typeof Knowledge>) { return <Suspense fallback={null}><LazyKnowledge {...props}/></Suspense>; }
export function KnowledgeEditedAt(props:{at:string}) { return <Suspense fallback={null}><LazyEditedAt {...props}/></Suspense>; }
/** @param {{agent:string,name:string,description:string}} props */
export function AgentAbout(props:{agent:string,name:string,description:string}) { return <Suspense fallback={null}><LazyAbout {...props}/></Suspense>; }
/** @param {{agent:string,name:string,skills:import('./settings-agent-form').AgentSkillRow[]|null,editable:boolean}} props */
export function AgentSkills(props:{agent:string,name:string,skills:import('./settings-agent-form').AgentSkillRow[]|null,editable:boolean}) { return <Suspense fallback={null}><LazySkills {...props}/></Suspense>; }
/** @param {{company:string,agent:string,name:string}} props */
export function AgentSaveBar(props:{company:string,agent:string,name:string}) { return <Suspense fallback={null}><LazySaveBar {...props}/></Suspense>; }
// The Learning section's controls (#28): the mode cards and the per-Agent mode, and a rule's Forget this and Bring it back.
export function CompanyLearningMode(props:ComponentProps<typeof CompanyMode>) { return <Suspense fallback={null}><LazyCompanyMode {...props}/></Suspense>; }
export function AgentLearningMode(props:ComponentProps<typeof AgentMode>) { return <Suspense fallback={null}><LazyAgentMode {...props}/></Suspense>; }
export function RuleActions(props:ComponentProps<typeof RuleAction>) { return <Suspense fallback={null}><LazyRuleActions {...props}/></Suspense>; }
