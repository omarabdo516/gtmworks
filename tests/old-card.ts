import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';

// #836: New card makes its Cards on the Company's Engine (spec #831). A spec that tests what the old tables still serve
// until the spec replaces each (a Card's own page with its comments, approvals and design versions, the board opened on
// Waiting on you, the list and the calendar: #835–#846) makes its old Card here, in RS Learning's Ideas, and opens the
// Card's page, where the old New card used to leave it. The next file starts from the seed again (tests/fresh-seed.ts).
export async function oldCard(page: Page, title: string) {
 // Supabase CLI targets the local test database by default; never pass --remote.
 const out = JSON.parse(execFileSync('npx', ['--no-install', 'supabase', 'db', 'query', `insert into public.work_cards(company_id,stage_id,title)
  select s.company_id,s.id,'${title.replaceAll("'", "''")}' from public.work_stages s where s.company_id='10000000-0000-0000-0000-000000000001' and s.name='أفكار' returning id`,
 '-o', 'json', '--agent', 'no'], { encoding: 'utf8' }));
 const id = Number((Array.isArray(out) ? out : out.rows)[0].id);
 const path = `/c/rs-learning/work/board/${id}`;
 await page.goto(path);
 return { id, path, title };
}
