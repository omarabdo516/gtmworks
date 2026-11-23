begin;
create extension if not exists pgtap with schema extensions;
select plan(31);
-- #670. RS Learning: the Owner (…01), the Manager (…02), a Contributor (…03), the Viewer (…04) and a second
-- Contributor (…05). Ads is shown to the Manager, the first Contributor and the Viewer, and hidden from the second
-- Contributor. A Card in Writing, an Ads Card in Writing, a Card in review that waits on the Manager's approval, a Card
-- of a Project, and a Card in RS Consultations, a Company the Contributor is not in.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a6700000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','c6700000-0000-0000-0000-000000000001','Ads','Runs the Meta ads.',false,'archive-cards-ads');
insert into public.member_agent_access(company_id,person_id,agent_id)
 select '10000000-0000-0000-0000-000000000001',p,'a6700000-0000-0000-0000-000000000001'
 from unnest(array['20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004']::uuid[]) p;
insert into public.work_projects(company_id,name) values ('10000000-0000-0000-0000-000000000001','Archive June');
insert into public.work_cards(company_id,stage_id,title,agent_id,project_id)
 select s.company_id,s.id,x.title,x.agent::uuid,case when x.project then (select id from public.work_projects where name='Archive June') end
 from (values ('Archive writing',null,false),('Archive ads','a6700000-0000-0000-0000-000000000001',false),('Archive project',null,true)) x(title,agent,project)
 join public.work_stages s on s.company_id='10000000-0000-0000-0000-000000000001' and s.id=3;
insert into public.work_cards(company_id,stage_id,title) select company_id,id,'Archive elsewhere' from public.work_stages where company_id='10000000-0000-0000-0000-000000000002' and kind='ideas' order by position limit 1;
update public.approval_steps set person_id='20000000-0000-0000-0000-000000000002',role=null where company_id='10000000-0000-0000-0000-000000000001' and removed_at is null;
create temporary table ids on commit drop as select title,id from public.work_cards where title like 'Archive %';
grant select on ids to authenticated;
-- A Card's id, read once before any is archived (an archived Card is out of the caller's own reads).
create function pg_temp.card(title text) returns bigint language sql as $$ select id from ids where ids.title=card.title $$;
-- What a call answered, or the code of the error it raised.
create function pg_temp.answer(call text) returns text language plpgsql as $$
declare result text;
begin
 execute format('select coalesce(string_agg(x::text,'',''),'''') from (%s) x(x)',call) into result;
 return result;
exception when others then return sqlstate;
end $$;
grant execute on function pg_temp.card(text),pg_temp.answer(text) to authenticated;
create function pg_temp.seen(c uuid) returns text language sql as $$ select coalesce(string_agg(title,',' order by title),'') from public.work_cards where company_id=c and title like 'Archive %' $$;
create function pg_temp.archived(c uuid) returns text language sql as $$ select coalesce(string_agg(title,',' order by title),'') from public.archived_cards(c) where title like 'Archive %' $$;
grant execute on function pg_temp.seen(uuid),pg_temp.archived(uuid) to authenticated;

select ok(not has_function_privilege('anon','public.archive_cards(uuid,bigint[])','execute') and not has_function_privilege('anon','public.restore_cards(uuid,bigint[])','execute')
 and not has_function_privilege('anon','public.archived_cards(uuid)','execute'),'nobody signed out archives, restores or lists archived Cards');

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select public.move_work_card_to_column('10000000-0000-0000-0000-000000000001',pg_temp.card('Archive project'),'waiting');
select is((select approval_step_id is not null from public.work_cards where id=pg_temp.card('Archive project')),true,'the Project''s Card waits on the Manager''s approval');
reset role;
select set_config('test.log',(select count(*)::text from public.company_log where company_id='10000000-0000-0000-0000-000000000001'),true);
set local role authenticated;

-- The Viewer sees the Cards and archives nothing.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is(pg_temp.answer(format('select public.archive_cards(%L,array[%s])','10000000-0000-0000-0000-000000000001',pg_temp.card('Archive writing'))),'42501','a Viewer cannot archive a Card');

-- The Contributor archives two Cards at once.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(pg_temp.answer(format('select public.archive_cards(%L,array[%s,%s])','10000000-0000-0000-0000-000000000001',pg_temp.card('Archive writing'),pg_temp.card('Archive project'))),
 format('%s,%s',pg_temp.card('Archive writing'),pg_temp.card('Archive project')),'a Contributor archives two Cards in one call and is told both');
select is(pg_temp.seen('10000000-0000-0000-0000-000000000001'),'Archive ads','an archived Card is out of every read of current Cards, the board''s, the list''s, the calendar''s and Home''s');
select is((select count(*)::int from public.board_cards('10000000-0000-0000-0000-000000000001') where title like 'Archive %'),1,'the board leaves archived Cards out');
select is((select count(*)::int from public.work_cards where company_id='10000000-0000-0000-0000-000000000001' and project_id is not null and title like 'Archive %'),0,'the Project''s count leaves its archived Card out');
select is(pg_temp.archived('10000000-0000-0000-0000-000000000001'),'Archive project,Archive writing','the archived list holds both');
select is((select string_agg(format('%s %s %s',x.stage_id,x.archived_by,(x.archived_at is not null)::text),',' order by x.title) from public.archived_cards('10000000-0000-0000-0000-000000000001') x where x.title like 'Archive %'),
 '5 20000000-0000-0000-0000-000000000003 true,3 20000000-0000-0000-0000-000000000003 true','each archived Card keeps the column it was in and says who archived it, and when');
select is(pg_temp.answer(format('select public.archive_cards(%L,array[%s])','10000000-0000-0000-0000-000000000001',pg_temp.card('Archive writing'))),'','a Card already archived is not archived again');
select is(pg_temp.answer(format('select public.move_work_card_to_column(%L,%s,%L)','10000000-0000-0000-0000-000000000001',pg_temp.card('Archive writing'),'done')),'P0001','an archived Card is not moved');

-- The Manager no longer waits on the archived Card's approval.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is((select count(*)::int from public.waiting_list('10000000-0000-0000-0000-000000000001') where kind='approval' and card_id=pg_temp.card('Archive project')),0,'an archived Card waits on nobody in Waiting on you');

-- The Activity log keeps every row and gains one archive row each, with the person and the column.
reset role;
select is((select count(*)::int from public.company_log where company_id='10000000-0000-0000-0000-000000000001'),current_setting('test.log')::int+2,'the log keeps every row and gains one per archived Card');
select is((select string_agg(format('%s %s %s',actor_id,action,details->>'column'),',' order by card_id) from public.company_log where action='card_archived' and card_id in (pg_temp.card('Archive writing'),pg_temp.card('Archive project'))),
 '20000000-0000-0000-0000-000000000003 card_archived progress,20000000-0000-0000-0000-000000000003 card_archived waiting','each archive row names the person and the column the Card left');
set local role authenticated;

-- The Viewer sees the archived Cards; the Viewer cannot restore one.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
select is(pg_temp.archived('10000000-0000-0000-0000-000000000001'),'Archive project,Archive writing','a Viewer sees the archived Cards');
select is(pg_temp.answer(format('select public.restore_cards(%L,array[%s])','10000000-0000-0000-0000-000000000001',pg_temp.card('Archive writing'))),'42501','a Viewer cannot restore a Card');
select is((select count(*)::int from public.company_log where card_id=pg_temp.card('Archive writing') and action='card_archived'),1,'the log still names the archived Card to a Member');

-- A Card hidden from a Member stays hidden when archived.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
select is(pg_temp.answer(format('select public.archive_cards(%L,array[%s])','10000000-0000-0000-0000-000000000001',pg_temp.card('Archive ads'))),pg_temp.card('Archive ads')::text,'the Contributor who sees Ads archives its Card');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000005',true);
select is(pg_temp.archived('10000000-0000-0000-0000-000000000001'),'Archive project,Archive writing','a Member Ads is hidden from does not see its archived Card');
select is(pg_temp.answer(format('select public.restore_cards(%L,array[%s])','10000000-0000-0000-0000-000000000001',pg_temp.card('Archive ads'))),'','nor restores it');
select is((select count(*)::int from public.company_log where card_id=pg_temp.card('Archive ads')),0,'nor reads its log rows');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);

-- Another Company reaches nothing.
select is(pg_temp.answer(format('select public.archive_cards(%L,array[%s])','10000000-0000-0000-0000-000000000002',pg_temp.card('Archive elsewhere'))),'42501','a Member of another Company cannot archive its Cards');
select is(pg_temp.answer(format('select public.archive_cards(%L,%L::bigint[])','10000000-0000-0000-0000-000000000001','{}')),'','an empty choice archives nothing');
reset role;
select is(pg_temp.answer(format('select public.archive_cards(%L,array[%s])','10000000-0000-0000-0000-000000000001',(select id from public.work_cards where title='Archive elsewhere'))),'','a Card of another Company named under this one is never archived');
select is((select archived_at from public.work_cards where title='Archive elsewhere'),null,'and the other Company''s Card is as it was');
set local role authenticated;
select is(pg_temp.answer(format('select x.id from public.archived_cards(%L) x','10000000-0000-0000-0000-000000000002')),'','nor lists another Company''s archived Cards');

-- The Manager restores: the Card is back in the column it was in, and the log says so.
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
select is(pg_temp.answer(format('select public.restore_cards(%L,array[%s,%s])','10000000-0000-0000-0000-000000000001',pg_temp.card('Archive writing'),pg_temp.card('Archive ads'))),
 format('%s,%s',pg_temp.card('Archive writing'),pg_temp.card('Archive ads')),'a Manager restores two Cards in one call');
select is((select string_agg(format('%s %s',title,stage_id),',' order by title) from public.board_cards('10000000-0000-0000-0000-000000000001') where title like 'Archive %'),'Archive ads 3,Archive writing 3','restored Cards are back on the board in the column they were in');
select is(pg_temp.answer(format('select public.restore_cards(%L,array[%s])','10000000-0000-0000-0000-000000000001',pg_temp.card('Archive writing'))),'','a current Card is not restored again');
reset role;
select is((select string_agg(format('%s %s',actor_id,details->>'column'),',') from public.company_log where action='card_restored' and card_id=pg_temp.card('Archive writing')),
 '20000000-0000-0000-0000-000000000002 progress','the restore row names the person and the column the Card came back to');
select is((select archived_at is null and archived_by is null from public.work_cards where id=pg_temp.card('Archive writing')),true,'a restored Card is no longer archived');

select * from finish();
rollback;
