import { readFileSync } from 'node:fs';
import { testDb } from './pgtap.mjs';

// #676 replays the first step of the Card status (ADR 0023) on the Card table as the previous release left it: Cards in
// every stage, one in review on its approval step, one approved, one tied to a chat, one of a channel and one of a hidden
// Agent, and a move remembered by stages only. Each Card takes its stage's column as its status, the remembered move is
// put back by either release's Undo, and the previous release's writes keep working on the new table.
const migration = readFileSync('supabase/migrations/20270417000000_card_status.sql', 'utf8');
const verify = readFileSync('supabase/migrations/20270417000000_card_status.verify.sql', 'utf8').trim().replace(/;$/, '');
const rs = "'10000000-0000-0000-0000-000000000001'";
const sql = `begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
-- The table as the previous release had it: nothing of this migration exists yet.
drop trigger align_card_status on public.work_cards;
drop function public.align_card_status();
drop function public.card_status_stage(uuid,text,bigint);
drop function public.undo_card_move(uuid,bigint);
drop function public.move_card(uuid,bigint,text,bigint,text);
drop function public.check_card_move(uuid,bigint,text);
create or replace function public.work_card_moved() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.stage_id is distinct from old.stage_id and coalesce(current_setting('work.undo',true),'')<>'yes'
  and coalesce(current_setting('approval.internal',true),'')<>'yes' then
  insert into public.work_card_moves(company_id,card_id,person_id,from_stage_id,from_place,to_stage_id,to_place)
   values(new.company_id,new.id,auth.uid(),old.stage_id,old.board_order,new.stage_id,new.board_order);
 end if;
 return null;
end $$;
alter table public.work_card_moves drop column from_status, drop column to_status;
alter table public.work_cards drop column status;
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name='status')
 and to_regprocedure('public.move_card(uuid,bigint,text,bigint,text)') is null,'the table and the functions are the previous release''s');
-- A Card in each stage, as the previous release makes them; the two after review and the one in review as an approval
-- and a review leave them.
insert into public.work_cards(company_id,stage_id,title) select ${rs},s.id,'Shape '||s.name from public.work_stages s where s.company_id=${rs} and s.kind in ('ideas','before_review');
select set_config('approval.internal','yes',true);
insert into public.work_cards(company_id,stage_id,title) select ${rs},s.id,'Shape '||s.name from public.work_stages s where s.company_id=${rs} and s.kind='after_review';
select set_config('approval.internal','',true);
insert into public.work_cards(company_id,stage_id,title) select ${rs},s.id,'Shape review' from public.work_stages s where s.company_id=${rs} and s.kind='review';
-- A Card of a hidden Agent, one tied to a chat.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile)
 values ('a0000000-0000-0000-0000-000000006760',${rs},'c0000000-0000-0000-0000-000000006760','Shape Ads','Runs the Meta ads.',false,'shape-ads');
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values ('e0000000-0000-0000-0000-000000006760',${rs},'20000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000006760','Shape Ads');
insert into public.work_cards(company_id,stage_id,title,agent_id,conversation_id) select ${rs},s.id,'Shape hidden chat','a0000000-0000-0000-0000-000000006760','e0000000-0000-0000-0000-000000006760'
 from public.work_stages s where s.company_id=${rs} and s.name='تصميم ومونتاج';
-- A move the previous release remembered by stages only.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select public.place_work_card(${rs},(select id from public.work_cards where title='Shape كتابة'),'planned',null);
reset role;

${migration}

select is((select count(*)::int from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.status is distinct from s.board_column),0,'every Card''s status is its stage''s column');
select is((select status from public.work_cards where title='Shape review'),'waiting','a Card in review is Waiting on you');
select is((select status from public.work_cards where title='Shape معتمد'),'planned','an approved Card is Planned');
select is((select status from public.work_cards where title='Shape منشور'),'live','a published Card is Live');
select is((select status from public.work_cards where title='Shape خلص'),'done','a finished Card is Done');
select is((select status from public.work_cards where title='Shape hidden chat'),'progress','a Card of a hidden Agent''s chat keeps its column');
select is((select count(*)::int from public.work_card_moves m where m.card_id=(select id from public.work_cards where title='Shape كتابة') and m.from_status='progress' and m.to_status='planned'),1,'the remembered move gets both statuses');

-- This release puts back the previous release's move; the previous release's Undo puts back this release's.
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(public.undo_card_move(${rs},(select id from public.work_cards where title='Shape كتابة')),'progress','this release''s Undo puts the previous release''s move back');
select is((select s.name from public.work_cards w join public.work_stages s on s.id=w.stage_id where w.title='Shape كتابة'),'كتابة','to the stage it left');
select public.move_card(${rs},(select id from public.work_cards where title='Shape بريف جاهز'),'progress');
select is(public.undo_work_card_move(${rs},(select id from public.work_cards where title='Shape بريف جاهز')),'planned','the previous release''s Undo puts this release''s move back');
-- The previous release's writes run as before: a Card made by its stage, a move by stage, and the stage select.
select lives_ok($$insert into public.work_cards(company_id,stage_id,title) select ${rs},s.id,'Shape from the old app' from public.work_stages s where s.company_id=${rs} and s.name='أفكار'$$,'the previous release makes a Card by its stage');
select is((select status from public.work_cards where title='Shape from the old app'),'ideas','and it has a status');
select lives_ok($$select public.move_work_card_to_column(${rs},(select id from public.work_cards where title='Shape from the old app'),'progress')$$,'the previous release moves a Card by column');
select is((select status from public.work_cards where title='Shape from the old app'),'progress','and the status follows');
reset role;
select is((select string_agg(key||'='||value,',' order by key) from (${verify}) v, json_each_text(v.json_build_object) where value not in ('true')),null,'every verify check passes after the migration');
select * from finish();
rollback;
`;
testDb(import.meta.url, sql);
