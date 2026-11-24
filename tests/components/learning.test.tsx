import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import type { ComponentProps } from 'react';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n } from '@/lib/i18n.mjs';
import { LearningSection } from '@/app/settings-learning';
import { AgentLearningMode } from '@/app/settings-learning-client';
import type { CompanyLearning } from '@/lib/company-learning.mjs';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: ({ onClick, ...props }: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))} onClick={event => { onClick?.(event); event.preventDefault(); }}/> }));
const fetchMock = vi.fn(async (_input:string|URL|Request, _init?:RequestInit) => new Response('{}', { status: 200 }));
afterEach(() => { fetchMock.mockClear(); refresh.mockReset(); vi.unstubAllGlobals(); });

const company = '10000000-0000-0000-0000-000000000001';
const lead = '3a000000-0000-0000-0000-000000000011';
const writer = '3a000000-0000-0000-0000-000000000021';
const rule = 'من دلوقتي ما تبعتش حاجة للعميل من غير ما أشوفها';
const active = 'c0000000-0000-0000-0000-000000000001';
const forgotten = 'c0000000-0000-0000-0000-000000000002';
const data: CompanyLearning = {
 state: 'found',
 agents: [
  { id: lead, name: 'Lead', own: true, shared: false, follow: true, mode: 'ask', learned: [{ name: 'weekly-recap', description: 'Writes the Friday recap.' }] },
  { id: writer, name: 'Writer', own: true, shared: false, follow: false, mode: 'auto', learned: null },
 ],
 rules: [
  { id: active, agent: lead, body: rule, saidBy: null, saidByName: 'Omar', saidAt: '2026-11-18T10:00:00Z', removed: false, shared: false },
  { id: forgotten, agent: writer, body: 'No emojis', saidBy: null, saidByName: 'Omar', saidAt: '2026-11-17T10:00:00Z', removed: true, shared: true },
 ],
 lessons: [],
};
const screen = (language:'en'|'ar' = 'en', { canManage = true, owner = true, value = data }: { canManage?: boolean, owner?: boolean, value?: CompanyLearning } = {}) => {
 vi.stubGlobal('fetch', fetchMock);
 return render(<LanguageProvider language={language}>
  <LearningSection t={i18n(language).t} slug="rs-learning" company={company} canManage={canManage} owner={owner} data={value}/>
 </LanguageProvider>);
};
const bodyOf = async (call:number) => JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string);
const button = (view:Awaited<ReturnType<typeof screen>>, name:RegExp) => view.getByRole('button', { name }).elements();
const companyModes = (view:Awaited<ReturnType<typeof screen>>) => view.getByRole('radiogroup', { name: 'For the whole company' });
const forget = (view:Awaited<ReturnType<typeof screen>>) => view.getByRole('button', { name: /^Forget the rule:/ });
const bringBack = (view:Awaited<ReturnType<typeof screen>>) => view.getByRole('button', { name: /^Bring back the rule:/ });

test('a Skill an Agent learned shows no restore and no forget: the pinned Engine has no route for either', async () => {
 const view = await screen();
 await expect.element(forget(view)).toBeVisible();
 const skill = view.getByText('weekly-recap', { exact: true }).element().closest('li')!;
 expect(skill.textContent).toContain('A skill it learned');
 expect(skill.textContent).toContain('Learned on its own');
 expect(skill.querySelectorAll('button')).toHaveLength(0);
 // Its row opens the Skill's own page (#181); the address names the Agent and the Skill.
 const see = skill.querySelector('a')!;
 expect(see.textContent).toBe('See the steps');
 expect(see.getAttribute('href')).toBe(`/c/rs-learning/settings?section=learning&agent=${lead}&skill=weekly-recap`);
 // Only the two rule rows carry a control: one to forget and one to bring back.
 expect(button(view, /^(Forget the rule:|Bring back the rule:)/).map(control => control.getAttribute('aria-label'))).toEqual([`Forget the rule: ${rule.length>40?`${rule.slice(0,40)}…`:rule}`, 'Bring back the rule: No emojis']);
});

test('a rule can be forgotten and a forgotten one brought back, each through its own method and then the page is read again', async () => {
 const view = await screen();
 await expect.element(forget(view)).toBeVisible();
 await forget(view).click();
 await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
 expect(fetchMock.mock.calls[0][0]).toBe('/api/agent-rules');
 expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'POST' }));
 expect(await bodyOf(0)).toEqual({ company, rule: active });
 await expect.poll(() => refresh.mock.calls.length).toBe(1);
 await bringBack(view).click();
 await expect.poll(() => fetchMock.mock.calls.length).toBe(2);
 expect(fetchMock.mock.calls[1][0]).toBe('/api/agent-rules');
 expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'PUT' }));
 expect(await bodyOf(1)).toEqual({ company, rule: forgotten });
});

test('the Owner picks the Company mode and one Agent\'s, each written through the settings route', async () => {
 const owner = await screen();
 await expect.element(companyModes(owner).getByRole('radio', { name: /^Asks first/ })).toBeVisible();
 expect(companyModes(owner).getByRole('radio', { name: /^Asks first/ }).element().getAttribute('aria-disabled')).toBeNull();
 expect(companyModes(owner).getByRole('radio', { name: /^Learns on its own/ }).element().getAttribute('aria-checked')).toBe('false');
 expect(companyModes(owner).getByRole('radio', { name: /^Asks first/ }).element().getAttribute('aria-checked')).toBe('false');
 const leadModes = owner.getByRole('radiogroup', { name: 'Lead' });
 expect(leadModes.getByRole('radio', { name: 'Follow the company' }).element().getAttribute('aria-checked')).toBe('true');
 const writerModes = owner.getByRole('radiogroup', { name: 'Writer' });
 expect(writerModes.getByRole('radio', { name: 'Learns on its own', exact: true }).element().getAttribute('aria-checked')).toBe('true');
 expect(writerModes.getByRole('radio', { name: 'Follow the company' }).element().getAttribute('aria-checked')).toBe('false');
 await companyModes(owner).getByRole('radio', { name: /^Learns on its own/ }).click();
 await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
 expect(fetchMock.mock.calls[0][0]).toBe('/api/agent-settings');
 expect(await bodyOf(0)).toEqual({ company, mode: 'auto' });
 await owner.getByRole('radiogroup', { name: 'Writer' }).getByRole('radio', { name: 'Asks first', exact: true }).click();
 await expect.poll(() => fetchMock.mock.calls.length).toBe(2);
 expect(await bodyOf(1)).toEqual({ company, agent: writer, mode: 'ask' });
 // An Agent that chose its own mode can be given back to the Company's.
 await owner.getByRole('radiogroup', { name: 'Writer' }).getByRole('radio', { name: 'Follow the company' }).click();
 await expect.poll(() => fetchMock.mock.calls.length).toBe(3);
 expect(await bodyOf(2)).toEqual({ company, agent: writer, mode: 'follow' });
});

test('a reader below Owner sees the Company mode and each Agent\'s with no choice', async () => {
 const reader = await screen('en', { canManage: false, owner: false });
 await expect.element(companyModes(reader).getByRole('radio', { name: /^Asks first/ })).toBeVisible();
 expect(reader.getByRole('radio').elements()).toHaveLength(2);
 expect(reader.getByRole('radio').elements().every(element => element.getAttribute('aria-disabled') === 'true')).toBe(true);
 expect(reader.getByRole('radiogroup', { name: 'Lead' }).elements()).toHaveLength(0);
 // With no mode marked, the first choice still receives the Tab stop.
 expect(reader.getByRole('radio').elements()[0].tabIndex).toBe(0);
});

test('the mode choices are one Tab stop and the arrow keys move and select them, left in Arabic', async () => {
 const view = await screen('en', { value: { ...data, agents: (data.agents ?? []).map(agent => ({ ...agent, follow: false, mode: 'auto' as const })) } });
 const auto = companyModes(view).getByRole('radio', { name: /^Learns on its own/ });
 const ask = companyModes(view).getByRole('radio', { name: /^Asks first/ });
 await expect.element(auto).toHaveAttribute('aria-checked', 'true');
 expect(auto.element().tabIndex).toBe(0);
 expect(ask.element().tabIndex).toBe(-1);
 auto.element().focus();
 await userEvent.keyboard('{ArrowRight}');
 await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
 expect(await bodyOf(0)).toEqual({ company, mode: 'ask' });
 expect(document.activeElement?.id).toBe(`ln-co-ask`);
 await view.unmount();
 const arabic = await screen('ar', { value: { ...data, agents: (data.agents ?? []).map(agent => ({ ...agent, follow: false, mode: 'auto' as const })) } });
 const arabicAuto = arabic.getByRole('radiogroup', { name: 'للشركة كلها' }).getByRole('radio', { name: /^يتعلّم لوحده/ });
 await expect.element(arabicAuto).toHaveAttribute('aria-checked', 'true');
 arabicAuto.element().focus();
 await userEvent.keyboard('{ArrowLeft}');
 await expect.poll(() => fetchMock.mock.calls.length).toBe(2);
 expect(await bodyOf(1)).toEqual({ company, mode: 'ask' });
 expect(document.activeElement?.id).toBe('ln-co-ask');
});

test('one Agent\'s mode is one Tab stop and the arrow keys move and select it; a mode it has not chosen still has one', async () => {
 const view = await screen('en', { value: { ...data, agents: [{ id: writer, name: 'Writer', own: true, shared: false, follow: false, mode: 'auto', learned: null }] } });
 const writerModes = view.getByRole('radiogroup', { name: 'Writer' });
 const auto = writerModes.getByRole('radio', { name: 'Learns on its own', exact: true });
 const ask = writerModes.getByRole('radio', { name: 'Asks first', exact: true });
 await expect.element(auto).toHaveAttribute('aria-checked', 'true');
 expect(auto.element().tabIndex).toBe(0);
 expect(ask.element().tabIndex).toBe(-1);
 // The request is held open: the choice the arrow reached keeps the focus while it is sent (#588), and a second
 // press waits for the first.
 let answer!: (response:Response) => void;
 fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { answer = resolve; }));
 auto.element().focus();
 await userEvent.keyboard('{ArrowRight}');
 await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
 expect(await bodyOf(0)).toEqual({ company, agent: writer, mode: 'ask' });
 await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
 expect(document.activeElement?.id).toBe(`ln-${writer}-ask`);
 await expect.element(ask).toHaveAttribute('aria-disabled', 'true');
 await userEvent.keyboard('{ArrowLeft}');
 expect(fetchMock.mock.calls).toHaveLength(1);
 expect(document.activeElement?.id).toBe(`ln-${writer}-ask`);
 answer(new Response('{}', { status: 200 }));
 await expect.poll(() => refresh.mock.calls.length).toBe(1);
 await expect.element(ask).not.toHaveAttribute('aria-disabled');
 await view.unmount();
 // A mode the screen does not know leaves the first choice as the group's one Tab stop.
 const unknown = await render(<LanguageProvider language="en"><AgentLearningMode company={company} agent={writer} labelId="ln-t" mode={null} follows={false}/></LanguageProvider>);
 expect(unknown.getByRole('radio', { name: 'Learns on its own' }).element().tabIndex).toBe(0);
 expect(unknown.getByRole('radio', { name: 'Asks first' }).element().tabIndex).toBe(-1);
});

test('a Company whose Agents disagree reads as mixed, and an Agent whose profile cannot be read says so', async () => {
 const view = await screen('ar', { value: { ...data, agents: [
  { id: lead, name: 'Lead', own: true, shared: false, follow: false, mode: 'ask', learned: null },
  { id: writer, name: 'Writer', own: true, shared: false, follow: true, mode: null, learned: null },
 ] } });
 expect(view.getByText('مش قادرين نقرا وضع التعلّم دلوقتي.').elements().length).toBeGreaterThan(0);
 await expect.element(view.getByRole('radiogroup', { name: 'Lead' }).getByRole('radio', { name: 'يستأذن الأول' })).toBeVisible();
 expect(view.getByRole('radiogroup', { name: 'للشركة كلها' }).getByRole('radio').elements().every(element => element.getAttribute('aria-checked') === 'false')).toBe(true);
 expect(view.getByRole('radiogroup', { name: 'Lead' }).getByRole('radio', { name: 'يستأذن الأول' }).element().getAttribute('aria-checked')).toBe('true');
 expect(view.getByRole('radiogroup', { name: 'Writer' }).elements()).toHaveLength(0);
});
