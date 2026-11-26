'use client';
import type { ComponentProps } from 'react';
import Link from '@/lib/link';
import { useShellPlace, type Place } from './shell-place';

// Whether a sidebar entry names the page shown (#789): Chats any chat, Conversation or channel; Marketing board every
// view of the work; any other entry its own page.
const entryOpen=(place:Place,entry:string)=>entry==='chat'?place.chat:entry==='work/board'?place.section.startsWith('work/'):place.section===entry;

// One of the sidebar's entries, marked as the current page while its page is the one shown under the Shell.
export function SidebarEntry({entry,...props}:ComponentProps<typeof Link>&{entry:string}) {
 return <Link {...props} aria-current={entryOpen(useShellPlace(),entry)?'page':undefined}/>;
}
