'use client';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

// Settings are drawn only while the address is theirs (#612). The `settings` slot keeps what it last drew when the next
// page is one of the Company's own routes it has no page for (a Conversation, a channel, the log), so leaving Settings
// for such a page would otherwise leave the overlay over it; here it goes, and its frame gives the workspace back.
export function OnSettingsAddress({slug,children}:{slug:string,children:ReactNode}) {
 return usePathname()===`/c/${slug}/settings`?children:null;
}
