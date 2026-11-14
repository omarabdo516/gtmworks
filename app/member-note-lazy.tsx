'use client';
import dynamic from 'next/dynamic';

// The note form, its strings and the secret patterns load only when the account section shows it. A dynamic import in
// the server component that renders the overlay would put them in the page chunk every company route loads (the route
// size budget, tests/navigation.spec.ts); from a client component it is its own chunk.
const MemberNote=dynamic(()=>import('./member-note'));
export default function MemberNoteLazy(props:{company:string,note:string}) { return <MemberNote {...props}/>; }
