import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { cdp, page } from 'vitest/browser';
import type {} from '@vitest/browser-playwright';
import type { ComponentProps } from 'react';
import { AgentFace } from '@/components/agent-face';
import { LooksProvider } from '@/lib/agent-looks-client';
import { useReportRun } from '@/lib/live-runs';
import { MemberPicker } from '@/lib/work-activity';
import { AgentIdentitiesProvider } from '@/lib/agent-identities-client';
import { LanguageProvider } from '@/lib/i18n-client';
import type { CompanyLooks } from '@/lib/agent-looks';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';

vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));

const reducedMotion = (on: boolean) => cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
afterEach(async () => { vi.useRealTimers(); await reducedMotion(false); });

// Two Agents of one Company with the looks the database keeps for them (#696), and one request's Agent to come.
const looks: CompanyLooks = {
 agents: {
  lead: { shape: 'circle', colour: 'indigo', temperament: 'calm' },
  ads: { shape: 'blob', colour: 'rose', temperament: 'energetic' },
  coming: { shape: 'circle', colour: 'teal', temperament: 'neat' },
 },
 requests: { 7: 'coming' },
 removed: {},
};
const Company = ({ children }: { children: React.ReactNode }) => <div className="gw"><LooksProvider looks={looks}>{children}</LooksProvider></div>;
const faceOf = (agent: string, index = 0) => [...document.querySelectorAll<HTMLElement>('.face')].filter(face => face.dataset.agent === agent)[index];
const base = (face: Element) => getComputedStyle(face.querySelector('.f-base')!).backgroundImage;
const moving = (face: Element) => face.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length > 0;

test('every Agent wears its own look, the same at every size, and one with none in hand is drawn plain', async () => {
 await render(<Company><AgentFace agent="lead" size={56}/><AgentFace agent="lead" size={20}/><AgentFace agent="ads" size={56}/><AgentFace agent="gone" size={56}/></Company>);
 const [lead, small, ads, gone] = [faceOf('lead'), faceOf('lead', 1), faceOf('ads'), faceOf('gone')];
 expect([lead.dataset.shape, lead.dataset.colour, lead.dataset.temperament]).toEqual(['circle', 'indigo', 'calm']);
 expect([ads.dataset.shape, ads.dataset.colour, ads.dataset.temperament]).toEqual(['blob', 'rose', 'energetic']);
 // The approved indigo and rose, light to deep (design-reference-orb PRESETS).
 expect(base(lead)).toContain('rgb(134, 112, 240)');
 expect(base(ads)).toContain('rgb(220, 79, 146)');
 expect(base(small)).toBe(base(lead));
 expect(gone.dataset.colour).toBe('slate');
 // The blob's outline masks its body; the circle needs none.
 expect(getComputedStyle(ads.querySelector('.f-body')!).maskImage).toContain('data:image/svg+xml');
 expect(getComputedStyle(lead.querySelector('.f-body')!).borderRadius).toBe('50%');
 const box = lead.getBoundingClientRect();
 expect([box.width, box.height]).toEqual([56, 56]);
});

test('a request\'s card asks for the face its Agent will have', async () => {
 const { useRequestAgent } = await import('@/lib/agent-looks-client');
 function Request() { return <AgentFace agent={useRequestAgent(7)} size={48}/>; }
 await render(<Company><Request/><AgentFace agent="coming" size={48}/></Company>);
 expect(faceOf('coming').dataset.colour).toBe('teal');
 expect(base(faceOf('coming'))).toBe(base(faceOf('coming', 1)));
});

test('from 24px a face breathes as its temperament does; under 24px it is still', async () => {
 await render(<Company><AgentFace agent="lead" size={24}/><AgentFace agent="ads" size={56}/><AgentFace agent="lead" size={22}/></Company>);
 const breath = (face: Element) => getComputedStyle(face.querySelector('.f-breath')!);
 expect([breath(faceOf('lead')).animationName, breath(faceOf('lead')).animationDuration]).toEqual(['gw-face-breath', '6s']);
 expect([breath(faceOf('ads')).animationName, breath(faceOf('ads')).animationDuration]).toEqual(['gw-face-bounce', '2.4s']);
 const small = faceOf('lead', 1);
 expect(small.classList.contains('face--still')).toBe(true);
 expect(breath(small).animationName).toBe('none');
 expect(small.querySelector('.f-glow, .f-flows, .f-swirl')).toBeNull();
 expect(moving(small)).toBe(false);
});

test('the face is silent for a screen reader, and its glow is never cut off by its own box', async () => {
 await render(<Company><span className="agent-tile"><AgentFace agent="lead" size={56} dot/></span></Company>);
 const wrap = document.querySelector('.fw')!;
 expect(wrap.getAttribute('aria-hidden')).toBe('true');
 await expect.element(page.getByRole('img')).not.toBeInTheDocument();
 for (const element of [wrap, faceOf('lead'), faceOf('lead').querySelector('.f-breath')!]) expect(getComputedStyle(element).overflow).toBe('visible');
 const glow = faceOf('lead').querySelector('.f-glow')!.getBoundingClientRect();
 expect(glow.width).toBeGreaterThan(56);
});

function Reading({ agent, open, state = 'idle' }: { agent: string, open: boolean, state?: 'idle' | 'working' | 'waiting' }) {
 useReportRun(agent, open ? 'thinking' : 'well');
 return <AgentFace agent={agent} size={56} state={state} dot live/>;
}
const shown = () => ({ state: faceOf('lead').dataset.state, dot: document.querySelector('.fw > .dot')!.className });

test('the face shows its state, and a Run open in the Conversation being read shows it thinking, then done, unless it waits on the reader', async () => {
 const screen = await render(<Company><Reading agent="lead" open={false}/></Company>);
 expect(shown()).toEqual({ state: 'idle', dot: 'dot dot--idle' });
 await screen.rerender(<Company><Reading agent="lead" open={false} state="working"/></Company>);
 expect(shown()).toEqual({ state: 'working', dot: 'dot dot--working' });
 await screen.rerender(<Company><Reading agent="lead" open/></Company>);
 await expect.poll(shown).toEqual({ state: 'thinking', dot: 'dot dot--thinking' });
 await screen.rerender(<Company><Reading agent="lead" open state="waiting"/></Company>);
 expect(shown()).toEqual({ state: 'waiting', dot: 'dot dot--waiting' });
 await screen.rerender(<Company><Reading agent="lead" open/></Company>);
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
 await screen.rerender(<Company><Reading agent="lead" open={false}/></Company>);
 await expect.poll(shown).toEqual({ state: 'done', dot: 'dot dot--done' });
 // Done closes its eyes in a smile.
 await expect.poll(() => getComputedStyle(faceOf('lead').querySelector('.e-open')!).opacity).toBe('0');
 await vi.advanceTimersByTimeAsync(1600);
 await expect.poll(shown).toEqual({ state: 'idle', dot: 'dot dot--idle' });
});

test('with reduced motion nothing moves, and the expression still changes', async () => {
 await reducedMotion(true);
 const screen = await render(<Company><AgentFace agent="ads" size={56} dot/></Company>);
 const face = faceOf('ads');
 await expect.poll(() => moving(face)).toBe(false);
 expect(getComputedStyle(face.querySelector('.f-breath')!).animationName).toBe('none');
 await screen.rerender(<Company><AgentFace agent="ads" size={56} state="working" dot/></Company>);
 expect(face.dataset.state).toBe('working');
 expect(getComputedStyle(face.querySelector('.f-swirl')!).opacity).toBe('0.8');
 expect(moving(face)).toBe(false);
 expect(getComputedStyle(document.querySelector('.dot')!, '::after').display).toBe('none');
});

test('a legacy role agent shows its name\'s first letter, as a person does, and the card\'s assignee menu chooses it', async () => {
 const writer = { id: '30000000-0000-0000-0000-000000000001', role: 'writer', name: 'وكيل المحتوى' };
 const members = [{ person_id: '20000000-0000-0000-0000-000000000002', people: { name: 'Mona' } }, { person_id: writer.id, agent_role: 'writer', people: { name: writer.name } }];
 const screen = await render(<LanguageProvider language="en"><AgentIdentitiesProvider agents={[writer]}>
  <form><MemberPicker label="Add assignee" name="person" members={members}/></form>
 </AgentIdentitiesProvider></LanguageProvider>);
 await screen.getByRole('button', { name: 'Add assignee' }).click();
 const option = page.getByRole('menuitemradio', { name: writer.name });
 await expect.element(option).toBeVisible();
 expect(option.element().querySelector('.avatar')!.textContent).toBe('و');
 expect(option.element().querySelector('.face')).toBeNull();
 await option.click();
 await expect.poll(() => new FormData(document.querySelector('form')!).get('person')).toBe(writer.id);
});

// #702: a record that names no Agent (a Conversation detached before its Agent's id was kept) shows the first letter of
// the name it keeps, as a person does; one that names its Agent shows its look, its Agent removed or not.
test('a record that names no Agent shows the first letter of the name it keeps', async () => {
 await render(<Company><AgentFace agent={null} name="  Ads" size={24}/><AgentFace agent="" name="عمر" size={20}/><AgentFace agent="ads" name="Ads" size={24}/></Company>);
 expect([...document.querySelectorAll('.avatar')].map(letter => letter.textContent)).toEqual(['A', 'ع']);
 expect(document.querySelectorAll('.face')).toHaveLength(1);
 expect(faceOf('ads').dataset.colour).toBe('rose');
 const letter = document.querySelector<HTMLElement>('.avatar')!;
 expect(letter.getAttribute('aria-hidden')).toBe('true');
 expect([letter.getBoundingClientRect().width, letter.getBoundingClientRect().height]).toEqual([24, 24]);
});
