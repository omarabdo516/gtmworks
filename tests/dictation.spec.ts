import { test, expect, freshSeed } from './fresh-seed';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { laneHermes } from './lane-hermes';
import { signIn } from './sign-in';

// #160: voice dictation. The browser records with the microphone, the route sends that one recording to the Engine for
// the Agent's own profile, and the words land in the composer. A Contributor may dictate only for an Agent they see in
// their own Company: a hidden Agent and another Company are not found. The component tests cover hold, click, Escape,
// the cross, 60 seconds, send and reduced motion; this drives the real browser microphone (a fake device) once.
test.use({ permissions: ['microphone'], launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

const query = (sql: string) => execFileSync('npx', ['--no-install', 'supabase', 'db', 'query', sql, '-o', 'json', '--agent', 'no'], { encoding: 'utf8' });
const company = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';

let fake: Awaited<ReturnType<typeof laneHermes>>;
test.beforeAll(async ({}, testInfo) => {
 freshSeed(testInfo.file);
 fake = await laneHermes();
 fake.settings.transcriptionTranscript = 'Draft the launch note';
 query(`delete from public.hermes_agents where company_id='${company}' and name='Hidden writer'`);
 query(`insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile)
  values ('${randomUUID()}','${company}','${randomUUID()}','Hidden writer','Writes where nobody sees.',false,'dictation-hidden')`);
});
test.afterAll(async () => { await fake?.close(); });

test('a Member holds the microphone and the Engine\'s words land in the composer', async ({ page }) => {
 await signIn(page, 'omar@example.com', '/c/rs-learning/chat');
 const box = page.getByRole('textbox', { name: 'Message' });
 await box.fill('Plan:');
 const mic = page.locator('.composer__mic');
 const at = (await mic.boundingBox())!;
 await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
 await page.mouse.down();
 await expect(page.locator('.composer.is-rec')).toBeVisible();
 await expect(page.locator('.wave__bar')).toHaveCount(28);
 await expect(page.locator('.composer__rec')).toContainText('0:0');
 await page.waitForTimeout(600);
 await expect(page.getByRole('button', { name: 'Finish recording' })).toHaveAttribute('aria-pressed', 'true');
 await page.mouse.up();
 await expect(box).toHaveValue('Plan: Draft the launch note');
 await expect(box).toBeFocused();
 expect(fake.settings.transcriptions.length).toBeGreaterThan(0);
});

test('a Contributor cannot transcribe for a hidden Agent or in another Company', async ({ page }) => {
 await signIn(page, 'reviewer@example.com', '/c/rs-learning/chat');
 const hidden = query(`select id from public.hermes_agents where company_id='${company}' and name='Hidden writer'`).trim();
 const hiddenId = (JSON.parse(hidden || '[]') as { id: string }[])[0]?.id;
 expect(hiddenId).toBeTruthy();
 const audio = { dataUrl: 'data:audio/webm;base64,dm9pY2U=', mimeType: 'audio/webm' };
 const hiddenAnswer = await page.request.post('/api/dictation', { data: { company, agent: hiddenId, ...audio } });
 expect(hiddenAnswer.status()).toBe(404);
 const otherAnswer = await page.request.post('/api/dictation', { data: { company: other, agent: hiddenId, ...audio } });
 expect(otherAnswer.status()).toBe(404);
 // The language read follows the same rule.
 expect((await page.request.get(`/api/dictation?company=${company}&agent=${hiddenId}`)).status()).toBe(404);
 expect((await page.request.get(`/api/dictation?company=${other}&agent=${hiddenId}`)).status()).toBe(404);
});
