create table public.work_stages (id bigint generated always as identity primary key, company_id uuid not null references public.companies(id), name text not null, position integer not null, kind text not null default 'before_review' check (kind in ('before_review','review','after_review')), unique(company_id,id));
create table public.work_labels (id bigint generated always as identity primary key, company_id uuid not null references public.companies(id), name text not null, color text not null, unique(company_id,id));
create table public.work_cards (id bigint generated always as identity primary key, company_id uuid not null references public.companies(id), stage_id bigint not null, title text not null, offering text not null default '', segment text not null default '', hook text not null default '', channel text not null default '', format text not null default '', go_live timestamptz, goal text not null default '', caption text not null default '', next_actor uuid, created_at timestamptz not null default now(), unique(company_id,id), foreign key(company_id,stage_id) references public.work_stages(company_id,id), foreign key(company_id,next_actor) references public.members(company_id,person_id));
create table public.work_checklist (id bigint generated always as identity primary key, company_id uuid not null, card_id bigint not null, title text not null, done boolean not null default false, foreign key(company_id,card_id) references public.work_cards(company_id,id));
create table public.work_card_labels (id bigint generated always as identity primary key, company_id uuid not null, card_id bigint not null, label_id bigint not null, foreign key(company_id,card_id) references public.work_cards(company_id,id), foreign key(company_id,label_id) references public.work_labels(company_id,id), unique(card_id,label_id));
create table public.work_assignees (id bigint generated always as identity primary key, company_id uuid not null, card_id bigint not null, person_id uuid not null, foreign key(company_id,card_id) references public.work_cards(company_id,id), foreign key(company_id,person_id) references public.members(company_id,person_id), unique(card_id,person_id));
create table public.work_creatives (id bigint generated always as identity primary key, company_id uuid not null, card_id bigint not null, name text not null, foreign key(company_id,card_id) references public.work_cards(company_id,id), unique(company_id,id), unique(company_id,card_id,id));
create table public.work_versions (id bigint generated always as identity primary key, company_id uuid not null, card_id bigint not null, creative_id bigint not null, path text not null, created_at timestamptz not null default now(), foreign key(company_id,card_id) references public.work_cards(company_id,id), foreign key(company_id,card_id,creative_id) references public.work_creatives(company_id,card_id,id), check (split_part(path,'/',1)=company_id::text));
create table public.work_comments (id bigint generated always as identity primary key, company_id uuid not null, card_id bigint not null, body text not null, author_id uuid references public.people(id) default auth.uid(), created_at timestamptz not null default now(), foreign key(company_id,card_id) references public.work_cards(company_id,id));
create function public.work_comment_author() returns trigger language plpgsql set search_path='' as $$ begin if auth.uid() is not null then new.author_id=auth.uid(); end if; return new; end $$;
create trigger work_comment_author_guard before insert on public.work_comments for each row execute function public.work_comment_author();
create table public.work_activity (id bigint generated always as identity primary key, company_id uuid not null, card_id bigint not null, actor_id uuid references public.people(id), action text not null, details jsonb not null default '{}'::jsonb, evidence text, created_at timestamptz not null default now(), foreign key(company_id,card_id) references public.work_cards(company_id,id));
create function public.work_defaults() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into public.work_stages(company_id,name,position,kind) select new.id,n,ord,case when ord=5 then 'review' when ord>5 then 'after_review' else 'before_review' end from unnest(array['أفكار','بريف جاهز','كتابة','تصميم ومونتاج','مراجعة','معتمد','مجدول للنشر','منشور','إعلانات شغالة']) with ordinality as x(n,ord);
 insert into public.work_labels(company_id,name,color) select new.id,n,c from (values ('static','#87bba2'),('reel','#bd8d81'),('carosel','#cdbb78'),('Paid','#a58bc1'),('content','#83a6be'),('Campaign','#d6a76f'),('Urgent','#d78484'),('Website','#8abbb7')) x(n,c); return new; end $$;
create trigger company_work_defaults after insert on public.companies for each row execute function public.work_defaults();
insert into public.work_stages(company_id,name,position,kind) select c.id,n,ord,case when ord=5 then 'review' when ord>5 then 'after_review' else 'before_review' end from public.companies c cross join unnest(array['أفكار','بريف جاهز','كتابة','تصميم ومونتاج','مراجعة','معتمد','مجدول للنشر','منشور','إعلانات شغالة']) with ordinality as x(n,ord);
insert into public.work_labels(company_id,name,color) select c.id,n,col from public.companies c cross join (values ('static','#87bba2'),('reel','#bd8d81'),('carosel','#cdbb78'),('Paid','#a58bc1'),('content','#83a6be'),('Campaign','#d6a76f'),('Urgent','#d78484'),('Website','#8abbb7')) x(n,col);
create function public.work_can_edit(c uuid) returns boolean language sql stable security definer set search_path='' as $$ select public.agency_access() or exists(select 1 from public.members where company_id=c and person_id=auth.uid() and removed_at is null and role in ('owner','manager','contributor')); $$;
create function public.work_guard() returns trigger language plpgsql security definer set search_path='' as $$ declare stage_kind text; previous_kind text; begin
 if tg_op='UPDATE' and new.company_id<>old.company_id then raise exception 'company cannot change'; end if;
 if (tg_op='INSERT' or new.stage_id<>old.stage_id) and auth.uid() is not null and not public.can_manage_company(new.company_id) then
 select kind into stage_kind from public.work_stages where id=new.stage_id and company_id=new.company_id;
 if tg_op='UPDATE' then select kind into previous_kind from public.work_stages where id=old.stage_id and company_id=old.company_id; end if;
 if stage_kind='after_review' or previous_kind='after_review' then raise exception 'contributors cannot move beyond review'; end if; end if; return new; end $$;
create function public.guard_work_stage_kind() returns trigger language plpgsql set search_path='' as $$ begin if new.kind<>old.kind or new.company_id<>old.company_id then raise exception 'stage identity cannot change'; end if; return new; end $$;
create trigger work_stage_kind_guard before update on public.work_stages for each row execute function public.guard_work_stage_kind();
create trigger work_card_guard before insert or update on public.work_cards for each row execute function public.work_guard();
create function public.work_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare rowdata jsonb; previous jsonb; cid bigint; company uuid; field text; ev text; details jsonb; action_name text; begin
 rowdata=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 previous=case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
 company=(rowdata->>'company_id')::uuid; cid=case when tg_table_name='work_cards' then (rowdata->>'id')::bigint else (rowdata->>'card_id')::bigint end;
 ev=nullif(current_setting('work.evidence',true),'');
 if tg_table_name='work_cards' and tg_op='UPDATE' then
  foreach field in array array['title','stage_id','offering','segment','hook','channel','format','go_live','goal','caption','next_actor'] loop
   if rowdata->field is distinct from previous->field then
    details=jsonb_build_object('field',field,'old',previous->field,'new',rowdata->field);
    if field='stage_id' then details=details || jsonb_build_object('old_name',(select name from public.work_stages where id=(previous->>'stage_id')::bigint),'new_name',(select name from public.work_stages where id=(rowdata->>'stage_id')::bigint)); end if;
    insert into public.work_activity(company_id,card_id,actor_id,action,details,evidence) values(company,cid,auth.uid(),'card_changed',details,ev);
   end if;
  end loop;
 else
  action_name=case tg_table_name when 'work_cards' then 'card_created' when 'work_checklist' then 'checklist_changed' when 'work_card_labels' then 'label_changed' when 'work_assignees' then 'assignee_changed' when 'work_creatives' then 'creative_added' when 'work_versions' then 'version_added' when 'work_comments' then 'comment_added' end;
  if tg_table_name='work_versions' then ev=coalesce(ev,rowdata->>'path'); end if;
  insert into public.work_activity(company_id,card_id,actor_id,action,details,evidence) values(company,cid,auth.uid(),action_name,rowdata,ev);
 end if; return coalesce(new,old); end $$;
do $$ declare t text; begin foreach t in array array['work_cards','work_checklist','work_card_labels','work_assignees','work_creatives','work_versions','work_comments'] loop execute format('create trigger work_audit after insert or update or delete on public.%I for each row execute function public.work_audit()',t); end loop; end $$;
do $$ declare t text; begin foreach t in array array['work_stages','work_labels','work_cards','work_checklist','work_card_labels','work_assignees','work_creatives','work_versions','work_comments','work_activity'] loop execute format('alter table public.%I enable row level security',t); execute format('create policy work_read on public.%I for select to authenticated using (public.is_member(company_id) or public.agency_access())',t); if t not in ('work_activity','work_stages','work_labels','work_comments') then execute format('create policy work_write on public.%I for all to authenticated using (public.work_can_edit(company_id)) with check (public.work_can_edit(company_id))',t); elsif t in ('work_stages','work_labels') then execute format('create policy work_manage on public.%I for all to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id))',t); end if; end loop; end $$;
create policy work_comment_insert on public.work_comments for insert to authenticated with check (public.work_can_edit(company_id));
insert into storage.buckets(id,name,public) values ('creatives','creatives',false);
create policy creative_read on storage.objects for select to authenticated using (bucket_id='creatives' and (public.is_member(case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then (storage.foldername(name))[1]::uuid end) or public.agency_access()));
create policy creative_write on storage.objects for insert to authenticated with check (bucket_id='creatives' and public.work_can_edit(case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then (storage.foldername(name))[1]::uuid end));
create function public.create_work_card(c uuid, s bigint, card_title text, template text default '', evidence text default null) returns bigint language plpgsql security invoker set search_path='' as $$ declare result bigint; label_name text; item text; begin
 if not public.work_can_edit(c) then raise exception 'not permitted'; end if;
 perform set_config('work.evidence',coalesce(evidence,''),true);
 insert into public.work_cards(company_id,stage_id,title,format) values(c,s,card_title,case template when 'reel' then 'ريل' when 'carosel' then 'كاروسيل' when 'static' then 'بوست' else '' end) returning id into result;
 if template in ('reel','carosel','static') then
 insert into public.work_card_labels(company_id,card_id,label_id) select c,result,id from public.work_labels where company_id=c and name=template;
 foreach item in array (case when template='reel' then array['Script Ready','Caption Written','videographer','Video Edited','Review','Approved','ScheduledPublished'] else array['TOV Ready','Caption Written','Design Finished','Review','Approved','ScheduledPublished'] end) loop insert into public.work_checklist(company_id,card_id,title) values(c,result,item); end loop; end if; return result; end $$;
create function public.move_work_card(c uuid, card bigint, stage bigint, evidence text default null) returns void language plpgsql security invoker set search_path='' as $$ begin perform set_config('work.evidence',coalesce(evidence,''),true); update public.work_cards set stage_id=stage where company_id=c and id=card; if not found then raise exception 'card not found or not permitted'; end if; end $$;
create function public.edit_work_card(c uuid, card bigint, fields jsonb, evidence text default null) returns void language plpgsql security invoker set search_path='' as $$ begin perform set_config('work.evidence',coalesce(evidence,''),true); update public.work_cards set title=coalesce(fields->>'title',title), offering=coalesce(fields->>'offering',offering), segment=coalesce(fields->>'segment',segment), hook=coalesce(fields->>'hook',hook), channel=coalesce(fields->>'channel',channel), format=coalesce(fields->>'format',format), goal=coalesce(fields->>'goal',goal), caption=coalesce(fields->>'caption',caption), go_live=case when fields ? 'go_live' and date_trunc('minute',go_live) is distinct from date_trunc('minute',nullif(fields->>'go_live','')::timestamptz) then nullif(fields->>'go_live','')::timestamptz else go_live end where company_id=c and id=card; if not found then raise exception 'card not found or not permitted'; end if; end $$;

create function public.change_work_card(c uuid, card bigint, operation text, payload jsonb, evidence text default null) returns bigint language plpgsql security invoker set search_path='' as $$ declare result bigint; begin
 if not public.work_can_edit(c) then raise exception 'not permitted'; end if;
 perform set_config('work.evidence',coalesce(evidence,''),true);
 case operation
 when 'actor' then update public.work_cards set next_actor=nullif(payload->>'person','')::uuid where company_id=c and id=card;
 when 'assignee' then insert into public.work_assignees(company_id,card_id,person_id) values(c,card,(payload->>'person')::uuid) returning id into result;
 when 'label' then insert into public.work_card_labels(company_id,card_id,label_id) values(c,card,(payload->>'label')::bigint) returning id into result;
 when 'check' then update public.work_checklist set done=(payload->>'done')::boolean where company_id=c and card_id=card and id=(payload->>'item')::bigint;
 when 'comment' then insert into public.work_comments(company_id,card_id,body) values(c,card,payload->>'body') returning id into result;
 when 'creative' then insert into public.work_creatives(company_id,card_id,name) values(c,card,payload->>'name') returning id into result;
 when 'creative_with_version' then
  insert into public.work_creatives(company_id,card_id,name) values(c,card,payload->>'name') returning id into result;
  insert into public.work_versions(company_id,card_id,creative_id,path) values(c,card,result,payload->>'path');
 when 'version' then insert into public.work_versions(company_id,card_id,creative_id,path) values(c,card,(payload->>'creative')::bigint,payload->>'path') returning id into result;
 else raise exception 'unknown operation'; end case;
 if not found then raise exception 'card or item not found'; end if; return result; end $$;
