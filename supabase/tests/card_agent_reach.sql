begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
-- #367. RS Learning with Ads, shown to the Contributor (…03), and SEO, shown to nobody. A Card whose own Agent is SEO is
-- out of the Contributor's reach by its id, as board_cards() already leaves it off their board: no read, no write, no
-- move, no place, no undo, nothing written on it. The Owner reaches it, and the Contributor reaches the Ads Card.
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile) values
 ('a3670000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','f3670000-0000-0000-0000-000000000002','Ads','Ads',false,'default'),
 ('a3670000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','f3670000-0000-0000-0000-000000000003','SEO','SEO',false,'default');
insert into public.member_agent_access(company_id,person_id,agent_id) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','a3670000-0000-0000-0000-000000000002');
insert into public.work_cards(company_id,status,title,agent_id)
 select '10000000-0000-0000-0000-000000000001','ideas',x.title,x.agent::uuid from (values ('Reach Ads','a3670000-0000-0000-0000-000000000002'),('Reach SEO','a3670000-0000-0000-0000-000000000003'),
  ('Reach Undo','a3670000-0000-0000-0000-000000000002'),('Reach Owner','a3670000-0000-0000-0000-000000000003')) x(title,agent)
;
create temporary table reach(title text primary key, id bigint not null);
insert into reach select title,id from public.work_cards where title like 'Reach %';
grant select on reach to authenticated;
create function pg_temp.card(t text) returns bigint language sql stable as $$ select id from reach where title=t $$;
create function pg_temp.retitle(card bigint, t text) returns integer language plpgsql as $$
declare changed integer; begin update public.work_cards set title=t where id=card; get diagnostics changed=row_count; return changed; end $$;
grant execute on function pg_temp.card(text),pg_temp.retitle(bigint,text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);
-- The Contributor moves the Undo Card while its Agent is Ads, so they have a move of it to undo.
select lives_ok($$select public.move_card('10000000-0000-0000-0000-000000000001',pg_temp.card('Reach Undo'),'planned')$$,'the Contributor moves a Card whose Agent they see');
reset role;
update public.work_cards set agent_id='a3670000-0000-0000-0000-000000000003' where title='Reach Undo';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000003',true);

select is((select count(*)::int from public.work_cards where title='Reach SEO'),0,'the Contributor does not read a Card whose own Agent is hidden from them');
select is((select count(*)::int from public.work_cards where id=pg_temp.card('Reach SEO')),0,'not by its id either');
select is((select count(*)::int from public.work_cards where title='Reach Ads'),1,'and reads the Card of the Agent shown to them');
select ok(not public.can_see_card('10000000-0000-0000-0000-000000000001',pg_temp.card('Reach SEO')),'the Card rule answers that they do not see it');
select ok(public.can_see_card('10000000-0000-0000-0000-000000000001',pg_temp.card('Reach Ads')),'and that they see the Ads Card');
select is(pg_temp.retitle(pg_temp.card('Reach SEO'),'Reach SEO changed'),0,
 'a direct update of it by its id changes nothing');
select throws_ok($$select public.move_card('10000000-0000-0000-0000-000000000001',pg_temp.card('Reach SEO'),'planned')$$,'P0002','card not found or not permitted',
 'move_card answers as for a Card that does not exist');
select throws_ok($$select public.move_card('10000000-0000-0000-0000-000000000001',pg_temp.card('Reach Ads'),'ideas',pg_temp.card('Reach SEO'))$$,'22023',null,
 'nor is the hidden Card a place to land above');
select throws_ok($$select public.undo_card_move('10000000-0000-0000-0000-000000000001',pg_temp.card('Reach Undo'))$$,'P0002','card not found or not permitted',
 'undo_card_move refuses the Contributor''s own move once the Card''s Agent is hidden from them');
select throws_ok($$select public.edit_work_card('10000000-0000-0000-0000-000000000001',pg_temp.card('Reach SEO'),'{"title":"x"}'::jsonb)$$,'P0001','card not found or not permitted',
 'edit_work_card answers as for a Card that does not exist');
select throws_ok($$select public.change_work_card('10000000-0000-0000-0000-000000000001',pg_temp.card('Reach SEO'),'comment','{"body":"x"}'::jsonb)$$,'P0002','card not found or not permitted',
 'change_work_card answers as for a Card that does not exist');
select throws_ok($$insert into public.work_comments(company_id,card_id,body) values('10000000-0000-0000-0000-000000000001',pg_temp.card('Reach SEO'),'hello')$$,'42501',null,
 'nothing is written on it');
select lives_ok($$select public.move_card('10000000-0000-0000-0000-000000000001',pg_temp.card('Reach Ads'),'progress')$$,'move_card moves the Card whose Agent they see');
select is(public.undo_card_move('10000000-0000-0000-0000-000000000001',pg_temp.card('Reach Ads')),'ideas','and undo_card_move puts it back');

select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select is((select count(*)::int from public.work_cards where id in (pg_temp.card('Reach SEO'),pg_temp.card('Reach Owner'))),2,'the Owner reads the hidden Agent''s Cards');
select is((select title from public.work_cards where id=pg_temp.card('Reach SEO')),'Reach SEO','the Contributor''s update changed nothing');
select is((select status from public.work_cards where id=pg_temp.card('Reach SEO')),'ideas','nor did their moves');
select lives_ok($$select public.move_card('10000000-0000-0000-0000-000000000001',pg_temp.card('Reach SEO'),'progress')$$,'the Owner moves it');
select lives_ok($$select public.move_card('10000000-0000-0000-0000-000000000001',pg_temp.card('Reach Owner'),'planned')$$,'and another of the hidden Agent''s Cards');
select is(public.undo_card_move('10000000-0000-0000-0000-000000000001',pg_temp.card('Reach Owner')),'ideas','and undoes their own move');
select is(pg_temp.retitle(pg_temp.card('Reach SEO'),'Reach SEO, edited'),1,
 'and updates it directly');
select * from finish();
rollback;
