import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n } from '@/lib/i18n.mjs';
import { OverlayChrome } from '@/app/settings-overlay-chrome';
import { BackLink } from '@/app/settings-overlay-frame';
import { AgentAbout, AgentSaveBar, AgentSkills, type AgentSkillRow } from '@/app/settings-agent-form';
import { AgentTabs } from '@/app/settings-agent-tabs';
import { ToastHost } from '@/app/toast';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

// #161: an Agent's About holds a draft until Save; the bar appears only when the draft differs, Cancel puts back what was
// saved with the focus on About, and every way out of the page keeps it while the draft differs, flashes the bar and puts
// the focus on Save.
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))}/> }));

afterEach(() => { push.mockReset(); vi.restoreAllMocks(); });

// The Agent page as the server draws it: the overlay's nav and frame, "All agents", About in its draft, the bar after the
// panel, the Memory tab, and the toasts the page raises. Each test takes a new Agent, so the page's one draft starts from
// the read.
let count = 0;
const skillsOf = (list: {name:string,description?:string,enabled?:boolean,learned?:boolean}[]): AgentSkillRow[] => list.map(skill => ({ name: skill.name, description: skill.description ?? '', enabled: skill.enabled ?? true, learned: skill.learned ?? false }));
const agentPage = (description = 'Runs the Meta ads.', skills: AgentSkillRow[] = [], editable = true) => {
 const agent = `ag-${++count}`;
 return render(<LanguageProvider language="en">
  <ToastHost />
  <OverlayChrome t={i18n('en').t} slug="rs-learning" companyName="RS Learning" role="owner" readOnly={false} section="agents" learningWaiting={0}>
   <BackLink className="link-btn sov-back" id="sov-back" slug="rs-learning" agent={agent}>All agents</BackLink>
   <AgentTabs slug="rs-learning" agent={agent} tab="settings" label="Lead"/>
   <div id="sov-agent-panel"><AgentAbout agent={agent} name="Lead" description={description}/><AgentSkills agent={agent} name="Lead" slug="rs-learning" learning skills={skills} editable={editable}/></div>
   <AgentSaveBar company="10000000-0000-0000-0000-000000000001" agent={agent} name="Lead"/>
  </OverlayChrome>
 </LanguageProvider>);
};
const bar = () => document.getElementById('dp-savebar')!;

// A click's default action, as React left it when the page's own handler ran.
function watchClicks() {
 const prevented: boolean[] = [];
 const record = (event: MouseEvent) => { prevented.push(event.defaultPrevented); event.preventDefault(); };
 document.addEventListener('click', record);
 return { prevented, stop: () => document.removeEventListener('click', record) };
}

test('the bar is hidden until the draft differs, and back to hidden when it matches again', async () => {
 const screen = await agentPage();
 const field = screen.getByRole('textbox', { name: 'What Lead does' });
 await expect.element(field).toHaveValue('Runs the Meta ads.');
 expect(bar().hidden).toBe(true);
 await field.fill('Runs the Meta and Google ads.');
 await expect.element(screen.getByRole('region', { name: 'Save settings' })).toBeVisible();
 await expect.element(screen.getByText('You have unsaved changes')).toBeVisible();
 await field.fill('Runs the Meta ads.');
 await expect.poll(() => bar().hidden).toBe(true);
});

test('Cancel puts back what was saved, puts the focus on About and says so', async () => {
 const screen = await agentPage();
 const field = screen.getByRole('textbox', { name: 'What Lead does' });
 await field.fill('Something else.');
 await screen.getByRole('button', { name: 'Cancel' }).click();
 await expect.element(field).toHaveValue('Runs the Meta ads.');
 await expect.element(field).toHaveFocus();
 await expect.poll(() => bar().hidden).toBe(true);
 await expect.poll(() => document.querySelector('.toast')?.textContent).toContain('Back to your saved settings');
});

test('Save sends About and shows what the Engine kept, then says the Agent uses it from the next message', async () => {
 const answer = { saved: { about: 'Plans and runs the Meta ads.' } };
 const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } }));
 const screen = await agentPage();
 const field = screen.getByRole('textbox', { name: 'What Lead does' });
 await field.fill('  Plans and runs the Meta ads.  ');
 await screen.getByRole('button', { name: 'Save', exact: true }).click();
 const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
 expect(sent).toEqual({ company: '10000000-0000-0000-0000-000000000001', agent: sent.agent, changes: { about: '  Plans and runs the Meta ads.  ' } });
 await expect.element(field).toHaveValue('Plans and runs the Meta ads.');
 await expect.poll(() => bar().hidden).toBe(true);
 await expect.poll(() => document.querySelector('.toast')?.textContent).toContain('Saved. Lead will use the new settings from the next message');
});

test('a Save the server refuses says so and keeps the draft', async () => {
 vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'agentPageFailed' }), { status: 502, headers: { 'Content-Type': 'application/json' } }));
 const screen = await agentPage();
 const field = screen.getByRole('textbox', { name: 'What Lead does' });
 await field.fill('Something else.');
 await screen.getByRole('button', { name: 'Save', exact: true }).click();
 await expect.element(screen.getByRole('alert')).toHaveTextContent('Could not save the settings. Try again.');
 await expect.element(field).toHaveValue('Something else.');
 await expect.poll(() => bar().hidden).toBe(false);
});

for (const way of ['a section', 'All agents', 'the close button', 'Escape', 'the Memory tab'] as const) test(`leaving by ${way} while the draft differs keeps the page, flashes the bar and puts the focus on Save`, async () => {
 const screen = await agentPage();
 await screen.getByRole('textbox', { name: 'What Lead does' }).fill('Something else.');
 const clicks = watchClicks();
 try {
  if (way === 'a section') await screen.getByRole('link', { name: 'Usage' }).click();
  else if (way === 'All agents') await screen.getByRole('link', { name: 'All agents', exact: true }).click();
  else if (way === 'the close button') await screen.getByRole('button', { name: 'Close settings and go back' }).click();
  else if (way === 'Escape') await userEvent.keyboard('{Escape}');
  else await screen.getByRole('tab', { name: 'Memory' }).click();
 } finally { clicks.stop(); }
 if (way === 'a section' || way === 'All agents' || way === 'the Memory tab') expect(clicks.prevented.at(-1), 'the page kept the click').toBe(true);
 expect(push).not.toHaveBeenCalled();
 await expect.element(screen.getByRole('button', { name: 'Save', exact: true })).toHaveFocus();
 await expect.poll(() => bar().className).toContain('is-flash');
 await expect.poll(() => document.querySelector('.toast')?.textContent).toContain('Save or discard your changes first');
 await expect.element(screen.getByRole('textbox', { name: 'What Lead does' })).toHaveValue('Something else.');
});

test('without a draft the close button leaves as it always did', async () => {
 const screen = await agentPage();
 await screen.getByRole('button', { name: 'Close settings and go back' }).click();
 expect(push).toHaveBeenCalledOnce();
});

test('the Skills heading counts the switches that are on, a learned skill is marked, and one Save sends every changed field', async () => {
 const answer = { saved: { about: 'Plans and runs the Meta and Google ads.', 'skill:weekly-recap': 'off', 'skill:ads-brief': 'on' } };
 const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } }));
 const skills = skillsOf([
  { name: 'weekly-recap', description: 'Writes the Friday recap.', learned: true },
  { name: 'ads-brief', description: 'Drafts the week of ads.', enabled: false },
  { name: 'hub-skill', description: 'From the hub.' },
 ]);
 const screen = await agentPage('Runs the Meta ads.', skills);
 await expect.element(screen.getByRole('heading', { name: 'Skills 2/3' })).toBeVisible();
 expect(screen.getByText('Learned on its own').elements()).toHaveLength(1);
 expect(bar().hidden).toBe(true);
 // Two switches changed; the heading follows the draft before the save.
 await screen.getByRole('switch', { name: 'weekly-recap' }).click();
 await expect.element(screen.getByRole('heading', { name: 'Skills 1/3' })).toBeVisible();
 await screen.getByRole('switch', { name: 'ads-brief' }).click();
 await expect.element(screen.getByRole('heading', { name: 'Skills 2/3' })).toBeVisible();
 await expect.element(screen.getByRole('region', { name: 'Save settings' })).toBeVisible();
 await screen.getByRole('textbox', { name: 'What Lead does' }).fill('  Plans and runs the Meta and Google ads.  ');
 await screen.getByRole('button', { name: 'Save', exact: true }).click();
 const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
 expect(sent.changes).toEqual({
  about: '  Plans and runs the Meta and Google ads.  ',
  'skill:weekly-recap': 'off',
  'skill:ads-brief': 'on',
 });
 await expect.poll(() => bar().hidden).toBe(true);
 await expect.element(screen.getByRole('switch', { name: 'weekly-recap' })).toHaveAttribute('aria-checked', 'false');
});

test('a Contributor reads On and Off for each skill and is offered no switch', async () => {
 const screen = await agentPage('Runs the Meta ads.', skillsOf([
  { name: 'weekly-recap' },
  { name: 'ads-brief', enabled: false },
 ]), false);
 expect(screen.getByRole('switch').elements()).toHaveLength(0);
 await expect.element(screen.getByText('On')).toBeVisible();
 await expect.element(screen.getByText('Off')).toBeVisible();
 await expect.element(screen.getByRole('heading', { name: 'Skills 1/2' })).toBeVisible();
});
