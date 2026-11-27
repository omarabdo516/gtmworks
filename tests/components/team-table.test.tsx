import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { TeamTable, type SaveSwitch } from '@/app/team-table';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n } from '@/lib/i18n.mjs';
import { roleDescription } from '@/lib/member-roles.mjs';

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

// #902: the Role that can do everything reads Administrator / أدمن in the Team table, the invitation form under it
// and the role's description; the old name, Owner / مالك, is nowhere.
for (const [language, name, seesAll, description] of [
 ['en', 'Administrator', 'Administrators see every agent', 'Sees every agent, approves everything, and is the only Role that approves a change to any agent’s model or tools.'],
 ['ar', 'أدمن', 'الأدمنز بيشوفوا كل الوكلاء', 'بيشوف كل الوكلاء، وبيوافق على كل حاجة، والأدمن بس هو اللي يوافق على تغيير موديل أو أدوات أي وكيل.'],
] as const) test(`in ${language} the Team table and its invitation form name the Role ${name}`, async () => {
 const screen = await render(<LanguageProvider language={language}>
  <TeamTable company="co-1" members={[{ person_id: 'p-0', role: 'owner', people: { name: 'Omar' } }, { person_id: 'p-1', role: 'contributor', people: { name: 'Nour' } }]} invitations={[]} agents={agents}
   allowed={new Set()} invitedAllowed={new Set()} userId="p-0" owner={true} save={save} saveInvitation={save} send={vi.fn(async () => ({}))}/>
 </LanguageProvider>);
 const omar = screen.getByRole('row').filter({ hasText: 'Omar' });
 await expect.element(omar.getByText(name, { exact: true })).toBeVisible();
 await expect.element(omar.getByText(seesAll, { exact: true })).toBeVisible();
 expect(i18n(language).t(roleDescription.owner)).toBe(description);
 expect(document.body.textContent).not.toMatch(/Owner|مالك/);
});
