'use client';
import { lazy, Suspense, type ComponentProps } from 'react';
import type { AgentLevel as Level, CompanySubscriptions as Subscriptions } from './company-engine-client';
import type Knowledge from './company-knowledge-client';

// Parts of the settings overlay that only one of its sections shows, loaded on demand so they stay out of the page chunk
// every company route loads (page weight, #55): the Agent level and the company sign-in (Company section), the member's
// note (Your account) and the Company knowledge's editor and edit time. The server still draws them, and React replays a
// click made before their code arrives; the note form stays read-only until it is hydrated (member-note.tsx).
const LazyLevel=lazy(()=>import('./company-engine-client').then(module=>({default:module.AgentLevel})));
const LazySubscriptions=lazy(()=>import('./company-engine-client').then(module=>({default:module.CompanySubscriptions})));
const LazyNote=lazy(()=>import('./member-note'));
const LazyKnowledge=lazy(()=>import('./company-knowledge-client'));
const LazyEditedAt=lazy(()=>import('./company-knowledge-client').then(module=>({default:module.KnowledgeEditedAt})));
export function AgentLevel(props:ComponentProps<typeof Level>) { return <Suspense fallback={null}><LazyLevel {...props}/></Suspense>; }
export function CompanySubscriptions(props:ComponentProps<typeof Subscriptions>) { return <Suspense fallback={null}><LazySubscriptions {...props}/></Suspense>; }
export function MemberNote(props:{company:string,note:string}) { return <Suspense fallback={null}><LazyNote {...props}/></Suspense>; }
export function KnowledgeEditor(props:ComponentProps<typeof Knowledge>) { return <Suspense fallback={null}><LazyKnowledge {...props}/></Suspense>; }
export function KnowledgeEditedAt(props:{at:string}) { return <Suspense fallback={null}><LazyEditedAt {...props}/></Suspense>; }
