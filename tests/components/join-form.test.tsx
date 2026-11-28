import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import JoinForm from '@/app/join/form';
import { LanguageProvider } from '@/lib/i18n-client';
import type { Language } from '@/lib/i18n.mjs';
import '@/app/tokens.css';
import '@/app/shell.css';
import '@/app/settings.css';

// #950, #952: the link's page offers making an account and, for a Person who has one, signing in. A failed signed-in join
// comes back in sign-in mode, so its error sits under the sign-in form and never under the new-account one.
const secret='a'.repeat(64);
const open=()=>vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ company: 'RS Learning', role: 'viewer', member: false }) })));
afterEach(() => { window.location.hash=''; vi.unstubAllGlobals(); });
const show = (language: Language = 'en', props: { invalid?: 'couldNotSignIn', signIn?: boolean } = {}) =>
 render(<LanguageProvider language={language}><JoinForm {...props}/></LanguageProvider>);

test('a failed signed-in join comes back on the sign-in form, with its error and no new-account form', async () => {
 open();
 window.location.hash=`#code=${secret}`;
 const screen=await show('en',{invalid:'couldNotSignIn',signIn:true});
 await expect.element(screen.getByText('You’re joining RS Learning as Viewer.')).toBeVisible();
 await expect.element(screen.getByText('Could not sign in.')).toBeVisible();
 await expect.element(screen.getByRole('button',{name:'Sign in and join'})).toBeVisible();
 await expect.element(screen.getByLabelText('Your name')).not.toBeInTheDocument();
});

test('the page opens on making an account, and choosing the account you have swaps to sign-in and back', async () => {
 open();
 window.location.hash=`#code=${secret}`;
 const screen=await show();
 await expect.element(screen.getByText('You’re joining RS Learning as Viewer.')).toBeVisible();
 await expect.element(screen.getByLabelText('Your name')).toBeVisible();
 await expect.element(screen.getByRole('button',{name:'Sign in and join'})).not.toBeInTheDocument();
 await screen.getByRole('button',{name:'I already have an account'}).click();
 await expect.element(screen.getByRole('button',{name:'Sign in and join'})).toBeVisible();
 await expect.element(screen.getByLabelText('Your name')).not.toBeInTheDocument();
 await userEvent.click(screen.getByRole('button',{name:'Make a new account'}));
 await expect.element(screen.getByLabelText('Your name')).toBeVisible();
});
