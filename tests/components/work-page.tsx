import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { onTestFinished, vi } from 'vitest';
import Work, { type AddIdeaAction, type PlaceCard, type UndoMove, type WorkAction, type WorkProps } from '@/app/c/[slug]/[[...section]]/work';
import { Frame, PageFrame } from '@/app/frame';
import { LanguageProvider } from '@/lib/i18n-client';
import { LooksProvider } from '@/lib/agent-looks-client';
import type { CompanyLooks } from '@/lib/agent-looks';
import type { Language } from '@/lib/i18n.mjs';
import '@/app/globals.css';
import '@/app/tokens.css';
import '@/app/shell.css';

// The Work pages (the board, the List, the Calendar, a Card and Work settings) as the app draws them inside the shell's
// frame, with the stylesheets the app loads. A test file mocks next/navigation, @/lib/link and the other server actions;
// the board's own action is a spy each page is given, and `sent` reads the forms it received.
type Card = WorkProps['cards'][number];
const stages = [
 { id: 1, name: 'أفكار', position: 1, board_column: 'ideas' },
 { id: 2, name: 'بريف جاهز', position: 2, board_column: 'planned' },
 { id: 3, name: 'كتابة', position: 3, board_column: 'progress' },
 { id: 4, name: 'مراجعة', position: 4, board_column: 'waiting' },
];
export const card = (more: Partial<Card> = {}): Card => ({ id: 1, title: 'أفكار لمحتوى الشهر', stage_id: 1, channel: 'Instagram', format: '', go_live: '2026-06-04T12:00:00+00:00',
 offering: '', segment: '', hook: '', goal: '', caption: '', next_actor: null, mode: null, approval_step_id: null, rejection_reason: null, project_id: null, ...more });
export const workProps = (more: Partial<WorkProps> = {}): WorkProps => ({
 workAction: vi.fn<WorkAction>(async () => {}), placeMove: vi.fn<PlaceCard>(async () => ({ ok: true })), addIdea: vi.fn<AddIdeaAction>(async () => ({ card: 9 })), undoMove: vi.fn<UndoMove>(async () => ({ state: 'refused' })), me: 'p-1', slug: 'rs-learning', company: 'co-1', section: 'work/board', stages, labels: [{ id: 1, name: 'static', color: '#87bba2' }],
 cards: [card()], items: [{ id: 1, card_id: 1, title: 'Script Ready', done: false }], members: [{ person_id: 'p-1', people: { name: 'عمر' } }],
 activity: [], creatives: [], versions: [], cardLabels: [], projects: [], assignees: [], approvableIds: [],
 canCreate: true, attachments: [], ...more,
});
export const sent = (props: WorkProps) => vi.mocked(props.workAction).mock.calls.map(([form]) => Object.fromEntries(form));
// The ideas the Ideas column sent (#188, #452), each with its request key.
export const ideasSent = (props: WorkProps) => vi.mocked(props.addIdea).mock.calls.map(([form]) => Object.fromEntries(form));
// What the board asked the server to place, read as the form it sent (#174).
export const placed = (props: WorkProps) => vi.mocked(props.placeMove).mock.calls.map(([form]) => Object.fromEntries(form));

// As app/layout.tsx sets the page's language and direction.
export async function showWork(props: WorkProps, { language = 'en', width = 1440, looks }: { language?: Language, width?: number, looks?: CompanyLooks } = {}) {
 const { lang, dir } = document.documentElement;
 Object.assign(document.documentElement, { lang: language, dir: language === 'ar' ? 'rtl' : 'ltr' });
 onTestFinished(() => { Object.assign(document.documentElement, { lang, dir }); });
 await page.viewport(width, 900);
 return render(looks ? <LooksProvider looks={looks}>{workView(props, language)}</LooksProvider> : workView(props, language));
}
export const workView = (props: WorkProps, language: Language = 'en') => <LanguageProvider language={language}><Frame sidebar={null}><PageFrame title="Work"><main className="content"><Work {...props}/></main></PageFrame></Frame></LanguageProvider>;
