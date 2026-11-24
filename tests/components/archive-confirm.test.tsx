import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { ArchiveConfirm } from '@/app/archive-confirm';
import { LanguageProvider } from '@/lib/i18n-client';
import { LooksProvider } from '@/lib/agent-looks-client';
import type { CompanyLooks } from '@/lib/agent-looks';
import type { ArchiveStop } from '@/lib/archive-stops';
import '@/app/tokens.css';
import '@/app/shell.css';

// #702 (ADR 0027): the one archive confirmation of Cards, Conversations and channels draws each line's Agent as history
// does. A living Agent and a removed one wear their own look, the removed one the look kept beside its name; a record
// that names no Agent, only the name it keeps, shows that name's first letter; an Agent hidden from the reader none.
const looks: CompanyLooks = { agents: { ads: { shape: 'blob', colour: 'rose', temperament: 'warm' }, gone: { shape: 'squircle', colour: 'jade', temperament: 'neat' } }, requests: {}, removed: { gone: 'Old Writer' } };
const stops: ArchiveStop[] = [
 { about: 'x', kind: 'run', title: 'Launch', agent: 'Ads', agent_id: 'ads' },
 { about: 'x', kind: 'question', title: 'Launch', agent: 'Old Writer', agent_id: 'gone' },
 { about: 'x', kind: 'hand', title: 'Launch', agent: 'Sami', agent_id: null },
 { about: 'x', kind: 'permission', title: 'Launch', agent: null, agent_id: null },
];

test('each line of the confirmation shows its Agent as history does: its look, a removed one\'s kept look, a kept name\'s letter, or none', async () => {
 await render(<LanguageProvider language="en"><LooksProvider looks={looks}>
  <ArchiveConfirm stops={stops} heading="Archive it?" confirm={() => {}} cancel={() => {}}/>
 </LooksProvider></LanguageProvider>);
 const faces = () => [...document.querySelectorAll('.cf-face')];
 await expect.poll(() => faces().length).toBe(4);
 const [living, removed, named, hidden] = faces();
 expect(living.querySelector<HTMLElement>('.face')?.dataset).toMatchObject({ agent: 'ads', shape: 'blob', colour: 'rose' });
 expect(removed.querySelector<HTMLElement>('.face')?.dataset).toMatchObject({ agent: 'gone', shape: 'squircle', colour: 'jade' });
 expect(named.querySelector('.face')).toBeNull();
 expect(named.querySelector('.avatar')?.textContent).toBe('S');
 expect(hidden.querySelector('.face, .avatar')).toBeNull();
 expect(hidden.querySelector('.cf-mark')).not.toBeNull();
});
