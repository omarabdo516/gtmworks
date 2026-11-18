import { readFileSync } from 'node:fs';
import { testDb } from './pgtap.mjs';

// #174 replays its migration on the Card table as the previous app version left it: no place, and Cards the board drew
// in stage order. The migration keeps the order the board showed, a Card the old version makes without a place takes the
// end of its column, and its reads and moves then run as before.
const migration = readFileSync('supabase/migrations/20270215000000_card_places.sql', 'utf8');
const verify = readFileSync('supabase/migrations/20270215000000_card_places.verify.sql', 'utf8').trim().replace(/;$/, '');
const sql = `begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
-- The table as the previous version had it: nothing of this migration exists yet.
drop trigger work_card_place on public.work_cards;
drop function public.work_card_place();
drop function public.place_work_card(uuid,bigint,text,bigint,text);
alter table public.work_cards drop column board_order;
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_cards' and column_name='board_order')
 and to_regprocedure('public.place_work_card(uuid,bigint,text,bigint,text)') is null,'the table and the functions are the previous version''s');
-- Cards as the board drew them today: two more in «كتابة» after the seeded one, and one in «أفكار».
insert into public.work_cards(company_id,stage_id,title) select '10000000-0000-0000-0000-000000000001',s.id,'Legacy '||n
 from public.work_stages s, generate_series(1,2) n where s.company_id='10000000-0000-0000-0000-000000000001' and s.name='كتابة';
insert into public.work_cards(company_id,stage_id,title) select '10000000-0000-0000-0000-000000000001',s.id,'Legacy idea'
 from public.work_stages s where s.company_id='10000000-0000-0000-0000-000000000001' and s.name='أفكار';
${migration}
select is((select count(*)::int from public.work_cards where board_order is null),0,'every card has a place after the migration');
-- The order the board showed: each column by its stages' positions, the older Card first inside one stage.
select is((select count(*)::int from (
 select w.id, row_number() over (partition by w.company_id,s.board_column order by s.position,w.id) as expected, w.board_order as got
 from public.work_cards w join public.work_stages s on s.company_id=w.company_id and s.id=w.stage_id) x where x.got<>x.expected),0,'the order the board showed today is kept');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
set local role authenticated;
-- A Card the previous app version makes without a place takes the end of its column, and it is read back as before.
insert into public.work_cards(company_id,stage_id,title) select '10000000-0000-0000-0000-000000000001',s.id,'From the old app'
 from public.work_stages s where s.company_id='10000000-0000-0000-0000-000000000001' and s.name='كتابة';
select is((select count(*)::int from public.work_cards o join public.work_stages s on s.company_id=o.company_id and s.id=o.stage_id
 where o.company_id='10000000-0000-0000-0000-000000000001' and o.title='From the old app' and s.board_column='progress'
 and o.board_order>(select max(w.board_order) from public.work_cards w join public.work_stages t on t.company_id=w.company_id and t.id=w.stage_id
  where w.company_id='10000000-0000-0000-0000-000000000001' and t.board_column='progress' and w.id<>o.id)),1,'a card the old version inserts goes to the end of its column');
select is((select title from public.work_cards where company_id='10000000-0000-0000-0000-000000000001' and title='From the old app'),'From the old app','the old version reads its cards as before');
select lives_ok($$select public.move_work_card('10000000-0000-0000-0000-000000000001',(select id from public.work_cards where company_id='10000000-0000-0000-0000-000000000001' and title='From the old app'),(select id from public.work_stages where company_id='10000000-0000-0000-0000-000000000001' and name='بريف جاهز'))$$,'the old version moves a card by stage');
select is((select count(*)::int from public.work_cards o join public.work_stages s on s.company_id=o.company_id and s.id=o.stage_id
 where o.company_id='10000000-0000-0000-0000-000000000001' and o.title='From the old app' and s.board_column='planned'
 and o.board_order>(select max(w.board_order) from public.work_cards w join public.work_stages t on t.company_id=w.company_id and t.id=w.stage_id
  where w.company_id='10000000-0000-0000-0000-000000000001' and t.board_column='planned' and w.id<>o.id)),1,'a moved card lands at the end of the column it arrives in');
reset role;
select is((select string_agg(key||'='||value,',' order by key) from (${verify}) v, json_each_text(v.json_build_object) where value not in ('true')),null,'every verify check passes after the migration');
select * from finish();
rollback;
`;
testDb(import.meta.url, sql);
