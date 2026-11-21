import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import type { ComponentProps } from 'react';
import { OverlayChrome } from '@/app/settings-overlay-chrome';
import { BackupSection } from '@/app/settings-backup';
import { LanguageProvider } from '@/lib/i18n-client';
import { i18n, type Language } from '@/lib/i18n.mjs';
import { pickSection } from '@/lib/settings-overlay.mjs';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

// #33: Settings › Backup is read-only. It says what a backup holds and leaves out, and shows the commands; only the
// copy button does anything. The server decides the Owner-only rule (pickSection, tested in tests/settings-overlay).
const writeText = vi.fn<(text: string) => Promise<void>>();
beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => { writeText.mockReset(); });

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/link', () => ({ default: (props: ComponentProps<'a'> & { replace?: boolean }) => <a {...Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'replace'))}/> }));

const backup = (language: Language = 'en') => render(<LanguageProvider language={language}>
  <BackupSection t={i18n(language).t}/>
</LanguageProvider>);

// The overlay as the server draws it for this Role: the section the request opens, and its navigation.
const overlay = (role: string) => {
  const section = pickSection('backup', role);
  return render(<LanguageProvider language="en">
    <OverlayChrome t={i18n('en').t} slug="rs-learning" companyName="RS Learning" role={role} readOnly={role !== 'owner'} section={section} learningWaiting={0}>
      {section === 'backup' ? <BackupSection t={i18n('en').t}/> : <p>{section}</p>}
    </OverlayChrome>
  </LanguageProvider>);
};

test('the Owner sees Backup in Settings; no other Role does, and the server opens another section for them', async () => {
  const owner = await overlay('owner');
  await expect.element(owner.getByRole('link', { name: 'Backups' })).toBeVisible();
  await expect.element(owner.getByRole('heading', { name: 'What a backup holds' })).toBeVisible();
  await owner.unmount();

  for (const role of ['manager', 'contributor', 'viewer']) {
    expect(pickSection('backup', role)).not.toBe('backup');
    const screen = await overlay(role);
    expect(screen.getByRole('link', { name: 'Backups' }).elements()).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'What a backup holds' }).elements()).toHaveLength(0);
    await screen.unmount();
  }
});

test('the section says what a backup holds, what it leaves out, and the four commands', async () => {
  const screen = await backup();
  await expect.element(screen.getByRole('heading', { name: 'What a backup holds' })).toBeVisible();
  for (const text of [
    'Included', 'Not included',
    'The database', 'File storage', "The install's keys", '.env.install', "Every Company's Engine",
    "Every Company's work folder",
    "The model provider's account and keys outside the install", "The connected apps' own data", 'The Docker images',
    'The tool caches in a work folder',
    'Take a backup', 'gtmworks backup',
    'Restore a backup', 'gtmworks restore <archive>',
    'A restore goes into an empty install only.',
    'From a source checkout', 'sh scripts/install.sh backup', 'sh scripts/install.sh restore <archive>',
  ]) await expect.element(screen.getByText(text, { exact: true })).toBeVisible();
});

test('every command copies on one press, and copy is the only button in the section', async () => {
  const screen = await backup();
  const buttons = screen.getByRole('button').elements();
  expect(buttons).toHaveLength(4);
  expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
    'Copy the command gtmworks backup',
    'Copy the command gtmworks restore <archive>',
    'Copy the command sh scripts/install.sh backup',
    'Copy the command sh scripts/install.sh restore <archive>',
  ]);

  const first = screen.getByRole('button', { name: 'Copy the command gtmworks backup' });
  await first.click();
  expect(writeText).toHaveBeenCalledExactlyOnceWith('gtmworks backup');
  await expect.element(first).toHaveTextContent('Copied');

  const last = screen.getByRole('button', { name: 'Copy the command sh scripts/install.sh restore <archive>' });
  await last.click();
  expect(writeText).toHaveBeenLastCalledWith('sh scripts/install.sh restore <archive>');
});

test('the section speaks Egyptian Arabic as the reference does', async () => {
  const screen = await backup('ar');
  await expect.element(screen.getByRole('heading', { name: 'النسخة فيها إيه' })).toBeVisible();
  for (const text of ['فيها', 'مش فيها', 'قاعدة البيانات', 'مفاتيح التنصيبة', 'محرّك كل شركة']) {
    await expect.element(screen.getByText(text, { exact: true })).toBeVisible();
  }
  expect(screen.getByRole('button').elements()).toHaveLength(4);
});
