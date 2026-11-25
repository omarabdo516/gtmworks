begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
-- #675 (spec #667). Every list of current channels leaves archived ones out in the database. The channel's read rules
-- do not change (its Members still read an archived channel), so each function that runs as its owner and names the
-- channels table either says what it does with archived_at, or is decided below as needing nothing, with why. A new one
-- fails here until it is decided.
create temporary view channel_table_readers as
with source as (
 select p.oid::regprocedure as fn,regexp_replace(regexp_replace(p.prosrc,'/\*.*?\*/',' ','g'),'--[^\n]*',' ','g') as body
 from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef)
select fn,body ~ '\yarchived_at\y' as asks from source where body ~ 'public\.channels\y';

create temporary table decisions(fn text primary key, decision text not null check (decision in ('asks','exempt')), reason text not null check (btrim(reason)<>''));
insert into decisions
 select fn,'asks','lists current channels only, or archived ones only, or archives, restores or refuses by archived_at' from unnest(array[
  'public.channel_sidebar(uuid)','public.archived_channels(uuid)','public.channel_archive_stops(uuid)','public.archive_channel(uuid,uuid)',
  'public.restore_channel(uuid,uuid)','public.refuse_archived_channel_message()','public.keep_archived_channel_people()','public.set_channel_person(uuid,uuid,boolean)',
  'public.stop_named_channel_run(public.channel_runs,text)',
  'public.conversation_list(uuid,text,boolean,timestamptz,uuid,integer,text,text)','public.conversation_counts(uuid)']) fn
 union all select fn,'exempt','answers for the one channel its caller names, archived or not, since its Members still read an archived channel; it lists no channels' from unnest(array[
  'public.channel_member(uuid,uuid)','public.channel_agent(uuid,uuid,uuid)','public.channel_agent_list(uuid)','public.channel_members(uuid)',
  'public.channel_can_show_cards(uuid,uuid,uuid)','public.channel_can_hand_over(uuid,uuid,uuid)','public.channel_mentions_in(uuid,uuid,text)',
  'public.channel_message_mentions(uuid,uuid,text)','public.reply_card_in_other_channel(bigint)','public.channel_stoppable(uuid)',
  'public.channel_board_card(uuid)','public.read_channel(uuid,bigint)','public.read_channel_mention(uuid,bigint)']) fn
 union all select fn,'exempt','a write into the one channel named: a Member''s message there is refused while it is archived (channel_messages_not_archived), and files kept for a refused message go with it' from unnest(array[
  'public.post_channel_message(uuid,uuid,text)','public.reserve_channel_files(uuid,uuid,uuid,jsonb)','public.reserve_channel_files(uuid,uuid,uuid,jsonb,uuid)','public.discard_channel_files(uuid,uuid,uuid)']) fn
 union all select fn,'exempt','an Owner or a Manager in the one channel named changes which Agents or invitees it has; its details offer no change while it is archived, and a change starts no work there' from unnest(array[
  'public.set_channel_agent(uuid,uuid,boolean)','public.set_channel_invitee(uuid,uuid,boolean)']) fn
 union all select 'public.agent_work(uuid)','exempt','asks which channels the reader is in, to tell whether a Run there is theirs to see: an archived channel''s Members still read it, so its Runs still count; it lists no channels'
 union all select 'public.card_archive_stops(uuid,bigint[])','exempt','names what stops in the one team channel of a current Card it is asked about; an archived channel''s work stopped when it was archived, so it names nothing there'
 union all select 'public.create_channel_inviting(uuid,uuid,text,uuid[],uuid[],uuid[])','exempt','makes a new channel, which is current; the same request key answers the channel it made'
 union all select fn,'exempt','a trigger: it runs on a write the table''s own rules admitted and answers no caller' from unnest(array[
  'public.add_general_channel()','public.start_general_read()','public.note_member_invitation()','public.channel_run_card()']) fn;

select set_eq($$select fn::text from channel_table_readers$$,$$select coalesce(to_regprocedure(fn)::text,fn) from decisions$$,
 'every function that reads the channels table as its owner is decided, and the table names no other');
select is_empty($$select r.fn::text from channel_table_readers r join decisions d on to_regprocedure(d.fn)=r.fn where d.decision='asks' and not r.asks$$,
 'each one decided to ask names archived_at');

create function public.channel_archive_fixture_forgets(c uuid) returns bigint language sql stable security definer set search_path='' as $$
 select count(*) from public.channels where company_id=c $$;
create function public.channel_archive_fixture_asks(c uuid) returns bigint language sql stable security definer set search_path='' as $$
 select count(*) from public.channels where company_id=c and archived_at is null $$;
select ok(not (select asks from channel_table_readers where fn='public.channel_archive_fixture_forgets(uuid)'::regprocedure),'a function that forgets archived channels is found');
select ok((select asks from channel_table_readers where fn='public.channel_archive_fixture_asks(uuid)'::regprocedure),'one that names archived_at passes');
select * from finish();
rollback;
