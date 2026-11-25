begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
-- #670 (spec #667). Every read of current Cards leaves archived ones out in the database. A read made as the signed-in
-- person goes through the table's card_current policy; a function that runs as its owner skips the policy, so each one
-- that names the Card table either says what it does with archived_at or is decided below as needing nothing, with why.
-- A new one fails here until it is decided.
create temporary view card_table_readers as
with source as (
 select p.oid::regprocedure as fn,regexp_replace(regexp_replace(p.prosrc,'/\*.*?\*/',' ','g'),'--[^\n]*',' ','g') as body
 from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef)
select fn,body ~ '\yarchived_at\y' as asks from source where body ~ 'public\.work_cards\y';

create temporary table decisions(fn text primary key, decision text not null check (decision in ('asks','exempt')), reason text not null check (btrim(reason)<>''));
insert into decisions
 select fn,'asks','reads only current Cards, or only archived ones, by archived_at' from unnest(array[
  'public.channel_board_card(uuid)','public.archived_cards(uuid)','public.archived_card_list(uuid,text,uuid,bigint,timestamptz,bigint,integer)','public.archived_card_count(uuid)','public.archive_cards(uuid,bigint[])','public.restore_cards(uuid,bigint[],timestamptz)',
  'public.card_archive_stops(uuid,bigint[])','public.stop_named_channel_run(public.channel_runs,text)']) fn
 union all select 'public.tick_card_todo(uuid,bigint,integer,text,boolean)','asks','ticks a to-do only on a current Card: an archived one is not found (#679)'
 union all select fn,'asks','asks for or decides the review of a current Card only: an archived one is not found (#681)' from unnest(array['public.ask_review(uuid,bigint)','public.decide_review(uuid,bigint,bigint,text,text)']) fn
 union all select fn,'asks','sets, ends or counts the waits of current Cards only: an archived one is not found, and one waited for that is archived holds nobody (#682)' from unnest(array['public.add_card_wait(uuid,bigint,bigint)','public.remove_card_wait(uuid,bigint,bigint)','public.open_card_waits(uuid)','public.wait_open(public.work_card_waits)','public.card_wait_links(uuid,bigint)']) fn
 union all select 'public.save_card_description(uuid,bigint,text,integer)','asks','writes the description of a current Card only: an archived one is not found (#680)'
 union all select 'public.stop_card_work(uuid,bigint)','exempt','inside the database only: archive_cards stops the work of the one Card it is archiving, before marking it'
 union all select fn,'asks','starts no work on an archived Card and keeps no wait on one (#671): it reads a Card only to ask whether it is archived' from unnest(array[
  'public.begin_note_start(bigint)','public.answer_note_start(bigint,integer,text)','public.add_waiting_item(uuid,uuid,text,text,text,bigint,uuid,text)']) fn
 union all select 'public.can_see_card(uuid,bigint)','exempt','the read rule itself: it answers whether the Agent is hidden, for a current or an archived Card alike'
 union all select fn,'exempt','answers for the one Card, or the one Conversation, its caller already read, so an archived Card opened from its link reads its chat and wait as it was' from unnest(array[
  'public.card_wait(public.work_cards)','public.reply_card_waits(public.reply_cards)','public.card_chat_person(uuid,bigint)']) fn
 union all select 'public.good_morning_waits(uuid)','exempt','lists through waiting_list, which runs as the caller under card_current; it reads a Card itself only to ask whether its Agent is hidden'
 union all select 'public.conversation_stamp(uuid)','exempt','the stamp of what changed in the one Conversation its own person names (#767): it reads the Card tied to it only to count its rows, and answers a digest, never a Card'
 union all select fn,'exempt','a trigger: it runs on a write the table''s own rules admitted and answers no caller' from unnest(array[
  'public.note_mentions()','public.conversation_reply_card()','public.work_card_place()',
  'public.channel_run_card()','public.channel_reply_card()']) fn
 union all select fn,'exempt','a trigger (#677): it keeps a Card''s one assignee, current or archived, equal to the old shapes, or lets an assignee removed from the Company go; it lists no Cards and answers no caller' from unnest(array[
  'public.unassign_removed()']) fn
 union all select fn,'exempt','the worker''s, callable by the service role only: it answers the worker, never a Member' from unnest(array[
  'public.lead_hand_to_agent(uuid,text,text,text,text,text)','public.close_handover_target(bigint,text,text,text)',
  'public.channel_hand_to_agent(bigint,text,text,text,text,text)','public.handover_hand_to_agent(bigint,text,text,text,text,text)',
  'public.close_handover_answer(bigint,text,text,text)']) fn;

select is((select format('%s %s %s %s',permissive,cmd,roles::text,qual) from pg_policies where schemaname='public' and tablename='work_cards' and policyname='card_current'),
 'RESTRICTIVE SELECT {authenticated} (archived_at IS NULL)','a read of the Card table as the signed-in person sees current Cards only');
select set_eq($$select fn::text from card_table_readers$$,$$select coalesce(to_regprocedure(fn)::text,fn) from decisions$$,
 'every function that reads the Card table as its owner is decided, and the table names no other');
select is_empty($$select r.fn::text from card_table_readers r join decisions d on to_regprocedure(d.fn)=r.fn where d.decision='asks' and not r.asks$$,
 'each one decided to ask names archived_at');

create function public.archive_fixture_forgets(c uuid) returns bigint language sql stable security definer set search_path='' as $$
 select count(*) from public.work_cards where company_id=c $$;
create function public.archive_fixture_commented(c uuid) returns bigint language sql stable security definer set search_path='' as $$
 -- and archived_at is null
 select count(*) from public.work_cards where company_id=c $$;
create function public.archive_fixture_asks(c uuid) returns bigint language sql stable security definer set search_path='' as $$
 select count(*) from public.work_cards where company_id=c and archived_at is null $$;
create function public.archive_fixture_invoker(c uuid) returns bigint language sql stable set search_path='' as $$
 select count(*) from public.work_cards where company_id=c $$;
select set_eq($$select fn::text from card_table_readers where not asks and fn::text like '%archive\_fixture\_%'$$,
 array['public.archive_fixture_forgets(uuid)'::regprocedure::text,'public.archive_fixture_commented(uuid)'::regprocedure::text],
 'a function that runs as its owner and reads the Card table is found when it forgets archived Cards, and when it remembers them only in a comment');
select ok((select asks from card_table_readers where fn='public.archive_fixture_asks(uuid)'::regprocedure),'one that names archived_at passes');
select ok(not exists(select 1 from card_table_readers where fn='public.archive_fixture_invoker(uuid)'::regprocedure),'a function that runs as the caller reads under card_current and is not listed');
select * from finish();
rollback;
