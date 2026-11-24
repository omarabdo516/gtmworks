import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { cdp, page, userEvent } from 'vitest/browser';
import type { ComponentProps, ReactNode } from 'react';
import { AgentFace } from '@/components/agent-face';
import { LooksProvider } from '@/lib/agent-looks-client';
import { LanguageProvider } from '@/lib/i18n-client';
import { ToastHost } from '@/app/toast';
import { MadeCard } from '@/app/agent-card';
import { AgentDetails, useDetailsPanel } from '@/app/agent-details';
import { LookRow } from '@/app/agent-look-window';
import type { CompanyLooks } from '@/lib/agent-looks';
import type { KeptLook } from '@/lib/agent-look-saves';
import type { Language } from '@/lib/i18n.mjs';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
const change = vi.fn<(company: string, agent: string, part: string, choice: string | null) => Promise<KeptLook | null>>(), reset = vi.fn<(company: string, agent: string) => Promise<KeptLook | null>>();
afterEach(async () => { change.mockReset(); reset.mockReset(); await page.viewport(1280, 900); await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }); });

// Each test has an Agent of its own: the saves of this tab are kept by the Agent's id for the whole page.
const given: KeptLook['automatic'] = { shape: 'circle', colour: 'violet', temperament: 'energetic' };
const company = (agent: string, picked: KeptLook['picked'] = {}): CompanyLooks => ({ agents: { [agent]: { ...given, ...picked } }, requests: {}, kept: { [agent]: { automatic: given, picked, changedAt: picked.colour ? '2026-11-24T10:00:00Z' : null } } });
// The database's answer to a save: the look as it now stands.
const answer = (picked: KeptLook['picked'], at = '2026-11-24T11:00:00Z'): KeptLook => ({ automatic: given, picked, changedAt: at });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function Page({ agent, owner = true, language = 'en', picked, children }: { agent: string, owner?: boolean, language?: Language, picked?: KeptLook['picked'], children: ReactNode }) {
 return <div className="gw" dir={language === 'ar' ? 'rtl' : 'ltr'}><LanguageProvider language={language}><ToastHost/>
  <LooksProvider looks={company(agent, picked)} change={owner ? { company: 'co-1', slug: 'rs-learning', save: change, reset } : null}>
   <div className="sidebar-face"><AgentFace agent={agent} size={56}/></div>{children}
  </LooksProvider></LanguageProvider></div>;
}
const made = (id: string) => ({ id, connection_id: 'c-1', name: 'Reach', job: 'Runs the ads.', apps: [], fresh: false, created_at: '2026-11-24T09:00:00Z' });
const behind = (agent: string) => [...document.querySelectorAll<HTMLElement>('.face')].filter(face => face.dataset.agent === agent && !face.closest('.lk-tile, .lk-sw'));
const colours = (agent: string) => behind(agent).map(face => face.dataset.colour);
const dialog = () => page.getByRole('dialog', { name: 'Change Reach’s look' });
const toastText = () => document.querySelector('.toast-host')?.textContent ?? '';

test('the Owner opens the window from a made Agent\'s card; every press shows at once in every face behind it and saves, and Reset gives back the look it was given', async () => {
 const saved = deferred<KeptLook | null>();
 change.mockReturnValueOnce(saved.promise);
 await render(<Page agent="ag-card"><MadeCard slug="rs-learning" agent={made('ag-card')}/></Page>);
 const opener = page.getByRole('button', { name: 'Change Reach’s look' });
 await expect.element(opener).toHaveTextContent('Change its look');
 await opener.click();
 await expect.element(dialog()).toBeVisible();
 // The keyboard starts on the chosen shape; nothing is picked, so there is nothing to reset.
 await expect.element(dialog().getByRole('radio', { name: 'Circle' })).toHaveFocus();
 await expect.element(dialog().getByRole('button', { name: 'Reset to automatic' })).toBeDisabled();
 await expect.element(dialog().getByRole('radio', { name: 'Violet' })).toBeChecked();
 await expect.element(dialog().getByText('A little bounce, quick darting eyes.')).toBeVisible();
 await dialog().getByRole('radio', { name: 'Rose' }).click();
 // Before the database answers, every face of the Agent wears it, the card's, the sidebar's and the window's own.
 expect(colours('ag-card')).toEqual(['rose', 'rose', 'rose']);
 expect(change).toHaveBeenCalledWith('co-1', 'ag-card', 'colour', 'rose');
 await expect.element(dialog().getByRole('group', { name: 'Colour · Rose' })).toBeVisible();
 saved.resolve(answer({ colour: 'rose' }));
 await expect.element(dialog().getByRole('button', { name: 'Reset to automatic' })).toBeEnabled();
 change.mockResolvedValueOnce(answer({ colour: 'rose', temperament: 'dreamy' }, '2026-11-24T11:01:00Z'));
 await dialog().getByRole('radio', { name: 'Dreamy, creative' }).click();
 await expect.element(dialog().getByText('Drifts upward now and then; its colour flows.')).toBeVisible();
 expect(behind('ag-card').map(face => face.dataset.temperament)).toEqual(['dreamy', 'dreamy', 'dreamy']);
 reset.mockResolvedValueOnce(answer({}, '2026-11-24T11:02:00Z'));
 await dialog().getByRole('button', { name: 'Reset to automatic' }).click();
 expect(reset).toHaveBeenCalledWith('co-1', 'ag-card');
 await expect.element(dialog().getByRole('radio', { name: 'Violet' })).toBeChecked();
 expect(behind('ag-card').map(face => `${face.dataset.colour} ${face.dataset.temperament}`)).toEqual(['violet energetic', 'violet energetic', 'violet energetic']);
 await expect.element(dialog().getByRole('button', { name: 'Reset to automatic' })).toBeDisabled();
 expect(toastText()).toBe('');
 // Escape closes it and gives the keyboard back to the card's button.
 await userEvent.keyboard('{Escape}');
 await expect.element(dialog()).not.toBeInTheDocument();
 await expect.element(opener).toHaveFocus();
});

test('a save that fails puts the pick back with one short toast, and the keyboard stays on the choice that holds', async () => {
 change.mockResolvedValueOnce(null);
 await render(<Page agent="ag-fail"><MadeCard slug="rs-learning" agent={made('ag-fail')}/></Page>);
 await page.getByRole('button', { name: 'Change Reach’s look' }).click();
 const circle = dialog().getByRole('radio', { name: 'Circle' });
 await expect.element(circle).toHaveFocus();
 await userEvent.keyboard('{ArrowRight}');
 await expect.element(circle).toBeChecked();
 await expect.element(circle).toHaveFocus();
 expect(behind('ag-fail').map(face => face.dataset.shape)).toEqual(['circle', 'circle', 'circle']);
 await expect.poll(toastText).toBe('Couldn’t save. Try again.');
});

test('answers out of order: an older failed save never undoes a newer pick, and a failed reset gives back the whole look kept before it', async () => {
 const first = deferred<KeptLook | null>(), second = deferred<KeptLook | null>();
 change.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
 await render(<Page agent="ag-order" picked={{ shape: 'blob', colour: 'jade' }}><MadeCard slug="rs-learning" agent={made('ag-order')}/></Page>);
 await page.getByRole('button', { name: 'Change Reach’s look' }).click();
 await dialog().getByRole('radio', { name: 'Rose' }).click();
 await dialog().getByRole('radio', { name: 'Sky' }).click();
 // The second save waits for the first, so the database ends with the last press.
 expect(change).toHaveBeenCalledTimes(1);
 first.resolve(null);
 await expect.poll(() => change.mock.calls.length).toBe(2);
 expect(colours('ag-order')).toEqual(['sky', 'sky', 'sky']);
 second.resolve(answer({ shape: 'blob', colour: 'sky' }));
 await expect.element(dialog().getByRole('radio', { name: 'Sky' })).toBeChecked();
 expect(toastText()).toBe('');
 // A reset that fails gives back every part it took: the shape as much as the colour.
 reset.mockResolvedValueOnce(null);
 await dialog().getByRole('button', { name: 'Reset to automatic' }).click();
 await expect.poll(toastText).toBe('Couldn’t save. Try again.');
 expect(behind('ag-order').map(face => `${face.dataset.shape} ${face.dataset.colour}`)).toEqual(['blob sky', 'blob sky', 'blob sky']);
 await expect.element(dialog().getByRole('radio', { name: 'Soft blob' })).toBeChecked();
});

test('any other Role sees no way to change a look, and the details\' face only hops', async () => {
 function Details() { const panel = useDetailsPanel(); return <AgentDetails panel={panel} agent={{ id: 'ag-viewer', connection_id: 'c-1', name: 'Reach', speciality: 'Ads', main: false }} details={{ status: 'idle', tab: 'activity', tabs: { activity: null, tasks: null, files: null, memory: null, log: null } }} slug="rs-learning"/>; }
 await render(<Page agent="ag-viewer" owner={false}><MadeCard slug="rs-learning" agent={made('ag-viewer')}/><Details/><ul><LookRow agent={{ id: 'ag-viewer', name: 'Reach' }}/></ul></Page>);
 await expect.element(page.getByText('Open Reach')).toBeVisible();
 expect(page.getByRole('button', { name: 'Change Reach’s look' }).elements()).toHaveLength(0);
 expect(document.querySelector('.lk-pen')).toBeNull();
 // The Look row still says what the look is.
 await expect.element(page.getByText('Automatic · Violet · Energetic')).toBeVisible();
 const face = behind('ag-viewer').find(face => face.closest('.dp-id'))!;
 expect(face.closest('button')).toBeNull();
 face.click();
 await expect.poll(() => face.dataset.moment).toBe('press');
 expect(document.querySelector('dialog[open]')).toBeNull();
});

test('the Owner opens it from the pencil on the details\' face and from the Look row in Settings, whose words follow each press', async () => {
 function Details() { const panel = useDetailsPanel(); return <AgentDetails panel={panel} agent={{ id: 'ag-owner', connection_id: 'c-1', name: 'Reach', speciality: 'Ads', main: false }} details={{ status: 'idle', tab: 'activity', tabs: { activity: null, tasks: null, files: null, memory: null, log: null } }} slug="rs-learning"/>; }
 await render(<Page agent="ag-owner"><Details/><ul className="panel-card"><LookRow agent={{ id: 'ag-owner', name: 'Reach' }}/></ul></Page>);
 const pencil = page.getByRole('button', { name: 'Change Reach’s look' }).first();
 await expect.element(pencil).toHaveAttribute('aria-haspopup', 'dialog');
 expect(pencil.element().querySelector('.lk-pen')).not.toBeNull();
 await pencil.click();
 await expect.element(dialog()).toBeVisible();
 // The big face is pressed from the keyboard too, and the link leads to all of the Agent's settings.
 await expect.element(dialog().getByRole('button', { name: 'Press Reach’s face' })).toBeVisible();
 await expect.element(dialog().getByRole('link', { name: 'All of the Agent’s settings' })).toHaveAttribute('href', '/c/rs-learning/settings?agent=ag-owner');
 await dialog().getByRole('button', { name: 'Close' }).click();
 await expect.element(dialog()).not.toBeInTheDocument();
 await expect.element(pencil).toHaveFocus();
 const row = page.getByRole('button', { name: 'Change Reach’s look' }).last();
 await row.click();
 change.mockResolvedValueOnce(answer({ colour: 'teal' }));
 await dialog().getByRole('radio', { name: 'Teal' }).click();
 await expect.element(page.getByText('Custom · Teal · Energetic')).toBeVisible();
 // Opened in Settings, "All of the Agent's settings" closes the window onto its page.
 await dialog().getByRole('button', { name: 'All of the Agent’s settings' }).click();
 await expect.element(dialog()).not.toBeInTheDocument();
 await expect.element(row).toHaveFocus();
});

test('in Arabic the arrows walk the other way, chosen is never shown by colour alone, and on a phone it is a sheet from the bottom whose glow is not cut off', async () => {
 await page.viewport(390, 844);
 change.mockResolvedValue(answer({ shape: 'squircle' }));
 await render(<Page agent="ag-ar" language="ar"><MadeCard slug="rs-learning" agent={made('ag-ar')}/></Page>);
 await page.getByRole('button', { name: 'غيّر شكل Reach' }).click();
 const sheet = page.getByRole('dialog', { name: 'غيّر شكل Reach' });
 await expect.element(sheet).toBeVisible();
 await expect.element(sheet.getByRole('radio', { name: 'دايرة' })).toHaveFocus();
 await userEvent.keyboard('{ArrowLeft}');
 await expect.element(sheet.getByRole('radio', { name: 'مربع مدوّر' })).toBeChecked();
 const tile = sheet.getByRole('radio', { name: 'مربع مدوّر' }).element().closest('.lk-tile')!;
 await expect.poll(() => getComputedStyle(tile.querySelector('.lk-ck')!).opacity).toBe('1');
 expect(getComputedStyle(tile.querySelector('.lk-tile__t')!).fontWeight).toBe('600');
 // Once it has risen, it sits on the bottom edge, as wide as the phone.
 await expect.poll(() => { const box = sheet.element().getBoundingClientRect(); return [Math.round(box.left), Math.round(box.width), Math.round(box.bottom)]; }).toEqual([0, 390, 844]);
 expect(getComputedStyle(sheet.element()).overflow).toBe('visible');
 await expect.element(sheet.getByRole('button', { name: 'اقفل' })).toBeVisible();
 expect(sheet.getByRole('button', { name: 'اقفل' }).element().getBoundingClientRect().height).toBe(44);
});
