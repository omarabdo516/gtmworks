'use client';
import { lazy, Suspense } from 'react';

// The note form, its strings and the secret patterns load only when the account section shows it. A dynamic import in
// the server component that renders the overlay would put them in the page chunk every company route loads (the route
// size budget, tests/navigation.spec.ts); React's own lazy keeps them in their own chunk without adding next/dynamic's
// loader to that shared chunk.
const MemberNote=lazy(()=>import('./member-note'));
export default function MemberNoteLazy(props:{company:string,note:string}) { return <Suspense fallback={null}><MemberNote {...props}/></Suspense>; }
