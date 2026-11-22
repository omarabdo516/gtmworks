'use client';
import { lazy, Suspense, type ComponentProps } from 'react';
import type { CompanySubscriptions as Subscriptions } from './company-engine-client';
import type Knowledge from './company-knowledge-client';
import type { CompanyLearningMode as CompanyMode, AgentLearningMode as AgentMode, RuleActions as RuleAction } from './settings-learning-client';
import type { ProviderKeys as Keys, SpeechToText as Speech, DefaultModel as Default, EachAgent as Each, AgentModel as Model } from './settings-models';

// Parts of the settings overlay that only one of its sections shows, loaded on demand so they stay out of the page chunk
// every company route loads (page weight, #55): the company sign-in (Company section), the member's
// note (Your account), the Company knowledge's editor and edit time, and an Agent's About, instructions, voice, model and
// save bar (#161, #162, #176, #179, #29), which later settings fields join. The server still draws them, and React
// replays a click made before their code arrives; the note form stays read-only until it is hydrated (member-note.tsx).
const LazySubscriptions=lazy(()=>import('./company-engine-client').then(module=>({default:module.CompanySubscriptions})));
const LazyNote=lazy(()=>import('./member-note'));
const LazyKnowledge=lazy(()=>import('./company-knowledge-client'));
const LazyEditedAt=lazy(()=>import('./company-knowledge-client').then(module=>({default:module.KnowledgeEditedAt})));
const LazyAbout=lazy(()=>import('./settings-agent-form').then(module=>({default:module.AgentAbout})));
const LazySkills=lazy(()=>import('./settings-agent-form').then(module=>({default:module.AgentSkills})));
const LazyInstructions=lazy(()=>import('./settings-agent-form').then(module=>({default:module.AgentInstructions})));
const LazyInstructionsRead=lazy(()=>import('./settings-agent-form').then(module=>({default:module.AgentInstructionsReadOnly})));
const LazySaveBar=lazy(()=>import('./settings-agent-form').then(module=>({default:module.AgentSaveBar})));
const LazyVoice=lazy(()=>import('./settings-agent-voice').then(module=>({default:module.AgentVoice})));
const LazyVoiceSpeed=lazy(()=>import('./settings-agent-voice').then(module=>({default:module.AgentVoiceSpeed})));
const LazyEffort=lazy(()=>import('./settings-agent-effort').then(module=>({default:module.AgentEffort})));
const LazyMorning=lazy(()=>import('./settings-agent-morning').then(module=>({default:module.AgentMorning})));
const LazyKeys=lazy(()=>import('./settings-models').then(module=>({default:module.ProviderKeys})));
const LazySpeech=lazy(()=>import('./settings-models').then(module=>({default:module.SpeechToText})));
const LazyDefault=lazy(()=>import('./settings-models').then(module=>({default:module.DefaultModel})));
const LazyEach=lazy(()=>import('./settings-models').then(module=>({default:module.EachAgent})));
const LazyModel=lazy(()=>import('./settings-models').then(module=>({default:module.AgentModel})));
const LazyDefaultEffort=lazy(()=>import('./settings-models').then(module=>({default:module.DefaultEffort})));
const LazyCompanyMode=lazy(()=>import('./settings-learning-client').then(module=>({default:module.CompanyLearningMode})));
const LazyAgentMode=lazy(()=>import('./settings-learning-client').then(module=>({default:module.AgentLearningMode})));
const LazyRuleActions=lazy(()=>import('./settings-learning-client').then(module=>({default:module.RuleActions})));
export function CompanySubscriptions(props:ComponentProps<typeof Subscriptions>) { return <Suspense fallback={null}><LazySubscriptions {...props}/></Suspense>; }
export function MemberNote(props:{company:string,note:string}) { return <Suspense fallback={null}><LazyNote {...props}/></Suspense>; }
export function KnowledgeEditor(props:ComponentProps<typeof Knowledge>) { return <Suspense fallback={null}><LazyKnowledge {...props}/></Suspense>; }
export function KnowledgeEditedAt(props:{at:string}) { return <Suspense fallback={null}><LazyEditedAt {...props}/></Suspense>; }
/** @param {{agent:string,name:string,description:string}} props */
export function AgentAbout(props:{agent:string,name:string,description:string}) { return <Suspense fallback={null}><LazyAbout {...props}/></Suspense>; }
/** @param {{agent:string,name:string,slug:string,learning:boolean,skills:import('./settings-agent-form').AgentSkillRow[]|null,editable:boolean}} props */
export function AgentSkills(props:{agent:string,name:string,slug:string,learning:boolean,skills:import('./settings-agent-form').AgentSkillRow[]|null,editable:boolean}) { return <Suspense fallback={null}><LazySkills {...props}/></Suspense>; }
/** @param {{agent:string,name:string,instructions:string,sectionChars:number,limit:number}} props */
export function AgentInstructions(props:{agent:string,name:string,instructions:string,sectionChars:number,limit:number}) { return <Suspense fallback={null}><LazyInstructions {...props}/></Suspense>; }
/** @param {{instructions:string,empty:string}} props */
export function AgentInstructionsReadOnly(props:{instructions:string,empty:string}) { return <Suspense fallback={null}><LazyInstructionsRead {...props}/></Suspense>; }
/** @param {{company:string,agent:string,name:string}} props */
export function AgentSaveBar(props:{company:string,agent:string,name:string}) { return <Suspense fallback={null}><LazySaveBar {...props}/></Suspense>; }
/** @param {{company:string,agent:string,personName:string,voice:import('@/lib/agent-voice.mjs').AgentVoice}} props */
export function AgentVoice(props:{company:string,agent:string,personName:string,voice:import('@/lib/agent-voice.mjs').AgentVoice}) { return <Suspense fallback={null}><LazyVoice {...props}/></Suspense>; }
/** @param {{agent:string,speed:number|null,editable:boolean}} props */
export function AgentVoiceSpeed(props:{agent:string,speed:number|null,editable:boolean}) { return <Suspense fallback={null}><LazyVoiceSpeed {...props}/></Suspense>; }
/** @param {{agent:string,effort:string|null,editable:boolean}} props */
export function AgentEffort(props:{agent:string,effort:string|null,editable:boolean}) { return <Suspense fallback={null}><LazyEffort {...props}/></Suspense>; }
/** @param {{agent:string,editable:boolean,morning:import('./settings-agent-morning').MorningProps|null}} props */
export function AgentMorning(props:{agent:string,editable:boolean,morning:import('./settings-agent-morning').MorningProps|null}) { return <Suspense fallback={null}><LazyMorning {...props}/></Suspense>; }
export function ProviderKeys(props:ComponentProps<typeof Keys>) { return <Suspense fallback={null}><LazyKeys {...props}/></Suspense>; }
export function SpeechToText(props:ComponentProps<typeof Speech>) { return <Suspense fallback={null}><LazySpeech {...props}/></Suspense>; }
export function DefaultModel(props:ComponentProps<typeof Default>) { return <Suspense fallback={null}><LazyDefault {...props}/></Suspense>; }
export function EachAgent(props:ComponentProps<typeof Each>) { return <Suspense fallback={null}><LazyEach {...props}/></Suspense>; }
export function AgentModel(props:ComponentProps<typeof Model>) { return <Suspense fallback={null}><LazyModel {...props}/></Suspense>; }
export function DefaultEffort() { return <Suspense fallback={null}><LazyDefaultEffort/></Suspense>; }
// The Learning section's controls (#28): the mode cards and the per-Agent mode, and a rule's Forget this and Bring it back.
export function CompanyLearningMode(props:ComponentProps<typeof CompanyMode>) { return <Suspense fallback={null}><LazyCompanyMode {...props}/></Suspense>; }
export function AgentLearningMode(props:ComponentProps<typeof AgentMode>) { return <Suspense fallback={null}><LazyAgentMode {...props}/></Suspense>; }
export function RuleActions(props:ComponentProps<typeof RuleAction>) { return <Suspense fallback={null}><LazyRuleActions {...props}/></Suspense>; }
