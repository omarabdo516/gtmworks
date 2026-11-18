import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { LanguageProvider } from '@/lib/i18n-client';
import { AgentAbout, AgentInstructions, AgentInstructionsReadOnly, AgentSaveBar } from '@/app/settings-agent-form';
import { ToastHost } from '@/app/toast';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

// #176: How it works is the Agent's SOUL.md outside the team's rules section. The Owner's field counts the whole file
// against the limit the Engine loads (the section counts) and refuses more; every other Role reads the text with its line
// breaks kept, or the empty line. The save bar sends every changed field in one request (#161, #176).
afterEach(() => { vi.restoreAllMocks(); });

let count = 0;
const agent = () => `ag-${++count}`;
const page = (agent: string, instructions = 'Runs the team.') => render(<LanguageProvider language="en">
 <ToastHost />
 <div>
  <AgentAbout agent={agent} name="Lead" description="Runs the team."/>
  <AgentInstructions agent={agent} name="Lead" instructions={instructions} sectionChars={100} limit={20000}/>
  <AgentSaveBar company="10000000-0000-0000-0000-000000000001" agent={agent} name="Lead"/>
 </div>
</LanguageProvider>);

test('the counter follows the typing, counts the rules section, and the field takes no more than the Engine loads', async () => {
 const id = agent();
 const screen = await render(<LanguageProvider language="en">
  <AgentInstructions agent={id} name="Lead" instructions="abc" sectionChars={4} limit={10}/>
 </LanguageProvider>);
 const field = screen.getByRole('textbox', { name: 'Standing instructions for Lead' });
 await expect.element(field).toHaveValue('abc');
 await expect.element(screen.getByText('7 / 10')).toBeVisible();
 // Four characters fit (three are already there); more than that is refused by the field itself.
 await field.fill('abcdefgh');
 await expect.element(field).toHaveValue('abcdef');
 await expect.element(screen.getByText('10 / 10')).toBeVisible();
 expect(field.element()).not.toHaveAttribute('placeholder');
});

test('the save bar sends About and the instructions together when both changed', async () => {
 const id = agent();
 const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({ saved: { about: 'Plans the ads.', instructions: 'Tone: short.' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
 const screen = await render(<LanguageProvider language="en">
  <ToastHost />
  <AgentAbout agent={id} name="Lead" description="Runs the team."/>
  <AgentInstructions agent={id} name="Lead" instructions="Runs the team." sectionChars={0} limit={20000}/>
  <AgentSaveBar company="10000000-0000-0000-0000-000000000001" agent={id} name="Lead"/>
 </LanguageProvider>);
 await screen.getByRole('textbox', { name: 'What Lead does' }).fill('Plans the ads.');
 await screen.getByRole('textbox', { name: 'Standing instructions for Lead' }).fill('Tone: short.');
 await screen.getByRole('button', { name: 'Save', exact: true }).click();
 const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
 expect(sent).toEqual({ company: '10000000-0000-0000-0000-000000000001', agent: id, changes: { about: 'Plans the ads.', instructions: 'Tone: short.' } });
 await expect.poll(() => document.getElementById('dp-savebar')!.hidden).toBe(true);
});

test('every other Role reads the text with its line breaks kept, or the empty line', async () => {
 const screen = await render(<LanguageProvider language="en">
  <AgentInstructionsReadOnly instructions={'Tone: short.\nNever promise a date.'} empty="No standing instructions."/>
 </LanguageProvider>);
 await expect.element(screen.getByText(/Tone: short\./)).toBeVisible();
 await expect.element(screen.getByText(/Never promise a date\./)).toBeVisible();
 expect(document.body.textContent).toContain('Tone: short.\nNever promise a date.');
 expect(document.querySelector('textarea')).toBeNull();
 const empty = await render(<LanguageProvider language="en">
  <AgentInstructionsReadOnly instructions="" empty="No standing instructions."/>
 </LanguageProvider>);
 await expect.element(empty.getByText('No standing instructions.')).toBeVisible();
});

test('a save carries only the fields that changed and leaves the others as they are', async () => {
 const id = agent();
 const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({ saved: { about: 'Plans the ads.' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
 const screen = await page(id);
 const instructions = screen.getByRole('textbox', { name: 'Standing instructions for Lead' });
 await expect.element(instructions).toHaveValue('Runs the team.');
 await screen.getByRole('textbox', { name: 'What Lead does' }).fill('Plans the ads.');
 await screen.getByRole('button', { name: 'Save', exact: true }).click();
 const sent = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
 expect(sent.changes).toEqual({ about: 'Plans the ads.' });
 await expect.poll(() => document.getElementById('dp-savebar')!.hidden).toBe(true);
 await expect.element(instructions).toHaveValue('Runs the team.');
});
