import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { TeamTable, type SaveSwitch } from '@/app/team-table';
import { LanguageProvider } from '@/lib/i18n-client';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/work/board' }));

// #187: the Team table's switches. The main Agent is shown to all, so one switch stands beside it for the other Agent.
const agents = [{ id: 'a-1', connection_id: 'c-1', name: 'Lead', is_default: true }, { id: 'a-2', connection_id: 'c-2', name: 'Meta Ads', is_default: false }];
const save = vi.fn<SaveSwitch>(async () => '');
const table = (allowed: string[]) => <LanguageProvider language="en">
 <TeamTable company="co-1" members={[{ person_id: 'p-1', role: 'contributor', people: { name: 'Nour' } }]} invitations={[]} agents={agents}
  allowed={new Set(allowed)} invitedAllowed={new Set()} userId="p-1" owner={false} save={save} saveInvitation={save} send={vi.fn(async () => ({}))}/>
</LanguageProvider>;
const switchOf = () => document.querySelector<HTMLButtonElement>('.switch')!;

test('a switch shows the access the table was read with again, not the value it first drew', async () => {
 const screen = await render(table([]));
 expect(switchOf().getAttribute('aria-checked')).toBe('false');
 // The dialog read the table again (after an invite, or a refresh) and this Member now sees the Agent.
 await screen.rerender(table(['p-1:a-2']));
 await expect.poll(() => switchOf().getAttribute('aria-checked')).toBe('true');
 // And back off again.
 await screen.rerender(table([]));
 await expect.poll(() => switchOf().getAttribute('aria-checked')).toBe('false');
});
