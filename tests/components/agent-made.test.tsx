import { afterEach, expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { AgentMadeToast } from '@/app/agent-made';
import { ToastHost } from '@/app/toast';
import { LanguageProvider } from '@/lib/i18n-client';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/c/rs-learning/conversations/c-1' }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));

// #169: the page asks the server whether this Agent's toast is still due. A true answer marks the record, so it is the
// only toast that Agent will raise; an answer that arrives after the effect was cleaned up still raises it, as React's
// development double effect cleans the first effect between its two asks.
type Reply = (response: { ok: boolean, json: () => Promise<{ shown?: boolean }> }) => void;
const answers: Reply[] = [];
const holdFetch = () => { answers.length = 0; vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { answers.push(resolve as Reply); }))); };
const asked = (agent: { id: string, name: string }) => <LanguageProvider language="en"><AgentMadeToast company="co-1" slug="rs-learning" agent={agent}/></LanguageProvider>;
afterEach(() => { vi.unstubAllGlobals(); push.mockReset(); answers.length = 0; });

test('an answer that says the toast is due raises it even when it arrives after the effect was cleaned up, and a later ask adds no second one', async () => {
 holdFetch();
 await render(<LanguageProvider language="en"><ToastHost/></LanguageProvider>);
 const first = await render(asked({ id: 'a-1', name: 'Meta Ads' }));
 await expect.poll(() => answers.length).toBe(1);
 // The first effect is cleaned up before its answer arrives: the record is already marked shown with this answer.
 await first.unmount();
 answers[0]({ ok: true, json: async () => ({ shown: true }) });
 await expect.poll(() => document.querySelector('.toast')?.textContent).toContain('Meta Ads was made and shows in your agents');
 // The second ask, as a reload's, is answered false and raises nothing more.
 const second = await render(asked({ id: 'a-1', name: 'Meta Ads' }));
 await expect.poll(() => answers.length).toBe(2);
 answers[1]({ ok: true, json: async () => ({ shown: false }) });
 await new Promise(resolve => setTimeout(resolve, 50));
 expect(document.querySelectorAll('.toast')).toHaveLength(1);
 expect(document.querySelector('.toast')!.textContent).toContain('Meta Ads was made and shows in your agents');
 expect(push).not.toHaveBeenCalled();
 await second.unmount();
});
