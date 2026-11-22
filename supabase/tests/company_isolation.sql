begin;
create extension if not exists pgtap with schema extensions;
-- Company isolation at the database (ADR 0004, #337): the Owner of Aleem, a member of no other Company, can neither read
-- nor change RS Learning's rows in any table that carries company_id. The matrix names every such table; a new one turns
-- the first test red until it is added here.
create temp table isolation_matrix(name text primary key, fixed jsonb not null default '{}');
insert into isolation_matrix(name) values
 ('agent_access_requests'),('agent_change_proposals'),('agent_grants'),('agent_permission_revoked'),('agent_permission_revokes'),('agent_handovers'),('agent_key_waits'),('agent_morning_leases'),('agent_profile_leftovers'),('agent_profiles'),
 ('agent_requests'),('agent_rules'),('approval_steps'),
 ('channel_agents'),('channel_attachments'),('channel_invitees'),('channel_messages'),('channel_notes'),('channel_people'),('channel_permissions'),('channel_reads'),('channel_runs'),('channels'),
 ('company_app_sign_ins'),('company_audit'),('company_key_holds'),('company_key_unfinished'),('company_log'),
 ('company_profile_keepers'),('company_profiles'),('company_provider_models'),('company_shared_spaces'),
 ('good_morning_results'),('good_mornings'),
 ('conversation_attachments'),('conversation_messages'),('conversation_notes'),('conversation_queued_turns'),
 ('conversation_run_notes'),('conversation_run_reservations'),('conversation_run_ends'),('conversations'),
 ('held_agent_changes'),('hermes_agents'),
 ('invitation_agent_access'),('lead_agent_requests'),('lead_made_agents'),
 ('member_agent_access'),('member_audit'),('member_invitations'),('member_notes'),('members'),
 ('note_runs'),('provider_names'),('reply_cards'),('role_permissions'),('routine_results'),('stopped_runs'),
 ('waiting_items'),
 ('work_activity'),('work_assignees'),('work_attachments'),('work_card_labels'),('work_card_moves'),('work_card_visits'),('work_cards'),
 ('work_checklist'),('work_comments'),('work_creatives'),('work_labels'),('work_projects'),('work_stages'),('work_versions');
-- Values a table's own checks need, as SQL (RS Learning is 10000000-...-0001). The member row names a person of no
-- Company, as naming the caller would make them a member of RS Learning, and a Contributor, so the Owner-only guard
-- does not answer before the policy does.
update isolation_matrix m set fixed = v.fixed::jsonb from (values
 -- A handover sits in one place: a Conversation's or a channel message's (#150); this row names a Conversation.
 ('agent_handovers', $${"conversation_id": "gen_random_uuid()"}$$),
 -- A Run Stop found open (#478) sits in one place too; this row names a Conversation.
 ('stopped_runs', $${"conversation_id": "gen_random_uuid()", "run_id": "'isolation'"}$$),
 -- A proposal off the list is kept as refused (#19), which its checks allow with any value.
 ('agent_change_proposals', $${"change": "'model'", "state": "'refused'"}$$),
 -- Good morning's lease (#182) names who holds it and until when.
 ('agent_morning_leases', $${"holder": "gen_random_uuid()", "until": "now() + interval '1 minute'"}$$),
 ('agent_profile_leftovers', $${"profile": "'ag-' || md5('isolation')"}$$),
 -- An entry a revoke took out (#166) names it and when.
 ('agent_permission_revoked', $${"entry": "'isolation'", "revoked_at": "now()"}$$),
 -- A revoke's hold on an Agent (#166) names who holds it.
 ('agent_permission_revokes', $${"held_by": "'e3370000-0000-0000-0000-000000000001'", "held_until": "now()"}$$),
 ('approval_steps', $${"person_id": "'e3370000-0000-0000-0000-000000000001'", "role": "null"}$$),
 ('channel_attachments', $${"channel_id": "'e3370000-0000-0000-0000-00000000000d'",
   "path": "'10000000-0000-0000-0000-000000000001/channels/e3370000-0000-0000-0000-00000000000d/isolation'"}$$),
 ('channel_messages', $${"author": "'person'", "send_key": "gen_random_uuid()"}$$),
 -- A held memory or skill change (#370) names its act; a memory one names no skill.
 ('held_agent_changes', $${"act": "'memory_reset'"}$$),
 -- A channel's quiet line names its invited person or its Card (#207, #151); this row is an invitation's.
 ('channel_notes', $${"kind": "'invite'", "invitee_name": "'Mona'"}$$),
 ('channel_permissions', $${"state": "'open'",
   "content": "'{\"choices\": [\"once\", \"deny\"], \"command\": \"ls\", \"description\": \"isolation\"}'"}$$),
 ('channels', $${"kind": "'team'", "created_by": "'e3370000-0000-0000-0000-000000000001'", "create_key": "gen_random_uuid()",
   "name": "'isolation'"}$$),
 ('company_audit', $${"action": "'company_renamed'", "old_name": "'isolation'", "new_name": "'isolation'"}$$),
 ('company_key_unfinished', $${"profiles": "array['co-' || md5('isolation')]"}$$),
 ('company_log', $${"actor_kind": "'person'", "actor_id": "'e3370000-0000-0000-0000-000000000001'", "source": "'company_audit'",
   "subject": "'company'"}$$),
 ('company_profiles', $${"profile": "'co-' || md5('isolation')", "tools_confirmed": "true"}$$),
 ('conversation_attachments', $${"conversation_id": "'e3370000-0000-0000-0000-00000000000c'",
   "path": "'10000000-0000-0000-0000-000000000001/conversations/e3370000-0000-0000-0000-00000000000c/isolation'"}$$),
 ('conversation_messages', $${"author": "'person'", "send_key": "gen_random_uuid()"}$$),
 ('conversation_run_ends', $${"outcome": "'completed'"}$$),
 ('members', $${"person_id": "'e3370000-0000-0000-0000-000000000002'", "role": "'contributor'"}$$),
 -- A card sits in one place: a Conversation's or a channel message's (#148); this row names a Conversation, as the
 -- test's own Conversation row does.
 -- A Provider's name (#618) names its provider and the Engine's id for the account.
 ('provider_names', $${"provider": "'openai-codex'", "account": "'isolat'", "name": "'isolation'"}$$),
 ('reply_cards', $${"kind": "'draft'", "state": "'shown'", "content": "'{\"line\": \"isolation\", \"rows\": []}'",
   "conversation_id": "'e3370000-0000-0000-0000-00000000000c'"}$$),
 -- A Routine result kept as it ended (#535) names its profile and its Routine's Engine id.
 ('routine_results', $${"profile": "'ag-' || md5('isolation')", "routine_id": "'abcdef'"}$$),
 ('company_provider_models', $${"entry": "'key-openrouter'", "model": "'openai/gpt-5.5'", "enabled": "false"}$$),
 ('waiting_items', $${"card_id": "1"}$$),
 ('work_attachments', $${"path": "'10000000-0000-0000-0000-000000000001/isolation'"}$$),
 ('work_stages', $${"board_column": "'ideas'"}$$),
 ('work_versions', $${"path": "'10000000-0000-0000-0000-000000000001/isolation'"}$$)
) v(name, fixed) where m.name = v.name;
select plan((select 1 + 4 * count(*)::int from isolation_matrix));
select set_eq(
 $$select name from isolation_matrix$$,
 $$select c.relname::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','p')
     and exists (select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='company_id' and not a.attisdropped)$$,
 'the isolation matrix names every public table with a company_id column');

insert into auth.users(id,email) values ('e3370000-0000-0000-0000-000000000001','isolation-owner@example.test'),
 ('e3370000-0000-0000-0000-000000000002','isolation-nobody@example.test');
insert into public.people(id,name) values ('e3370000-0000-0000-0000-000000000001','Owner of Aleem only'),
 ('e3370000-0000-0000-0000-000000000002','Member of no Company');
insert into public.members(company_id,person_id,role) values
 ('10000000-0000-0000-0000-000000000003','e3370000-0000-0000-0000-000000000001','owner');

-- One row for `t` in `company`: every column that must be filled gets a plain value of its type, and person_id and every
-- required column naming a person name `person`, so the row is the caller's own in everything but its Company. Only a
-- refusal (42501) counts on insert: any other error means the row missed a check before any policy was asked.
create function pg_temp.made_row(t text, fixed jsonb, company uuid, person uuid) returns text language plpgsql as $$
declare cols text[] := '{}'; vals text[] := '{}'; a record; v text;
begin
 for a in
  select att.attname::text as name, format_type(att.atttypid, att.atttypmod) as type, ty.typtype,
   att.attnotnull and not att.atthasdef and att.attidentity = '' and att.attgenerated = '' as needed,
   exists (select 1 from pg_constraint k where k.conrelid = att.attrelid and k.contype = 'f' and att.attnum = any(k.conkey)
     and k.confrelid in ('public.people'::regclass, 'auth.users'::regclass)) and (att.attnotnull or att.attname = 'person_id') as person
  from pg_attribute att join pg_type ty on ty.oid = att.atttypid
  where att.attrelid = format('public.%I', t)::regclass and att.attnum > 0 and not att.attisdropped
  order by att.attnum
 loop
  if a.name = 'company_id' then v := coalesce(fixed->>'company_id', quote_literal(company));
  elsif fixed ? a.name then v := fixed->>a.name;
  elsif a.person and a.type = 'uuid' then v := quote_literal(person);
  elsif a.needed then v := case
   when a.type like '%[]' then quote_literal('{}')
   when a.typtype = 'e' then format('(enum_range(null::%s))[1]', a.type)
   when a.type = 'uuid' then 'gen_random_uuid()'
   when a.type in ('smallint', 'integer', 'bigint', 'numeric') then '1 + floor(random() * 30000)::int'
   when a.type = 'boolean' then 'false'
   when a.type in ('json', 'jsonb') then quote_literal('{}')
   when a.type like 'timestamp%' or a.type = 'date' then 'now()'
   else quote_literal('isolation') end;
  else continue;
  end if;
  cols := cols || quote_ident(a.name);
  vals := vals || format('(%s)::%s', v, a.type);
 end loop;
 return format('insert into public.%I (%s) values (%s)', t, array_to_string(cols, ','), array_to_string(vals, ','));
end $$;

-- RS Learning gets one row in `t`, written past triggers and foreign keys so every table has one; then the Owner of Aleem
-- tries to read, add, change and remove RS Learning's rows. Everything is rolled back after.
create function pg_temp.attempts(t text, fixed jsonb) returns table(action text, outcome text) language plpgsql as $$
declare rs constant uuid := '10000000-0000-0000-0000-000000000001'; caller constant uuid := 'e3370000-0000-0000-0000-000000000001';
 n bigint; second text := pg_temp.made_row(t, fixed, rs, caller);
begin
 begin
  set local session_replication_role = replica;
  execute pg_temp.made_row(t, fixed, rs, caller);
  set local session_replication_role = origin;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', caller::text, true);
  action := 'select';
  begin
   execute format('select count(*) from public.%I where company_id = %L', t, rs) into n;
   outcome := case when n = 0 then 'refused' else n || ' row(s) seen' end;
  exception when insufficient_privilege then outcome := 'refused';
  end;
  return next;
  action := 'insert';
  begin
   execute second;
   outcome := 'inserted';
  exception when insufficient_privilege then outcome := 'refused';
   when others then outcome := sqlstate || ' ' || sqlerrm;
  end;
  return next;
  action := 'update';
  begin
   execute format('update public.%I set company_id = company_id where company_id = %L', t, rs);
   get diagnostics n = row_count;
   outcome := case when n = 0 then 'refused' else n || ' row(s) changed' end;
  exception when insufficient_privilege then outcome := 'refused';
   when others then outcome := sqlstate || ' ' || sqlerrm;
  end;
  return next;
  action := 'delete';
  begin
   execute format('delete from public.%I where company_id = %L', t, rs);
   get diagnostics n = row_count;
   outcome := case when n = 0 then 'refused' else n || ' row(s) removed' end;
  exception when insufficient_privilege then outcome := 'refused';
   when others then outcome := sqlstate || ' ' || sqlerrm;
  end;
  return next;
  raise exception using errcode = 'P0337';
 exception when sqlstate 'P0337' then null;
  when others then
   action := 'build';
   outcome := 'RS Learning''s row could not be written: ' || sqlstate || ' ' || sqlerrm;
   return next;
 end;
end $$;

select is(a.outcome, 'refused', format('%s: the Owner of another company cannot %s RS Learning''s rows', m.name, a.action))
from isolation_matrix m, lateral pg_temp.attempts(m.name, m.fixed) with ordinality a
order by m.name, a.ordinality;

select * from finish();
rollback;
