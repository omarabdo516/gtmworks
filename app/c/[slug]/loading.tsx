'use client';
import { useI18n } from '@/lib/i18n-client';
import { sections } from '@/lib/navigation';
import { PageFrame } from '@/app/frame';
import { ChatPlaceholder } from '@/app/conversation-thread';
import { useShellPlace } from '@/app/shell-place';

// A page's loading frame (#771): a press on a link draws it inside the Shell at once, before the page's data arrives, and
// the page replaces it when it does. The top bar names the page the address opens when its title is known before its
// data (a chat's, a section's), and a chat, a Conversation or a channel shows the Conversation's own placeholder
// (app/conversation-thread ChatPlaceholder); any other page an empty content area, busy, that says it is opening.
// The same frame waits for a Conversation, a channel or an Agent's chat opened from another one (./conversations,
// ./channels and ./chat each hold one), since those pages share their segment.
export default function CompanyPageLoading() {
 const {t}=useI18n();
 const place=useShellPlace();
 const known=place.chat?'chats':place.section==='all-conversations'?'allConversations':place.section==='log'?'activityLog':place.section==='numbers'?'numbers':sections[place.section];
 return <PageFrame title={known?t(known):''} loading>
  {place.chat?<main className="convo-page h-full"><div className="convo"><div className="chat"><ChatPlaceholder/></div></div></main>
   :<main className="content"><span className="sr-only" role="status">{t('openingPage')}</span></main>}
 </PageFrame>;
}
