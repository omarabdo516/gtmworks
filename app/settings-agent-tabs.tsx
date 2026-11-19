'use client';
import type { KeyboardEvent as KeyEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/lib/link';
import { useI18n } from '@/lib/i18n-client';
import { overlayHref, type AgentTab } from '@/lib/settings-overlay.mjs';

// The two tabs of an Agent's Settings page (#193; design-reference: sovAgentHTML's tabs). Each is a link to its own
// address, so the tab survives a reload and a test or a link can open it; the arrow keys choose the other tab in the
// reader's direction, as the details panel's tabs do (app/agent-details.tsx), and leave the focus on it.
const tabs = [{ key: 'settings', label: 'settings' }, { key: 'memory', label: 'settingsTabMemory' }] as const;

export function AgentTabs({ slug, agent, tab, label }: { slug: string, agent: string, tab: AgentTab, label: string }) {
 const { t, language } = useI18n(); const router = useRouter();
 const address = (key: AgentTab) => overlayHref(slug, 'agents', { agent, ...(key === 'memory' ? { tab: 'memory' } : {}) });
 const move = (event: KeyEvent<HTMLAnchorElement>) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const step = (event.key === 'ArrowLeft') === (language === 'ar') ? 1 : -1;
  const next = tabs[(tabs.findIndex(item => item.key === tab) + step + tabs.length) % tabs.length].key;
  router.replace(address(next));
  document.getElementById(`sov-tab-${next}`)?.focus();
 };
 return <div className="segmented sov-tabs" role="tablist" aria-label={label}>{tabs.map(item =>
  <Link key={item.key} replace role="tab" id={`sov-tab-${item.key}`} href={address(item.key)} aria-selected={tab === item.key} aria-controls="sov-agent-panel" tabIndex={tab === item.key ? 0 : -1} onKeyDown={move}>{t(item.label)}</Link>)}</div>;
}
