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
  'public.decide_approval(uuid,bigint,text,text,boolean,boolean)','public.edit_card_note(uuid,bigint,text)',
  'public.start_card_conversation(uuid,bigint,uuid)','public.card_chat_person(uuid,bigint)',
  'public.card_wait(public.work_cards)','public.reply_card_waits(public.reply_cards)']) fn
 union all select 'public.channel_board_card(uuid)','exempt','a channel member reads the one Card their channel put on the board only while they see its Agent (can_see_agent), as the board shows it (#151); anyone else reads nothing'
 union all select 'public.can_see_card_file(text)','checks','a stored file follows each Card it belongs to'
 union all select 'public.can_see_card(uuid,bigint)','exempt','the read rule itself'
 union all select fn,'exempt','a trigger: it runs on a write the table''s own rules admitted, answers no caller, and every row it writes is read under card_agent_visible' from unnest(array[
  'public.approval_card_guard()','public.conversation_reply_card()','public.log_card_activity()','public.log_card_comment()',
  'public.log_company_change()','public.log_member_change()','public.log_member_invitation()','public.log_note_edit()','public.note_mentions()',
  'public.resolve_waiting_on_card()','public.resolve_waiting_on_reply()','public.schedule_approved_card()','public.work_audit()','public.work_card_place()','public.work_guard()',
  'public.channel_run_card()','public.channel_reply_card()']) fn
 union all select 'public.work_card_moved()','exempt','a trigger: it runs on a write the table''s own rules admitted and answers no caller; the move it writes is read by its own mover alone, on a Card that mover can see (work_card_moves_read)'
 union all select fn,'exempt','the worker''s, callable by the service role only: it answers the worker, never a Member, and the rows it writes are read under card_agent_visible' from unnest(array[
  'public.add_waiting_item(uuid,uuid,text,text,text,bigint,uuid,text)','public.agent_propose_change(uuid,text,text,text,text,text,jsonb,text)','public.agent_save_rule(uuid,text,text,text)','public.agent_show_card(uuid,text,text,text,text,jsonb)',
  'public.answer_note_start(bigint,integer,text)','public.begin_note_start(bigint)','public.channel_hand_to_agent(bigint,text,text,text,text,text)','public.channel_show_card(bigint,text,text,text,text,jsonb)','public.close_note_run(bigint,text,text,text,bigint,bigint)',
  'public.lead_hand_to_agent(uuid,text,text,text,text,text)','public.move_company_profile(uuid)','public.note_runs_due(bigint,bigint)']) fn
 union all select 'public.close_handover_target(bigint,text,text,text)','exempt','the worker''s, callable by the service role only: it logs the handed-to Agent''s answer on the channel''s Card, whose log its channel''s members read under the channel''s own rule, and answers no Member'
 union all select 'public.settle_question(bigint,text)','exempt','the worker''s, callable by the service role only: it settles a question card it was handed and writes its log row, on the chat''s Card when it has one (read under card_agent_visible), else private to the Conversation''s person; it answers no Member'
 union all select 'public.settle_permission(bigint,text)','exempt','the worker''s, callable by the service role only: it settles a permission request card it was handed and writes its log row, private to the Conversation''s person; it answers no Member'
 union all select 'public.settle_channel_permission(bigint,text)','exempt','the worker''s, callable by the service role only: it settles a channel''s permission request it was handed and writes its log row, private to the Member who decided it; it answers no Member'
 union all select 'public.settle_channel_question(bigint,text)','exempt','the worker''s, callable by the service role only: it settles a channel''s question it was handed and writes its log row, which is read by the channel''s members alone; it answers no Member'
 union all select 'public.mark_channel_hand_done(uuid,uuid,bigint)','exempt','a Member of the channel marks a step its Agent handed the team done and writes its log row, read by the channel''s members alone; it refuses anyone outside the channel and answers the press, never a Card'
 union all select 'public.mark_hand_done(uuid,uuid,bigint)','exempt','the Conversation''s own person marks a hand card of that Conversation done and writes its log row, on the chat''s Card when it has one (read under card_agent_visible), else private to that person; it answers no Card'
 union all select fn,'exempt','a Member''s own channel action: a message names the Members it mentions, and each of them reads one waiting item that names that message and no Card, while opening the mention (#200) resolves the reader''s own item alone; neither answers a Card' from unnest(array[
  'public.post_channel_message(uuid,uuid,text)','public.read_channel_mention(uuid,bigint)']) fn
 union all select 'public.log_agent_event(uuid,uuid,text,uuid,text,jsonb)','exempt','callable inside the database only; it writes an Agent''s log row, which names no Card'
 union all select 'public.log_routine_change(uuid,uuid,text,text,text,uuid)','exempt','it answers nothing: it reads only whether this Agent''s own Routine change is already in the Company log by its key (#31), a row that names no Card'
 union all select fn,'exempt','an Owner or a Manager saves a field of an Agent''s settings page and writes that Agent''s log row, which names no Card; the caller is checked by check_agent_setting or check_agent_owner_setting' from unnest(array[
  'public.log_agent_setting(uuid,uuid,text,text,text)','public.log_agent_instructions(uuid,uuid)']) fn
 union all select 'public.pin_run_history(uuid,uuid)','exempt','the worker''s, callable by the service role only: it reads when an Agent last moved from that Agent''s log rows, which name no Card, and answers the Conversation''s own messages'
 union all select 'public.agent_move_blocked(uuid)','exempt','callable inside the database only; it answers whether an Agent has running work, and names no Card'
 union all select fn,'exempt','reads only the waiting items of rule suggestions, which name no Card; the rule''s Agent is checked with can_see_agent' from unnest(array[
  'public.decide_agent_rule(uuid,bigint,boolean)','public.remove_agent_rule(uuid,uuid)','public.rule_suggestions_sent_to(uuid)']) fn
 union all select fn,'exempt','an Owner or a Manager changes an approval step: every Card on it moves with it so none is left on a removed step, and nothing about a Card is answered' from unnest(array[
  'public.remove_approval_step(uuid,bigint)','public.save_approval_step(uuid,bigint,text,integer,uuid,public.member_role)']) fn;

select is((select count(*)::int from card_tables),13,'the card tables are the 13 that carry #221''s rule, the Card itself among them');
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
create trigger guard_fixture_trigger before update on public.work_card_labels for each row execute function public.guard_fixture_trigger();
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
