begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
-- #228: a function that runs as its owner skips the read rules #221 (#144) put on a Card tied to a chat and on every row
-- written on it, so each one that reads those tables either asks the rule (can_see_card for the signed-in caller,
-- agent_visible_to for a person it names) or is decided below as needing none, with why. A new one fails here until it
-- is decided. The card tables are the ones that carry #221's rule.
create temporary view card_tables as select tablename::text as name from pg_policies where schemaname='public' and policyname='card_agent_visible';
-- A function reads a Card when its body, comments left out, names a card table, when it is a trigger on one, or when it
-- calls a function that runs as the caller and reads one (that function then reads as the owner too).
create temporary view card_readers as
with recursive pattern as (select 'public\.('||string_agg(name,'|')||')\y' as tables from card_tables),
source as (
 select p.oid,p.proname::text as name,p.oid::regprocedure as fn,p.prosecdef as definer,
  regexp_replace(regexp_replace(p.prosrc,'/\*.*?\*/',' ','g'),'--[^\n]*',' ','g') as body
 from pg_proc p where p.pronamespace='public'::regnamespace),
invoker_readers(name) as (
 select s.name from source s,pattern where not s.definer and s.body ~ pattern.tables
 union
 select s.name from source s join invoker_readers r on s.body ~ ('public\.'||r.name||'\s*\(') where not s.definer)
select s.fn,s.body ~ 'public\.(can_see_card|agent_visible_to)\s*\(' as checks
from source s,pattern
where s.definer and (s.body ~ pattern.tables
 or exists(select 1 from invoker_readers r where s.body ~ ('public\.'||r.name||'\s*\('))
 or exists(select 1 from pg_trigger t join card_tables c on t.tgrelid=('public.'||c.name)::regclass where t.tgfoid=s.oid and not t.tgisinternal));

create temporary table decisions(fn text primary key, decision text not null check (decision in ('checks','exempt')), reason text not null check (btrim(reason)<>''));
insert into decisions
 select fn,'checks','answers for a Card its Agent hides from the caller, or from the person it names, as for a Card that does not exist' from unnest(array[
  'public.agent_run_facts(uuid,uuid)','public.agent_work(uuid)','public.edit_card_note(uuid,bigint,text)',
  'public.card_chat_person(uuid,bigint)',
  'public.card_wait(public.work_cards)','public.reply_card_waits(public.reply_cards)',
  'public.archived_cards(uuid)','public.archived_card_list(uuid,text,uuid,bigint,timestamptz,bigint,integer)','public.archived_card_count(uuid)','public.archive_cards(uuid,bigint[])','public.restore_cards(uuid,bigint[],timestamptz)','public.card_archive_stops(uuid,bigint[])']) fn
 union all select 'public.stop_card_work(uuid,bigint)','exempt','callable inside the database only, by archive_cards, which asks can_see_card for the Card first (#671); it answers nothing'
 union all select 'public.log_conversation_archive(uuid,boolean,uuid)','exempt','callable inside the database only: it writes the log row of a Conversation its own person archived or restored (#674) through log_chat_event, on the chat''s Card when it has one (read under card_agent_visible), else private to that person; it answers nothing'
 union all select 'public.stop_named_channel_run(public.channel_runs,text)','exempt','callable inside the database only, by the worker''s answer_channel_start: it reads the channel''s Card only to ask whether it is archived, and answers nothing'
 union all select fn,'exempt','the worker''s, callable by the service role only: it answers the worker, never a Member, and reads a Card only to ask whether it is archived (#671)' from unnest(array[
  'public.stopped_runs_open()']) fn
 union all select 'public.channel_board_card(uuid)','exempt','a channel member reads the one Card their channel put on the board only while they see its Agent (can_see_agent), as the board shows it (#151); anyone else reads nothing'
 union all select 'public.can_see_card_file(text)','checks','a stored file follows each Card it belongs to'
 union all select 'public.can_see_card(uuid,bigint)','exempt','the read rule itself'
 union all select fn,'exempt','a trigger: it runs on a write the table''s own rules admitted, answers no caller, and every row it writes is read under card_agent_visible' from unnest(array[
  'public.conversation_reply_card()','public.log_card_activity()','public.log_card_comment()',
  'public.log_company_change()','public.log_member_change()','public.log_member_invitation()','public.log_note_edit()','public.note_mentions()',
  'public.resolve_waiting_on_card()','public.resolve_waiting_on_reply()','public.work_audit()','public.work_card_place()',
  'public.channel_run_card()','public.channel_reply_card()','public.align_card_assignee()','public.card_write_guard()']) fn
 union all select 'public.tick_card_todo(uuid,bigint,integer,text,boolean)','checks','ticks a to-do on a Card the caller sees (can_see_card) and writes its own Activity row (#679); a hidden Card is not found'
 union all select fn,'checks','asks for or decides the review of a Card the caller sees (can_see_card); a hidden Card is not found (#681)' from unnest(array['public.ask_review(uuid,bigint)','public.decide_review(uuid,bigint,bigint,text,text)']) fn
 union all select fn,'checks','sets, ends or reads the waits of Cards the caller sees (can_see_card); a Card waited for that they may not see is named by nothing (#682)' from unnest(array['public.add_card_wait(uuid,bigint,bigint)','public.remove_card_wait(uuid,bigint,bigint)','public.card_wait_links(uuid,bigint)','public.open_card_waits(uuid)']) fn
 union all select 'public.wait_open(public.work_card_waits)','exempt','callable inside the database only, by the readers of waits that ask can_see_card first (#682); it answers whether one wait still holds'
 union all select fn,'exempt','a trigger (#682): it refuses a loop of waits or releases the waits on an archived Card, and answers no caller' from unnest(array['public.refuse_wait_loop()','public.release_waits_on_archive()']) fn
 union all select 'public.save_card_description(uuid,bigint,text,integer)','checks','saves the description of a Card the caller sees (can_see_card), answering the text read for a merge (#680); a hidden Card is not found'
 union all select 'public.keep_description_version()','exempt','a trigger (#680): it keeps each version a description reaches, read under card_agent_visible, and answers no caller'
 union all select 'public.log_card_files()','exempt','a trigger on files added to a Card itself (#678): it writes one log row naming them, read under card_agent_visible, and answers no caller'
 union all select 'public.unassign_removed()','exempt','a trigger on removing an Agent or a Member (#677): it leaves their Cards assigned to nobody and answers no caller; the log rows it writes are read under card_agent_visible'
 union all select 'public.keep_record_agent()','exempt','a trigger: it keeps the Agent a Card, a Conversation or a channel call was made with when that Agent is removed (#702), reading only whether the Agent still exists; it answers no caller'
 union all select 'public.work_card_moved()','exempt','a trigger: it runs on a write the table''s own rules admitted and answers no caller; the move it writes is read by its own mover alone, on a Card that mover can see (work_card_moves_read)'
 union all select fn,'exempt','the worker''s, callable by the service role only: it answers the worker, never a Member, and the rows it writes are read under card_agent_visible' from unnest(array[
  'public.add_waiting_item(uuid,uuid,text,text,text,bigint,uuid,text)','public.agent_propose_change(uuid,text,text,text,text,text,jsonb,text)','public.agent_save_rule(uuid,text,text,text)','public.agent_show_card(uuid,text,text,text,text,jsonb)',
  'public.answer_note_start(bigint,integer,text)','public.begin_note_start(bigint)','public.channel_hand_to_agent(bigint,text,text,text,text,text)','public.handover_hand_to_agent(bigint,text,text,text,text,text)','public.channel_show_card(bigint,text,text,text,text,jsonb)','public.close_note_run(bigint,text,text,text,bigint,bigint)',
  'public.lead_hand_to_agent(uuid,text,text,text,text,text)','public.move_company_profile(uuid)','public.note_runs_due(bigint,bigint)','public.release_note_start(bigint,integer)']) fn
 union all select 'public.close_handover_answer(bigint,text,text,text)','exempt','the worker''s, callable by the service role only: it logs an asked Agent''s answer (#477) on the channel''s Card, whose log its channel''s members read under the channel''s own rule, and answers no Member'
 union all select 'public.close_handover_target(bigint,text,text,text)','exempt','the worker''s, callable by the service role only: it logs the handed-to Agent''s answer on the channel''s Card, whose log its channel''s members read under the channel''s own rule, and answers no Member'
 union all select 'public.settle_question(bigint,text)','exempt','the worker''s, callable by the service role only: it settles a question card it was handed and writes its log row, on the chat''s Card when it has one (read under card_agent_visible), else private to the Conversation''s person; it answers no Member'
 union all select 'public.settle_permission(bigint,text)','exempt','the worker''s, callable by the service role only: it settles a permission request card it was handed and writes its log row, private to the Conversation''s person; it answers no Member'
 union all select 'public.settle_channel_permission(bigint,text)','exempt','the worker''s, callable by the service role only: it settles a channel''s permission request it was handed and writes its log row, private to the Member who decided it; it answers no Member'
 union all select 'public.settle_channel_question(bigint,text)','exempt','the worker''s, callable by the service role only: it settles a channel''s question it was handed and writes its log row, which is read by the channel''s members alone; it answers no Member'
 union all select 'public.mark_channel_hand_done(uuid,uuid,bigint)','exempt','a Member of the channel marks a step its Agent handed the team done and writes its log row, read by the channel''s members alone; it refuses anyone outside the channel and answers the press, never a Card'
 union all select 'public.mark_hand_done(uuid,uuid,bigint)','exempt','the Conversation''s own person marks a hand card of that Conversation done and writes its log row, on the chat''s Card when it has one (read under card_agent_visible), else private to that person; it answers no Card'
 union all select fn,'exempt','a Member''s own channel action: a message names the Members it mentions, and each of them reads one waiting item that names that message and no Card, while opening the mention (#200) resolves the reader''s own item alone; neither answers a Card' from unnest(array[
  'public.post_channel_message(uuid,uuid,text)','public.read_channel_mention(uuid,bigint)']) fn
 union all select fn,'exempt','an Owner or a Manager in a team channel archives or restores it (#675): it writes the channel''s own log row, read by the channel''s members alone, and on archiving resolves the waiting items of the channel''s messages; it names no Card and answers none' from unnest(array[
  'public.archive_channel(uuid,uuid)','public.restore_channel(uuid,uuid)']) fn
 union all select 'public.good_morning_waits(uuid)','checks','runs as the authenticated role, so the Member''s own policies apply, and asks can_see_card for each Card besides; record_good_morning''s only caller (#183)'
 union all select 'public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)','exempt','callable inside the database only; it writes an Agent''s log row, which names no Card'
 union all select 'public.log_held_change(public.held_agent_changes,boolean)','exempt','callable inside the database only; it writes the Agent''s log row of a held memory or skill change (#370), which names no Card'
 union all select 'public.log_routine_change(uuid,uuid,text,text,text,uuid)','exempt','it answers nothing: it reads only whether this Agent''s own Routine change is already in the Company log by its key (#31), a row that names no Card'
 union all select fn,'exempt','an Owner or a Manager saves a field of an Agent''s settings page and writes that Agent''s log row, which names no Card; the caller is checked by check_agent_setting or check_agent_owner_setting' from unnest(array[
  'public.log_agent_setting(uuid,uuid,text,text,text)','public.log_agent_instructions(uuid,uuid)','public.log_agent_morning(uuid,uuid,text,text,uuid)']) fn
 union all select 'public.change_agent_look(uuid,uuid,text,text)','exempt','an Owner changes a part of an Agent''s look (#696) and writes that Agent''s log row, which names no Card; it answers the look alone'
 union all select 'public.log_screen_woken(uuid,uuid)','exempt','a Member who is not a Viewer and sees the Agent woke its Screen and writes that Agent''s log row, which names no Card; the caller is checked by check_screen_wake (#712)'
 union all select 'public.screen_control_logged(uuid,uuid,text)','exempt','callable inside the database only, by log_screen_taken (whose caller check_screen_wake checks) and log_screen_given_back (whose caller is_member and can_see_agent check): it writes the Agent''s log row of control of its Screen, which names no Card, and answers nothing (#713)'
 union all select 'public.log_permission_revoked(uuid,uuid,text,text)','exempt','an Owner or a Manager who sees the Agent revokes one of its standing permissions and writes that Agent''s log row, which names no Card; the caller is checked by check_permission_revoke (#166)'
 union all select 'public.pin_run_history(uuid,uuid)','exempt','the worker''s, callable by the service role only: it reads when an Agent last moved from that Agent''s log rows, which name no Card, and answers the Conversation''s own messages'
 union all select 'public.agent_move_blocked(uuid)','exempt','callable inside the database only; it answers whether an Agent has running work, and names no Card'
 union all select fn,'exempt','reads only the waiting items of rule suggestions, which name no Card; the rule''s Agent is checked with can_see_agent' from unnest(array[
  'public.decide_agent_rule(uuid,bigint,boolean)','public.remove_agent_rule(uuid,uuid)','public.rule_suggestions_sent_to(uuid)']) fn;

select is((select count(*)::int from card_tables),13,'the card tables are the 13 that carry #221''s rule, the Card itself, its reviews (#681), its waits (#682) and its description''s versions (#680) among them; the checklist, labels and other assignees went with the cutover (#684)');
select ok(not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef
  and (not coalesce(p.proconfig,'{}') && array['search_path=""'] or regexp_replace(regexp_replace(p.prosrc,'/\*.*?\*/',' ','g'),'--[^\n]*',' ','g') ~* '\yexecute\y')),
 'every function that runs as its owner has an empty search path and no dynamic SQL, so every table it reads is named with its schema in its body');
select set_eq($$select fn::text from card_readers$$,$$select coalesce(to_regprocedure(fn)::text,fn) from decisions$$,
 'every function that reads a Card as its owner is decided, and the table names no other');
select is_empty($$select r.fn::text from card_readers r join decisions d on to_regprocedure(d.fn)=r.fn where d.decision='checks' and not r.checks$$,
 'each one decided to check calls can_see_card or agent_visible_to');
select is_empty($$select r.fn::text from card_readers r left join decisions d on to_regprocedure(d.fn)=r.fn where not r.checks and d.decision is distinct from 'exempt'$$,
 'each one that calls neither is exempt, with its reason');

create function public.guard_fixture_direct(c uuid, card bigint) returns text language sql stable security definer set search_path='' as $$
 select title from public.work_cards where company_id=c and id=card $$;
create function public.guard_fixture_child(c uuid, card bigint) returns bigint language sql stable security definer set search_path='' as $$
 select count(*) from public.work_comments where company_id=c and card_id=card $$;
create function public.guard_fixture_commented(c uuid, card bigint) returns text language sql stable security definer set search_path='' as $$
 -- where public.can_see_card(c,card)
 select title from public.work_cards where company_id=c and id=card $$;
create function public.guard_fixture_inner(c uuid, card bigint) returns text language sql stable set search_path='' as $$
 select title from public.work_cards where company_id=c and id=card $$;
create function public.guard_fixture_through(c uuid, card bigint) returns text language sql stable security definer set search_path='' as $$
 select public.guard_fixture_inner(c,card) $$;
create function public.guard_fixture_trigger() returns trigger language plpgsql security definer set search_path='' as $$ begin return new; end $$;
create trigger guard_fixture_trigger before update on public.work_card_waits for each row execute function public.guard_fixture_trigger();
create function public.guard_fixture_checked(c uuid, card bigint) returns text language sql stable security definer set search_path='' as $$
 select title from public.work_cards where company_id=c and id=card and public.can_see_card(c,card) $$;
select set_eq($$select fn::text from card_readers r where not r.checks and r.fn::text like '%guard\_fixture\_%'$$,
 array['public.guard_fixture_direct(uuid,bigint)'::regprocedure::text,'public.guard_fixture_child(uuid,bigint)'::regprocedure::text,
  'public.guard_fixture_commented(uuid,bigint)'::regprocedure::text,'public.guard_fixture_through(uuid,bigint)'::regprocedure::text,
  'public.guard_fixture_trigger()'::regprocedure::text],
 'a function that runs as its owner without the check is found when it reads the Card, a row written on it, or through a function that reads one, when its check is only a comment, and when it is a trigger on a card table');
select ok((select checks from card_readers where fn='public.guard_fixture_checked(uuid,bigint)'::regprocedure),'one that calls the check passes');
select ok(not exists(select 1 from card_readers where fn='public.guard_fixture_inner(uuid,bigint)'::regprocedure),'a function that runs as the caller reads under the read rules and is not listed');
select * from finish();
rollback;
