import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { TeamTable, type CancelLink, type SaveSwitch, type TeamLink } from '@/app/team-table';
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

// #951: an Administrator sees each Invite link still waiting for its Person with its label, Role, maker and end; Cancel
// stops it and it leaves the table, and a refusal says why and keeps it.
const link:TeamLink={id:'l-1',label:'Nour Salah',role:'viewer',made_by_name:'Omar',ends_at:'2026-12-04T10:00:00+00:00'};
const tableWithLinks = (cancelLink:CancelLink, links:TeamLink[] = [link]) => <LanguageProvider language="en">
 <TeamTable company="co-1" members={[]} invitations={[]} links={links} agents={agents}
  allowed={new Set()} invitedAllowed={new Set()} userId="p-0" owner={true} save={save} saveInvitation={save} send={vi.fn(async () => ({}))} cancelLink={cancelLink}/>
</LanguageProvider>;

test('a pending Invite link shows its label, Role, maker and end, and Cancel stops it and takes it away', async () => {
 const cancelLink=vi.fn<CancelLink>(async () => '');
 const screen=await render(tableWithLinks(cancelLink));
 const row=screen.getByRole('row').filter({hasText:'Nour Salah'});
 await expect.element(row.getByText('Viewer · Made by Omar · Ends Dec 4')).toBeVisible();
 await expect.element(row.getByText('Invite link', {exact:true})).toBeVisible();
 await screen.getByRole('button', {name:'Cancel Nour Salah’s invite link'}).click();
 expect(cancelLink).toHaveBeenCalledWith('l-1');
 await screen.rerender(tableWithLinks(cancelLink, []));
 await expect.element(screen.getByText('Nour Salah')).not.toBeInTheDocument();
});

test('a cancel the database refuses says why and keeps the link in the table', async () => {
 const screen=await render(tableWithLinks(async () => 'inviteLinkCancelFailed'));
 await screen.getByRole('button', {name:'Cancel Nour Salah’s invite link'}).click();
 await expect.element(screen.getByText('Couldn’t cancel the link. Try again.')).toBeVisible();
 await expect.element(screen.getByText('Nour Salah')).toBeVisible();
});
