import { test, expect } from './fresh-seed';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { routeAllowed } from '../lib/route-permissions.mjs';
import { signIn } from './sign-in';
import noteEn from '../lib/messages/member-note.en.json' with { type: 'json' };
import noteAr from '../lib/messages/member-note.ar.json' with { type: 'json' };

// Team-work rules of 2026-11-13 on the local database: a Member's note is their own, and a role lowered between two
// requests refuses the second. Who a Conversation's message is from, whom it reaches and whose note goes with its Run are
// its Engine Run's since #883 (tests/conversation-send.spec.ts).
const query=(sql:string)=>execFileSync('npx',['--no-install','supabase','db','query',sql,'-o','json','--agent','no'],{encoding:'utf8'});
const status=()=>{ const env=execFileSync('npx',['--no-install','supabase','status','-o','env'],{encoding:'utf8'}); return (name:string)=>env.match(new RegExp(`^${name}="(.*)"$`,'m'))![1]; };
const company='10000000-0000-0000-0000-000000000001';
const omar='20000000-0000-0000-0000-000000000001';
const contributor='20000000-0000-0000-0000-000000000005';

// A Member's own session, signed in by email link, and the service client the route and the worker use.
async function memberClient(email:string) {
 const value=status();
 const service=createClient(value('API_URL'),value('SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const person=createClient(value('API_URL'),value('ANON_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:link,error:linked}=await service.auth.admin.generateLink({type:'magiclink',email});
 expect(linked).toBeNull();
 expect((await person.auth.verifyOtp({type:'email',token_hash:link.properties!.hashed_token})).error).toBeNull();
 return {service,person};
}

test.describe.configure({mode:'serial'});

test('integration: a Member\'s note is their own: nobody else reads it, and a secret or an over-long note is refused',async()=>{
 test.setTimeout(120000);
 const a=await memberClient('omar@example.com'); const b=await memberClient('multi@example.com');
 try {
  expect((await a.person.rpc('save_member_note',{c:company,note:'Answer in short points.'})).error).toBeNull();
  expect((await b.person.rpc('save_member_note',{c:company,note:'Write in Egyptian Arabic.'})).error).toBeNull();
  expect((await b.person.rpc('save_member_note',{c:company,note:'my api key: sk-abcdefghijklmnopqrstuvwx'})).error?.message).toBe('memberNoteSecret');
  expect((await b.person.rpc('save_member_note',{c:company,note:'x'.repeat(4001)})).error?.message).toBe('memberNoteTooLong');
  // Another Member reads no one else's note.
  expect((await b.person.from('member_notes').select('person_id,note')).data).toEqual([{person_id:contributor,note:'Write in Egyptian Arabic.'}]);
  expect((await a.person.from('member_notes').select('person_id,note').eq('company_id',company)).data).toEqual([{person_id:omar,note:'Answer in short points.'}]);
 } finally { query(`delete from public.member_notes where company_id='${company}'`); }
});

test('integration: a role lowered between two requests refuses the second one',async({page})=>{
 test.setTimeout(120000);
 try {
  // The guard reads the role from the database each time.
  const {person}=await memberClient('multi@example.com');
  expect(await routeAllowed(person,'app/api/conversations/route.ts','POST',company)).toBe(true);
  query(`update public.members set role='viewer' where company_id='${company}' and person_id='${contributor}'`);
  expect(await routeAllowed(person,'app/api/conversations/route.ts','POST',company)).toBe(false);
  query(`update public.members set role='contributor' where company_id='${company}' and person_id='${contributor}'`);
  // And so does the route itself, with the same browser session for both requests.
  await signIn(page,'multi@example.com','/c/rs-learning/home');
  const stop=()=>page.request.post('/api/conversations',{data:{company,conversation:randomUUID(),intent:'stop',run:'run_unknown'}});
  const first=await stop();
  expect(first.status()).toBe(404);
  query(`update public.members set role='viewer' where company_id='${company}' and person_id='${contributor}'`);
  const second=await stop();
  expect(second.status()).toBe(403);
  expect(await second.json()).toEqual({error:'conversationNotAllowed'});
 } finally { query(`update public.members set role='contributor' where company_id='${company}' and person_id='${contributor}'`); }
});

test('integration: the note form refuses a secret before sending it, and saves a note in the person\'s language',async({page})=>{
 test.setTimeout(120000);
 try {
  await signIn(page,'omar@example.com','/c/rs-learning/home');
  await page.goto('/c/rs-learning/settings?section=account');
  const text=(await page.locator('html').getAttribute('lang'))==='ar'?noteAr:noteEn;
  const note=page.getByRole('textbox',{name:text.memberNote});
  const save=page.getByRole('button',{name:text.memberNoteSave});
  await note.fill('my api key: sk-abcdefghijklmnopqrstuvwx');
  await expect(page.locator('#ac-note-status[role=alert]')).toHaveText(text.memberNoteSecret);
  await expect(save).toBeDisabled();
  expect(JSON.parse(query(`select count(*)::int as n from public.member_notes where company_id='${company}' and person_id='${omar}'`))).toEqual([{n:0}]);
  await note.fill('Answer in short points.');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.locator('#ac-note-status')).toHaveText(text.memberNoteSaved);
  expect(JSON.parse(query(`select note from public.member_notes where company_id='${company}' and person_id='${omar}'`))).toEqual([{note:'Answer in short points.'}]);
 } finally { query(`delete from public.member_notes where company_id='${company}'`); }
});
