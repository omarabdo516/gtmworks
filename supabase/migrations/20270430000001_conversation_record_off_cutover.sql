-- #883, the cutover (ADR 0023): the Company switch of #876 leaves. From 20270430000000 on no function reads it, and the
-- release this one replaced has stopped serving, so nothing reads it at all. scripts/install.sh applies this step once this
-- release's app and worker answer. No table is dropped and no row of the old Conversation record is touched.

-- A cutover never lands in the transaction that applied its first step. An installer from before ADR 0023 applies every
-- migration in one transaction before it starts anything: it fails here, the whole transaction rolls back, and the
-- release it runs keeps serving on the schema it was built for.
do $$ begin
 if to_regclass('gtmworks_install.schema_migrations') is not null then
  if exists(select 1 from gtmworks_install.schema_migrations m where m.name='20270430000000_conversation_record_off.sql' and m.xmin=pg_current_xact_id()::xid) then
   raise exception 'This update is finished by the installer it downloaded: run sh scripts/install.sh update again. The database and the running release were not changed.';
  end if;
 end if;
end $$;

alter table public.companies drop column engine_conversations;
