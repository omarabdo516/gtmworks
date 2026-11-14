'use client';
import { lazy, Suspense, useSyncExternalStore, type ComponentProps } from 'react';
import type { AgentLevel as Level, CompanySubscriptions as Subscriptions } from './company-engine-client';

// The Agent level and the company sign-in show only in the settings overlay's Company section; loaded on demand they
// stay out of the page chunk every company route loads (the route size budget, tests/navigation.spec.ts). They are drawn
// once the page is hydrated, so no button is shown before it works.
const LazyLevel=lazy(()=>import('./company-engine-client').then(module=>({default:module.AgentLevel})));
const LazySubscriptions=lazy(()=>import('./company-engine-client').then(module=>({default:module.CompanySubscriptions})));
const useHydrated=()=>useSyncExternalStore(()=>()=>{},()=>true,()=>false);
export function AgentLevel(props:ComponentProps<typeof Level>) { return useHydrated()?<Suspense fallback={null}><LazyLevel {...props}/></Suspense>:null; }
export function CompanySubscriptions(props:ComponentProps<typeof Subscriptions>) { return useHydrated()?<Suspense fallback={null}><LazySubscriptions {...props}/></Suspense>:null; }
