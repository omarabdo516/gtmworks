import { expect, test, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render } from 'vitest-browser-react';
import { HandBanner } from '@/app/agent-screen';
import { LanguageProvider } from '@/lib/i18n-client';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/c/rs/home', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props}/> }));

// #714: the banner of a step handed over on the Agent's Screen, in its large view (design-reference: renderViewer's
// banner, .vw-hand): the "Handed to you" badge, the step's title, one line that the Agent stopped there, and "Done it".
// While the person holds control the line says to press the step on the Screen themselves, then "Done it".
const words = {
 en: { badge: 'Handed to you', done: 'Done it',
  stopped: 'Ads stopped at “Publish the campaign” and didn’t press it. Press it yourself in Meta Ads or take control, then “Done it”.',
  control: 'You have control: press “Publish the campaign” on the screen yourself, then “Done it”.' },
 ar: { badge: 'اتسلّمتلك', done: 'عملتها',
  stopped: 'Ads وقف عند «Publish the campaign» ومداسش عليه. دوسها بنفسك من Meta Ads أو خد الدفة، وبعدها «عملتها».',
  control: 'الدفة معاك: دوس «Publish the campaign» على الشاشة بنفسك، وبعدها «عملتها».' },
};
const hand = { card: 7, conversation: 'cv-1', title: 'Publish the campaign', app: 'Meta Ads' };

test.each(['en', 'ar'] as const)('in the %s interface, the banner says the Agent stopped at the step, and while the person holds control to press it themselves, with Done it in both', async language => {
 const done = vi.fn();
 const screen = await render(<LanguageProvider language={language}><div className="gw" dir={language === 'ar' ? 'rtl' : 'ltr'}>
  <div data-testid="watching"><HandBanner hand={hand} agent="Ads" control={false} busy={false} onDone={done}/></div>
  <div data-testid="holding"><HandBanner hand={hand} agent="Ads" control busy={false} onDone={done}/></div></div></LanguageProvider>);
 for (const [state, line] of [['watching', words[language].stopped], ['holding', words[language].control]] as const) {
  const banner = screen.getByTestId(state).getByRole('group');
  await expect.element(banner).toBeVisible();
  expect(banner.element().querySelector('.badge.ck-badge')?.textContent).toBe(words[language].badge);
  expect(banner.element().querySelector('.vw-hand__t > b')?.textContent).toBe(hand.title);
  expect(banner.element().querySelector('.vw-hand__t > span')?.textContent, state).toBe(line);
  await banner.getByRole('button', { name: words[language].done }).click();
 }
 expect(done).toHaveBeenCalledTimes(2);
});

test('a press on its way holds Done it, so one press sends one', async () => {
 const done = vi.fn();
 const screen = await render(<LanguageProvider language="en"><HandBanner hand={hand} agent="Ads" control={false} busy onDone={done}/></LanguageProvider>);
 await expect.element(screen.getByRole('button', { name: 'Done it' })).toBeDisabled();
});
