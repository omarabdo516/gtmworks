import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import NewChannelDialog from '@/app/new-channel-dialog';
import { LanguageProvider } from '@/lib/i18n-client';
import { channelChoices, createChannel } from '@/app/channel-actions';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
// The composer's settings link is the app's Link, which needs Next's router; a plain link stands in.
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
vi.mock('@/app/channel-actions', () => ({ channelChoices: vi.fn(), createChannel: vi.fn() }));
const choices = {
 people: [{ person: 'p-1', name: 'Omar', role: 'owner' as const, invitation: null, email: null }, { person: 'p-2', name: 'Sara Adel', role: 'manager' as const, invitation: null, email: null }, { person: 'p-4', name: 'Mona', role: 'viewer' as const, invitation: null, email: null }],
 agents: [{ id: 'a-1', connection_id: 'c-1', name: 'Lead', speciality: 'General', main: true }, { id: 'a-2', connection_id: 'c-2', name: 'Critic', speciality: '', main: false }],
};
beforeEach(() => { vi.mocked(channelChoices).mockResolvedValue(choices); });
afterEach(() => { vi.mocked(createChannel).mockReset(); push.mockReset(); });

const dialog = async (language: 'en' | 'ar' = 'en') => {
 const close = vi.fn();
 const screen = await render(<LanguageProvider language={language}><NewChannelDialog slug="rs" company="co-1" person="p-1" close={close}/></LanguageProvider>);
 await expect.element(screen.getByRole('checkbox', { name: /Sara Adel|سارة/ })).toBeVisible();
 return { screen, close };
};

test('the creator is always in it; the Members and Agents offered are chosen and counted', async () => {
 const { screen } = await dialog();
 const creator = screen.getByRole('checkbox', { name: /Omar \(you\)/ });
 await expect.element(creator).toHaveAttribute('aria-checked', 'true');
 await expect.element(creator).toHaveAttribute('aria-disabled', 'true');
 expect(creator.element().textContent).toMatch(/Whoever creates the channel is in it$/);
 await creator.click({ force: true });
 await expect.element(creator).toHaveAttribute('aria-checked', 'true');
 expect(screen.getByRole('checkbox', { name: /Mona/ }).element().textContent).toMatch(/Viewer · will only read$/);
 expect(screen.getByRole('checkbox', { name: /Critic/ }).element().textContent).toMatch(/CriticNew agent$/);
 await expect.element(screen.getByRole('group', { name: /^Members/ })).toHaveAccessibleName('Members 1');
 await screen.getByRole('checkbox', { name: /Sara Adel/ }).click();
 await expect.element(screen.getByRole('group', { name: /^Members/ })).toHaveAccessibleName('Members 2');
 await screen.getByRole('checkbox', { name: /Critic/ }).click();
 await expect.element(screen.getByRole('group', { name: /^Agents in the channel/ })).toHaveAccessibleName('Agents in the channel 1');
 await expect.element(screen.getByText(/like @Lead\. Any member of the channel can call its agents here/)).toBeVisible();
});

test('a channel needs a name; the hint shows it as the channel list will', async () => {
 const { screen } = await dialog();
 const name = screen.getByRole('textbox', { name: 'Channel name' });
 await expect.element(screen.getByText('Shows under channels as: #channel-name')).toBeVisible();
 await screen.getByRole('button', { name: 'Create the channel' }).click();
 await expect.element(screen.getByText('The channel needs a name, even one word.')).toBeVisible();
 await expect.element(name).toHaveAttribute('aria-invalid', 'true');
 expect(createChannel).not.toHaveBeenCalled();
 await userEvent.type(name, ' #Launch week');
 await expect.element(screen.getByText('The channel needs a name, even one word.')).not.toBeVisible();
 await expect.element(screen.getByText('Shows under channels as: #Launch week')).toBeVisible();
});

test('Create the channel makes it with the people and Agents chosen and opens it', async () => {
 vi.mocked(createChannel).mockResolvedValue({ channel: 'ch-9' });
 const { screen, close } = await dialog();
 await userEvent.type(screen.getByRole('textbox', { name: 'Channel name' }), 'Launch week');
 await screen.getByRole('checkbox', { name: /Sara Adel/ }).click();
 await screen.getByRole('checkbox', { name: /Critic/ }).click();
 await screen.getByRole('button', { name: 'Create the channel' }).click();
 await expect.poll(() => push.mock.calls).toEqual([['/c/rs/channels/ch-9']]);
 expect(vi.mocked(createChannel).mock.calls).toEqual([['co-1', { key: expect.stringMatching(/^[0-9a-f-]{36}$/), name: 'Launch week', people: ['p-2'], agents: ['a-2'], invitees: [] }]]);
 expect(close).toHaveBeenCalled();
});

test('a name in use is said so, and trying again sends the same request key', async () => {
 vi.mocked(createChannel).mockResolvedValueOnce({ refused: 'channelNameTaken' }).mockResolvedValueOnce({ channel: 'ch-9' });
 const { screen } = await dialog('ar');
 const name = screen.getByRole('textbox', { name: 'اسم القناة' });
 await userEvent.type(name, 'عام 2');
 await userEvent.keyboard('{Enter}');
 await expect.element(screen.getByText('فيه قناة بالاسم ده. اختار اسم تاني.')).toBeVisible();
 expect(push).not.toHaveBeenCalled();
 await userEvent.type(name, ' جديد');
 await screen.getByRole('button', { name: 'اعمل القناة' }).click();
 await expect.poll(() => push.mock.calls.length).toBe(1);
 const [first, second] = vi.mocked(createChannel).mock.calls.map(([, request]) => request);
 expect(second.key).toBe(first.key);
 expect(second.name).toBe('عام 2 جديد');
});

test('a request that fails is said so, and Create works again with the same request key', async () => {
 vi.mocked(createChannel).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ channel: 'ch-9' });
 const { screen } = await dialog();
 await userEvent.type(screen.getByRole('textbox', { name: 'Channel name' }), 'Launch week');
 const create = screen.getByRole('button', { name: 'Create the channel' });
 await create.click();
 await expect.element(screen.getByText('Couldn’t create the channel. Try again.')).toBeVisible();
 await create.click();
 await expect.poll(() => push.mock.calls).toEqual([['/c/rs/channels/ch-9']]);
 const [first, second] = vi.mocked(createChannel).mock.calls.map(([, request]) => request);
 expect(second.key).toBe(first.key);
});

// #207: an invited person is offered like a Member, with their Role and email, and is created with the channel.
test('an invited person is offered with their Role and email and is created with the channel', async () => {
 vi.mocked(channelChoices).mockResolvedValue({ ...choices, people: [...choices.people, { person: null, name: 'Mona', role: 'contributor', invitation: 'i-1', email: 'mona@example.test' }] });
 vi.mocked(createChannel).mockResolvedValue({ channel: 'ch-9' });
 const { screen } = await dialog();
 const invited = screen.getByRole('checkbox', { name: /Mona Contributor/ });
 expect(invited.element().textContent).toBe('MMonaContributor · mona@example.test');
 await userEvent.type(screen.getByRole('textbox', { name: 'Channel name' }), 'Launch week');
 await invited.click();
 await expect.element(screen.getByRole('group', { name: /^Members/ })).toHaveAccessibleName('Members 2');
 await screen.getByRole('button', { name: 'Create the channel' }).click();
 await expect.poll(() => vi.mocked(createChannel).mock.calls.map(([, request]) => request.invitees)).toEqual([['i-1']]);
});
