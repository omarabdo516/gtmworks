begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
-- #674 (spec #667). Every list of current Conversations leaves archived ones out in the database. A Conversation's read
-- rule does not change (its person still opens an archived one), so each function that runs as its owner and names the
-- Conversations table, or the reader's own Conversations (own_conversations), either says what it does with
-- archived_at, or is decided below as needing nothing, with why. A new one fails here until it is decided.
create temporary view conversation_table_readers as
with source as (
 select p.oid::regprocedure as fn,regexp_replace(regexp_replace(p.prosrc,'/\*.*?\*/',' ','g'),'--[^\n]*',' ','g') as body
 from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef)
select fn,body ~ '\yarchived_at\y' as asks from source where body ~ 'public\.(conversations|own_conversations)\y';

create temporary table decisions(fn text primary key, decision text not null check (decision in ('asks','exempt')), reason text not null check (btrim(reason)<>''));
insert into decisions
 select fn,'asks','lists current Conversations only or archived ones only, archives, restores or brings one back, or keeps the Engine''s mark of it, by archived_at' from unnest(array[
  'public.conversation_list(uuid,text,boolean,timestamptz,uuid,integer,text,text)','public.conversation_counts(uuid)','public.conversation_archive_stops(uuid,uuid[])',
  'public.archive_conversations(uuid,uuid[])','public.restore_conversations(uuid,uuid[])','public.restore_written_conversation()',
  'public.conversation_sessions_to_mark()','public.conversation_session_marked(uuid,boolean)','public.conversation_session_missing(uuid,boolean)']) fn
 union all select 'public.log_conversation_archive(uuid,boolean,uuid)','exempt','inside the database only: it writes the log row of the one Conversation an archive, a restore or a message just changed, and lists none'
 union all select fn,'exempt','answers for, or writes in, the one Conversation its caller names, archived or not: an archived Conversation still opens and reads as it was, and a message its person writes there brings it back (restore_written_conversation); it lists no Conversations' from unnest(array[
  'public.conversation_agent(uuid,uuid)','public.conversation_handovers(uuid)','public.conversation_live_run(uuid)','public.conversation_stop_target(uuid,uuid)',
  'public.conversation_working_for(uuid)','public.send_conversation_message(uuid,uuid,uuid,text,uuid,text,uuid)','public.reserve_conversation_turn(uuid,uuid,uuid,uuid,text)',
  'public.reserve_conversation_run(uuid,uuid,uuid,uuid,text)','public.reserve_conversation_files(uuid,uuid,uuid,jsonb)','public.discard_conversation_files(uuid,uuid,uuid)',
  'public.claim_conversation_turn(uuid)','public.set_conversation_model(uuid,uuid,jsonb)','public.answer_question(uuid,uuid,bigint,integer,text,uuid,integer[])',
  'public.decide_permission(uuid,uuid,bigint,text)','public.mark_hand_done(uuid,uuid,bigint)','public.postpone_app_card(uuid,uuid,bigint)',
  'public.stop_conversation_handovers(uuid,uuid)','public.can_see_conversation_agent(uuid,uuid)','public.lead_key_settle(uuid)','public.conversation_agent_access(uuid)',
  'public.pin_run_model(uuid,uuid)','public.refuse_run_model(uuid,uuid)','public.answer_agent_request(uuid,bigint,boolean,text)',
  'public.card_chat_person(uuid,bigint)','public.card_wait(public.work_cards)','public.reply_card_waits(public.reply_cards)']) fn
 union all select fn,'exempt','an Agent''s Run in one Conversation, carried by the worker or by the Run''s own tool call: archiving stopped the Run there and closed what it asked (stop_conversation_work), and a Run closing later writes its end and asks nothing (#671)' from unnest(array[
  'public.close_conversation_run(uuid,text,text,text,text,bigint,bigint,boolean)','public.track_run_question(uuid,text,jsonb,boolean,timestamptz)',
  'public.track_run_permission(uuid,text,jsonb,boolean,timestamptz,timestamptz,text)','public.settle_permission(bigint,text)',
  'public.agent_show_card(uuid,text,text,text,text,jsonb)','public.agent_save_rule(uuid,text,text,text)','public.agent_propose_change(uuid,text,text,text,text,text,jsonb,text)',
  'public.agent_ask_to_open(uuid,text,text,text)','public.lead_agent_profile(uuid,text,text,text)','public.lead_create_agent(uuid,text,text,text,text,text[],text,text,boolean,boolean)',
  'public.lead_request_agent(uuid,text,text,text,text,text[],text,text)','public.lead_hand_to_agent(uuid,text,text,text,text,text)',
  'public.command_handover(uuid,uuid,uuid,uuid,text,text,text)','public.begin_handover(bigint)','public.handover_hand_to_agent(bigint,text,text,text,text,text)',
  'public.close_handover_follow_up(bigint,text,text,text)','public.handover_writer(bigint)','public.open_conversation_runs(uuid,uuid,bigint)','public.stopped_runs_open()',
  'public.stop_open_handovers(uuid,bigint)','public.pin_run_history(uuid,uuid)','public.queue_unknown_start(public.conversation_run_reservations)']) fn
 union all select fn,'exempt','reads an Agent''s own state across the Conversations it is in (whether it works now, may move, what it was allowed, what it suggested): archiving a Conversation changes nothing the Agent did or holds' from unnest(array[
  'public.agent_move_blocked(uuid)','public.move_company_profile(uuid)','public.agent_open_run(uuid,uuid)','public.agent_permission_grants(uuid,uuid)',
  'public.agent_permission_inflight(uuid,uuid)','public.agent_permission_sending(uuid,uuid)','public.rule_suggestions_sent_to(uuid)']) fn
 union all select fn,'exempt','makes a Conversation, which is current, or finds the one it made before' from unnest(array[
  'public.choose_work_mode(uuid,text)','public.open_first_conversation(uuid,uuid,uuid,text)',
  'public.record_good_morning(uuid,uuid,text,date,timestamptz,text,jsonb)','public.start_card_conversation(uuid,bigint,uuid)']) fn
 union all select fn,'exempt','asks whether a Card is archived, not its Conversation: archiving a Conversation leaves its Card''s work and waits as they are' from unnest(array[
  'public.add_waiting_item(uuid,uuid,text,text,text,bigint,uuid,text)','public.card_archive_stops(uuid,bigint[])']) fn
 union all select fn,'exempt','a trigger: it runs on a write the table''s own rules admitted and answers no caller' from unnest(array[
  'public.conversation_reply_card()','public.keep_conversation_newest()']) fn;

select set_eq($$select fn::text from conversation_table_readers$$,$$select coalesce(to_regprocedure(fn)::text,fn) from decisions$$,
 'every function that reads the Conversations table as its owner is decided, and the table names no other');
select is_empty($$select r.fn::text from conversation_table_readers r join decisions d on to_regprocedure(d.fn)=r.fn where d.decision='asks' and not r.asks$$,
 'each one decided to ask names archived_at');

create function public.conversation_archive_fixture_forgets(c uuid) returns bigint language sql stable security definer set search_path='' as $$
 select count(*) from public.own_conversations(c) $$;
create function public.conversation_archive_fixture_asks(c uuid) returns bigint language sql stable security definer set search_path='' as $$
 select count(*) from public.conversations where company_id=c and archived_at is null $$;
select ok(not (select asks from conversation_table_readers where fn='public.conversation_archive_fixture_forgets(uuid)'::regprocedure),'a function that forgets archived Conversations is found');
select ok((select asks from conversation_table_readers where fn='public.conversation_archive_fixture_asks(uuid)'::regprocedure),'one that names archived_at passes');
select * from finish();
rollback;
