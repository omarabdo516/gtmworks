import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// One log for the Company (#11): the earlier Card comments and Card activity land in the log with their original
// author and time. Inside one rolled-back transaction the log is taken away again, a Card comment and a Card change
// from two days ago are seeded with their authors, the real migration runs, and the migrated rows and the verify file
// are read back.
const migration=readFileSync('supabase/migrations/20261207000000_company_log.sql','utf8');
const verify=readFileSync('supabase/migrations/20261207000000_company_log.verify.sql','utf8').trim().replace(/;$/,'');
const rs='10000000-0000-0000-0000-000000000001', omar='20000000-0000-0000-0000-000000000001', writer='30000000-0000-0000-0000-000000000001';
const sql=`begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
drop table public.company_log;
drop function public.refuse_log_change(), public.log_card_activity(), public.log_card_comment(), public.log_member_change(), public.log_agent_change() cascade;
drop function public.log_actor_kind(uuid,uuid), public.log_member_details(text,jsonb,jsonb), public.log_member_action(text), public.log_agent_action(text);
-- The earlier records: a comment written by Omar and a stage move made by the writer Agent, both two days old.
select set_config('request.jwt.claim.sub','${omar}',true);
insert into public.work_comments(id,company_id,card_id,body,created_at) overriding system value
 values(911001,'${rs}',(select min(id) from public.work_cards where company_id='${rs}'),'تعليق قديم','2026-11-11 09:30:00+00');
insert into public.work_activity(id,company_id,card_id,actor_id,action,details,created_at) overriding system value
 values(911002,'${rs}',(select min(id) from public.work_cards where company_id='${rs}'),'${writer}','card_changed','{"field":"stage_id","old":1,"new":2,"old_name":"أفكار","new_name":"كتابة"}','2026-11-11 10:15:00+00');
select ok(to_regclass('public.company_log') is null,'before the migration there is no log');
${migration}
select is((select concat_ws('|',actor_id::text,actor_kind,actor_name,action,body,created_at::text) from public.company_log where source='work_comments' and source_id=911001),
 '${omar}|person|عمر|note|تعليق قديم|2026-11-11 09:30:00+00','an earlier comment is in the log with its author, its text and its time');
select is((select concat_ws('|',actor_id::text,actor_kind,action,details->>'new_name',created_at::text) from public.company_log where source='work_activity' and source_id=911002),
 '${writer}|agent|card_changed|كتابة|2026-11-11 10:15:00+00','an earlier Card change is in the log with its Agent and its time');
select is((select count(*)::int from public.company_log where source='work_activity' and source_id in (select id from public.work_activity where action='comment_added')),0,'the comment is not copied a second time as activity');
select is((select count(*)::int from public.company_log where source='member_audit'),(select count(*)::int from public.member_audit),'every earlier Member change is in the log');
select is((select count(*)::int from public.company_log where source='hermes_agent_audit'),(select count(*)::int from public.hermes_agent_audit),'every earlier Agent change is in the log');
select is((select (array_agg(source order by created_at desc, id desc))[1] from public.company_log where card_id=(select min(id) from public.work_cards where company_id='${rs}') and created_at<'2026-11-12'),'work_activity','the log orders the earlier rows by their own time');
select is((select string_agg(key||'='||value,',' order by key) from (${verify}) v, json_each_text(v.json_build_object) where value<>'true'),null,'every verify check passes after the migration');
select * from finish();
rollback;
`;
const dir=mkdtempSync(join(tmpdir(),'gtmworks-company-log-'));
try {
 const file=join(dir,'migration.sql'); writeFileSync(file,sql);
 const result=spawnSync('npx',['--no-install','supabase','test','db',file],{stdio:'inherit'});
 process.exitCode=result.status ?? 1;
} finally { rmSync(dir,{recursive:true,force:true}); }
