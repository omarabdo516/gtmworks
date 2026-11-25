import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import type { ComponentProps, ReactNode } from 'react';
import { ToastHost, toast } from '@/app/toast';
import { CardWindow } from '@/app/card-window';
import { OverlayFrame } from '@/app/settings-overlay-frame';
import { ShellIcon } from '@/components/shell-icon';
import { LanguageProvider } from '@/lib/i18n-client';
import '@/app/settings.css';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/chat', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const show = (page: ReactNode = null, language: 'en' | 'ar' = 'en') => render(<LanguageProvider language={language}>{page}<ToastHost/></LanguageProvider>);
const toasts = () => document.querySelectorAll('.toast');
const leaving = () => document.querySelectorAll('.toast.is-leaving');
// What a person sees at the toast's centre is the toast, not something drawn over it.
const onTop = () => { const box = document.querySelector('.toast')!.getBoundingClientRect(); return !!document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('.toast'); };
const reducedMotion = () => vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
const fakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
// The page's own frames are not faked: a toast's clock starts on the frame it is drawn in, so a test waits until the
// toast is on the page and two more frames have run before it moves the clock.
const frame = () => new Promise<void>(done => requestAnimationFrame(() => done()));
const drawn = async () => { for (let n = 0; n < 10 && !toasts().length; n++) await frame(); await frame(); await frame(); };

test('the area is announced politely; one toast shows at the top centre with a check, and a second replaces it with its own icon', async () => {
 const screen = await show(<i data-icons><ShellIcon name="check"/><ShellIcon name="hand"/></i>);
 const drawn = (index: number) => document.querySelectorAll('[data-icons] svg')[index].innerHTML;
 const area = screen.getByRole('status');
 await expect.element(area).toHaveAttribute('aria-live', 'polite');
 await expect.element(area).toBeEmptyDOMElement();
 toast('Moved to “Planned”');
 await expect.element(area).toHaveTextContent('Moved to “Planned”');
 expect(document.querySelector('.toast svg')!.innerHTML).toBe(drawn(0));
 await expect.poll(() => { const box = document.querySelector('.toast')!.getBoundingClientRect(); return [Math.round(box.x + box.width / 2), Math.round(box.y)]; }).toEqual([Math.round(innerWidth / 2), 72]);
 toast('It needs your OK first. Decide here and the card moves on its own', { icon: 'hand' });
 await expect.element(area).toHaveTextContent('It needs your OK first. Decide here and the card moves on its own');
 expect(toasts()).toHaveLength(1);
 expect(document.querySelector('.toast svg')!.innerHTML).toBe(drawn(1));
});

test('an Arabic line keeps a Latin name in its own direction', async () => {
 const screen = await show(null, 'ar');
 toast('اتبعت الطلب لـ Sara، وهتلاقي الرد هنا');
 await expect.element(screen.getByRole('status')).toHaveTextContent('اتبعت الطلب لـ Sara، وهتلاقي الرد هنا');
 expect([...document.querySelectorAll('.toast bdi')].map(run => [run.getAttribute('dir'), run.textContent])).toEqual([['ltr', 'Sara']]);
});

test('a toast leaves after 2.8 seconds with the 140 ms leaving step, and a new toast restarts the clock', async () => {
 fakeClock();
 await show();
 toast('Moved to “Planned”');
 await drawn();
 await vi.advanceTimersByTimeAsync(2000);
 toast('Moved to “In progress”');
 await drawn();
 await vi.advanceTimersByTimeAsync(2799);
 await expect.poll(() => toasts()[0]?.textContent).toBe('Moved to “In progress”');
 expect(leaving()).toHaveLength(0);
 await vi.advanceTimersByTimeAsync(1);
 await expect.poll(() => leaving().length).toBe(1);
 await vi.advanceTimersByTimeAsync(139);
 expect(toasts()).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(1);
 await expect.poll(() => toasts().length).toBe(0);
});

// A page that is busy drawing what an answer brought back can go seconds without a frame (#561): a toast whose clock ran
// from the call would come and go in that time, unseen. Its time starts on the frame it is first drawn in.
test('a toast’s 2.8 seconds start once it is drawn, so a page that draws nothing for longer still shows it in full', async () => {
 fakeClock();
 await show();
 toast('The rule now applies team-wide for Ads');
 // Five seconds pass in this one task, before the page can draw a frame.
 vi.advanceTimersByTime(5000);
 await drawn();
 expect([...toasts()].map(each => each.textContent)).toEqual(['The rule now applies team-wide for Ads']);
 await vi.advanceTimersByTimeAsync(2799);
 expect(toasts()).toHaveLength(1);
 expect(leaving()).toHaveLength(0);
 await vi.advanceTimersByTimeAsync(1);
 expect(leaving()).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(140);
 expect(toasts()).toHaveLength(0);
});

test('a toast with an action stays 6 seconds, then takes the same leaving step', async () => {
 fakeClock();
 await show();
 toast('Moved to “Planned”', { action: { label: 'Undo', run() {} } });
 await drawn();
 await vi.advanceTimersByTimeAsync(5999);
 await expect.poll(() => toasts().length).toBe(1);
 expect(leaving()).toHaveLength(0);
 await vi.advanceTimersByTimeAsync(1);
 await expect.poll(() => leaving().length).toBe(1);
 await vi.advanceTimersByTimeAsync(140);
 await expect.poll(() => toasts().length).toBe(0);
});

test('a toast rises in and lifts out with the reference’s motion, and the toast that replaces it rises in again', async () => {
 fakeClock();
 const started: { name: string, duration: string, easing: string, fill: string, frames: (string | number | null | undefined)[][] }[] = [];
 // Read in the same task as the DOM change that starts each animation, so neither a late frame nor a finished run loses one.
 const seen = new Set<Animation>();
 const record = new MutationObserver(() => { for (const target of document.querySelectorAll<HTMLElement>('.toast')) for (const run of target.getAnimations()) {
  if (seen.has(run)) continue;
  seen.add(run);
  const style = getComputedStyle(target);
  started.push({ name: style.animationName, duration: style.animationDuration, easing: style.animationTimingFunction, fill: style.animationFillMode, frames: (run.effect as KeyframeEffect).getKeyframes().map(frame => [frame.transform, frame.opacity]) });
 } });
 record.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
 try {
  await show();
  toast('Moved to “Planned”');
  await expect.poll(() => started.length).toBe(1);
  toast('Moved to “In progress”');
  await expect.poll(() => started.length).toBe(2);
  await drawn();
  await vi.advanceTimersByTimeAsync(2800);
  await expect.poll(() => started.length).toBe(3);
  const rise = { name: 'toastIn', duration: '0.2s', easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'none', frames: [['translate(-50%, 4px)', '0'], ['translate(-50%)', '1']] };
  expect(started).toEqual([rise, rise, { name: 'toastOut', duration: '0.14s', easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards', frames: [['translateX(-50%)', '1'], ['translate(-50%, -4px)', '0']] }]);
 } finally { record.disconnect(); }
});

test('with reduced motion a toast is removed at once, with no leaving step', async () => {
 reducedMotion();
 fakeClock();
 await show();
 let leavingSeen = false;
 const watch = new MutationObserver(() => { leavingSeen ||= leaving().length > 0; });
 watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
 toast('Moved to “Planned”');
 await drawn();
 await vi.advanceTimersByTimeAsync(2799);
 await expect.poll(() => toasts().length).toBe(1);
 await vi.advanceTimersByTimeAsync(1);
 // The clock stands still from here, so a removal that waited for the 140 ms step could not happen.
 await expect.poll(() => toasts().length).toBe(0);
 watch.disconnect();
 expect(leavingSeen).toBe(false);
});

test('the action is a button the keyboard reaches, and pressing it runs it', async () => {
 const run = vi.fn();
 const screen = await show();
 toast('Moved to “Planned”', { action: { label: 'Undo', run } });
 const undo = screen.getByRole('button', { name: 'Undo' });
 await expect.element(undo).toBeVisible();
 await userEvent.tab();
 await expect.element(undo).toHaveFocus();
 await userEvent.keyboard('{Enter}');
 expect(run).toHaveBeenCalledTimes(1);
});

test('a toast raised over the open Card window shows above it, and stays on the page after the window closes', async () => {
 const screen = await show(<div className="gw">
  <CardWindow slug="rs-learning" company="co-1" me="p-1" card={{ id: 7, title: 'Launch post', status: 'ideas', go_live: null, project_id: null, assignee: '' }} data={{ id: 7, working: false, comments: null, commentCount: 0, activity: null, activityCount: 0, runs: [], files: [], creative: null, versions: [], made: { from: 'board', by: '', at: '' } }} symbol="" canWrite={false} alone={false} columnName={column => column} assignees={{ agents: [], people: [] }} projects={[]} send={vi.fn()} save={vi.fn()} move={vi.fn()}/>
 </div>);
 await expect.element(screen.getByRole('dialog', { name: 'Launch post' })).toBeVisible();
 toast('Saved to the card');
 await expect.element(screen.getByText('Saved to the card')).toBeVisible();
 expect(onTop()).toBe(true);
 await screen.getByRole('button', { name: 'Close the card' }).click();
 await expect.poll(() => document.querySelector('dialog')!.open).toBe(false);
 await expect.element(screen.getByText('Saved to the card')).toBeVisible();
 expect(onTop()).toBe(true);
});

test('a toast already showing when the Card window opens moves above it', async () => {
 const screen = await show();
 toast('Moved to “Planned”');
 await expect.element(screen.getByText('Moved to “Planned”')).toBeVisible();
 await screen.rerender(<LanguageProvider language="en"><div className="gw">
  <CardWindow slug="rs-learning" company="co-1" me="p-1" card={{ id: 7, title: 'Launch post', status: 'ideas', go_live: null, project_id: null, assignee: '' }} data={{ id: 7, working: false, comments: null, commentCount: 0, activity: null, activityCount: 0, runs: [], files: [], creative: null, versions: [], made: { from: 'board', by: '', at: '' } }} symbol="" canWrite={false} alone={false} columnName={column => column} assignees={{ agents: [], people: [] }} projects={[]} send={vi.fn()} save={vi.fn()} move={vi.fn()}/>
 </div><ToastHost/></LanguageProvider>);
 await expect.element(screen.getByRole('dialog', { name: 'Launch post' })).toBeVisible();
 await expect.poll(onTop).toBe(true);
});

test('a toast showing in the Card window stays on the page when the window is taken away open', async () => {
 const sheet = <div className="gw">
  <CardWindow slug="rs-learning" company="co-1" me="p-1" card={{ id: 7, title: 'Launch post', status: 'ideas', go_live: null, project_id: null, assignee: '' }} data={{ id: 7, working: false, comments: null, commentCount: 0, activity: null, activityCount: 0, runs: [], files: [], creative: null, versions: [], made: { from: 'board', by: '', at: '' } }} symbol="" canWrite={false} alone={false} columnName={column => column} assignees={{ agents: [], people: [] }} projects={[]} send={vi.fn()} save={vi.fn()} move={vi.fn()}/>
 </div>;
 const screen = await show(sheet);
 await expect.element(screen.getByRole('dialog', { name: 'Launch post' })).toBeVisible();
 toast('Saved to the card');
 await expect.element(screen.getByText('Saved to the card')).toBeVisible();
 await screen.rerender(<LanguageProvider language="en">{null}<ToastHost/></LanguageProvider>);
 expect(document.querySelector('dialog')).toBeNull();
 await expect.element(screen.getByText('Saved to the card')).toBeVisible();
 expect(onTop()).toBe(true);
});

test('a toast raised while the settings overlay is open shows above it', async () => {
 const screen = await show(<OverlayFrame slug="rs-learning"><h2 id="sov-title">Settings</h2></OverlayFrame>);
 await expect.element(screen.getByRole('dialog', { name: 'Settings' })).toBeVisible();
 toast('Saved');
 await expect.element(screen.getByText('Saved')).toBeVisible();
 expect(onTop()).toBe(true);
});
