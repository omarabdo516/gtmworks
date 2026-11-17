import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps, MouseEvent } from 'react';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { CallableAgentsProvider, ComposerPlaceProvider, MessageBox, type ComposerPlace } from '@/app/conversation-composer';
import { ToastHost } from '@/app/toast';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';
import '@/app/tokens.css';
import '@/app/shell.css';

// #158, the "+" menu's New channel, Connect apps and Model lines (design-reference: plusMenuHTML, pick-model).
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/conversations/c1', useSearchParams: () => null }));
vi.mock('@/lib/link', () => ({
 default: ({ onClick, ...props }: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))} onClick={(event: MouseEvent<HTMLAnchorElement>) => { onClick?.(event); event.preventDefault(); }}/>,
 pageBeingOpened: () => null,
}));
afterEach(() => { vi.unstubAllGlobals(); });

const company = '10000000-0000-0000-0000-000000000001';
const conversation = 'c1000000-0000-0000-0000-000000000001';
const role = (owner: boolean, manage: boolean, alone = false): ComposerPlace => ({ slug: 'rs-learning', company, person: 'p1', owner, manage, alone });
// The Engine's apps (one connected) and models, and every pick the page sends.
function engine(company: string) {
 const picks: unknown[] = [];
 vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
  if (input.startsWith(`/api/company-apps?company=${company}`)) return Response.json({ apps: [{ key: 'klaviyo', state: 'connected' }, { key: 'notion', state: 'off' }] });
  if (input.includes('intent=models')) return Response.json({ state: 'found', current: { provider: 'anthropic', model: 'claude-opus-4-6' },
   models: [{ provider: 'anthropic', providerName: 'Anthropic', model: 'claude-opus-4-6' }, { provider: 'openrouter', providerName: 'OpenRouter', model: 'openai/gpt-5.5' }] });
  if (init?.method === 'POST') { picks.push(JSON.parse(String(init.body))); return Response.json({ model: null }); }
  return new Response(null, { status: 404 });
 }));
 return picks;
}
// Each test reads its own Company, as the apps are kept per Company once read.
const composer = (place: ComposerPlace, language: Language = 'en') => render(<div className="gw" style={{ paddingTop: 520 }}><div className="composer-area">
 <LanguageProvider language={language}><CallableAgentsProvider agents={[{ id: 'a1', connection_id: 'c1', name: 'Lead' }]}><ComposerPlaceProvider place={place}>
  <MessageBox placeholder="Write" send={async () => null} model={{ company: place.company, conversation, agent: 'Lead' }}/><ToastHost/>
 </ComposerPlaceProvider></CallableAgentsProvider></LanguageProvider>
</div></div>);

test('the Owner of a team Company gets New channel, Connect apps with its count and the Engine\'s models, the one in use checked', async () => {
 const place = { ...role(true, true), company: '10000000-0000-0000-0000-0000000000a1' }; engine(place.company);
 const screen = await composer(place);
 await screen.getByRole('button', { name: 'More: call someone, new channel, commands, model' }).click();
 await expect.element(screen.getByRole('menuitem', { name: 'New channel For the team and agents in one conversation' })).toBeVisible();
 await expect.element(screen.getByRole('menuitem', { name: 'Connect apps Connect a new tool to an agent · 1 connected' })).toHaveAttribute('href', '/c/rs-learning/settings?section=apps');
 await expect.element(screen.getByText('Model', { exact: true })).toBeVisible();
 await expect.element(screen.getByRole('menuitemradio', { name: 'claude-opus-4-6 Anthropic' })).toHaveAttribute('aria-checked', 'true');
 await expect.element(screen.getByRole('menuitemradio', { name: 'openai/gpt-5.5 OpenRouter' })).toHaveAttribute('aria-checked', 'false');
});

test('picking a model closes the menu, gives the field the focus, sends the choice for this Conversation and shows the toast', async () => {
 const place = { ...role(true, true), company: '10000000-0000-0000-0000-0000000000a2' }; const picks = engine(place.company);
 const screen = await composer(place);
 await screen.getByRole('button', { name: /^More:/ }).click();
 await screen.getByRole('menuitemradio', { name: 'openai/gpt-5.5 OpenRouter' }).click();
 await expect.element(screen.getByRole('menu')).not.toBeInTheDocument();
 await expect.element(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
 await expect.element(screen.getByText('Lead will think with openai/gpt-5.5')).toBeVisible();
 expect(picks).toEqual([{ company: place.company, conversation, intent: 'model', choice: { provider: 'openrouter', model: 'openai/gpt-5.5' } }]);
});

const roles = [
 { who: 'a Manager has New channel and the line for connecting a tool, and no Model', place: role(false, true), id: 'b1', label: 'More: call someone, new channel, commands', sub: 'Connect a new tool to an agent · 1 connected' },
 { who: 'a Contributor has no New channel, only the count, and no Model', place: role(false, false), id: 'b2', label: 'More: call someone, commands', sub: '1 connected' },
 { who: 'the Owner of a Company worked alone has no New channel', place: role(true, true, true), id: 'b3', label: 'More: call someone, commands, model', sub: 'Connect a new tool to an agent · 1 connected' },
];
test.each(roles)('$who', async ({ place, id, label, sub }) => {
 const company = `10000000-0000-0000-0000-0000000000${id}`; engine(company);
 const screen = await composer({ ...place, company });
 await screen.getByRole('button', { name: label }).click();
 await expect.element(screen.getByRole('menuitem', { name: `Connect apps ${sub}` })).toBeVisible();
 if (place.owner) await expect.element(screen.getByRole('menuitemradio').first()).toBeVisible();
 expect(screen.getByRole('menuitem', { name: /^New channel/ }).elements()).toHaveLength(place.manage && !place.alone ? 1 : 0);
 expect(screen.getByRole('menuitemradio').elements().length > 0).toBe(place.owner);
});

test('in Arabic the lines speak the reference\'s words', async () => {
 const place = { ...role(true, true), company: '10000000-0000-0000-0000-0000000000a4' }; engine(place.company);
 const screen = await composer(place, 'ar');
 await screen.getByRole('button', { name: 'إضافات: نادي حد، قناة جديدة، الأوامر، الموديل' }).click();
 await expect.element(screen.getByRole('menuitem', { name: 'قناة جديدة للفريق والوكلاء في محادثة واحدة' })).toBeVisible();
 await expect.element(screen.getByRole('menuitem', { name: 'ربط التطبيقات وصّل أداة جديدة لوكيل · 1 متوصل' })).toBeVisible();
 await expect.element(screen.getByText('الموديل', { exact: true })).toBeVisible();
});
