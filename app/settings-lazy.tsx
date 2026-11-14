'use client';
import { lazy, Suspense, type ComponentProps } from 'react';
import type { AgentLevel as Level, CompanySubscriptions as Subscriptions } from './company-engine-client';

// Parts of the settings overlay that only one of its sections shows, loaded on demand so they stay out of the page chunk
// every company route loads (page weight, #55): the Agent level and the company sign-in
// (Company section) and the member's note (Your account). The server still draws them, and React replays a click made
// before their code arrives; the note form stays read-only until it is hydrated (member-note.tsx).
const LazyLevel=lazy(()=>import('./company-engine-client').then(module=>({default:module.AgentLevel})));
const LazySubscriptions=lazy(()=>import('./company-engine-client').then(module=>({default:module.CompanySubscriptions})));
const LazyNote=lazy(()=>import('./member-note'));
export function AgentLevel(props:ComponentProps<typeof Level>) { return <Suspense fallback={null}><LazyLevel {...props}/></Suspense>; }
export function CompanySubscriptions(props:ComponentProps<typeof Subscriptions>) { return <Suspense fallback={null}><LazySubscriptions {...props}/></Suspense>; }
export function MemberNote(props:{company:string,note:string}) { return <Suspense fallback={null}><LazyNote {...props}/></Suspense>; }
