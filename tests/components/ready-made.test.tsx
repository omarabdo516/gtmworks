import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import ReadyMade from '@/app/ready-made';
import { LanguageProvider } from '@/lib/i18n-client';
import { readyRoles } from '@/lib/ready-roles';

const replace = vi.fn<(href: string) => void>();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }));

let answer: (response: Response) => void = () => {};
const sent = vi.fn<(body: { conversation: string, message: string }) => void>();
afterEach(() => { replace.mockReset(); sent.mockReset(); vi.unstubAllGlobals(); });
const gallery = async () => {
 vi.stubGlobal('fetch', (_: string, init: RequestInit) => { sent(JSON.parse(String(init.body))); return new Promise<Response>(resolve => { answer = resolve; }); });
 return render(<LanguageProvider language="en"><ReadyMade slug="rs-learning" company="c-1" agent="lead-1" companyName="RS Learning" alone={false} lead="Lead" roles={readyRoles('en', false)}/></LanguageProvider>);
};

test('Add it asks Lead for the role and opens the Conversation once the message is sent', async () => {
 const screen = await gallery();
 await screen.getByRole('button', { name: 'Add SEO content writer' }).click();
 await expect.poll(() => sent.mock.calls.length).toBe(1);
 answer(new Response('{}', { status: 200 }));
 await expect.poll(() => replace.mock.calls.length).toBe(1);
 expect(replace.mock.calls[0][0]).toBe(`/c/rs-learning/conversations/${sent.mock.calls[0][0].conversation}`);
});

test('a send still on its way when the gallery closes does not move the page that took its place', async () => {
 const screen = await gallery();
 await screen.getByRole('button', { name: 'Add SEO content writer' }).click();
 await expect.poll(() => sent.mock.calls.length).toBe(1);
 await userEvent.keyboard('{Escape}');
 await expect.poll(() => replace.mock.calls.length).toBe(1);
 answer(new Response('{}', { status: 200 }));
 await new Promise(resolve => setTimeout(resolve, 100));
 expect(replace.mock.calls.map(([href]) => href)).toEqual(['/c/rs-learning/chat?new=agent']);
});
