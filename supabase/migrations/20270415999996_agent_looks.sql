-- #696 (spec #694, ADR 0027; GLOSSARY: Look, Temperament): every Agent's look, its shape, colour and temperament, given
-- once in the transaction that makes the Agent and kept by the Agent's id, apart from what is removed with the Agent, so
-- a Conversation, a Handover or a log row of a removed Agent still finds its face. Each part keeps the value it was
-- given (auto_*) beside the Owner's pick (picked_*, null while automatic), so "Reset to automatic" needs no guess; the
-- face draws shape, colour and temperament, the pick when there is one.
--
-- Automatic: the main Agent is indigo and calm. Any other Agent takes the colour its Company's Agents use least, indigo
-- last; its temperament is the one Lead gave for it (lead_agent_temperament), else its ready-made role's, else the one
-- its Company's Agents use least. Shape starts as the circle. An Agent request is given its look when it is asked for,
-- by the id the Agent it asks for will have (lead_agent_id), so the request's card and the made Agent have one face; a
-- waiting request's colour counts as used.
--
-- Only adds (ADR 0023): two tables, a trigger on hermes_agents that gives each Agent made from here on its look (the
-- previous release's calls included), and new functions; lead_request_agent keeps its
-- signature and meaning. Every Agent already there is given its look below.

-- The fixed lists, in the order an automatic pick breaks a tie. Keys are the prototype's (design-reference-orb).
create function public.agent_look_choices(part text) returns text[] language sql immutable set search_path='' as $$
 select case part when 'shape' then array['circle','squircle','blob']
  when 'colour' then array['indigo','violet','sky','teal','jade','rose','dusk','slate']
  when 'temperament' then array['calm','energetic','warm','dreamy','neat','caring'] end;
$$;
revoke all on function public.agent_look_choices(text) from public,anon;
grant execute on function public.agent_look_choices(text) to authenticated,service_role;

-- A ready-made role's temperament (lib/role-templates.mjs): ads energetic (Reach), the ad reviewer caring (Hook), the
-- article writer dreamy (Writer), numbers neat, the coder calm.
create function public.agent_role_temperament(template text) returns text language sql immutable set search_path='' as $$
 select case template when 'meta' then 'energetic' when 'hook' then 'caring' when 'writer' then 'dreamy'
  when 'numbers' then 'neat' when 'coder' then 'calm' end;
$$;
revoke all on function public.agent_role_temperament(text) from public,anon,authenticated,service_role;

create table public.agent_looks (
 agent_id uuid primary key,
 company_id uuid not null references public.companies(id) on delete cascade,
 -- The request whose card shows this look before its Agent is made.
 request_id bigint unique references public.lead_agent_requests(id) on delete set null,
 auto_shape text not null check (auto_shape=any(public.agent_look_choices('shape'))),
 auto_colour text not null check (auto_colour=any(public.agent_look_choices('colour'))),
 auto_temperament text not null check (auto_temperament=any(public.agent_look_choices('temperament'))),
 picked_shape text check (picked_shape=any(public.agent_look_choices('shape'))),
 picked_colour text check (picked_colour=any(public.agent_look_choices('colour'))),
 picked_temperament text check (picked_temperament=any(public.agent_look_choices('temperament'))),
 shape text generated always as (coalesce(picked_shape,auto_shape)) stored,
 colour text generated always as (coalesce(picked_colour,auto_colour)) stored,
 temperament text generated always as (coalesce(picked_temperament,auto_temperament)) stored,
 given_at timestamptz not null default now(),
 changed_at timestamptz
);
create index agent_looks_company on public.agent_looks(company_id);
alter table public.agent_looks enable row level security;
-- It names nobody and tells nothing of the Agent's work (ADR 0027): every Member of the Company reads every look, a
-- hidden Agent's included, whose face shows in shared channels. Nobody writes the table but the functions below.
create policy agent_looks_members_read on public.agent_looks for select to authenticated using (public.is_member(company_id));
revoke all on table public.agent_looks from public,anon,authenticated,service_role;
grant select on table public.agent_looks to authenticated;

-- The temperament Lead gives the Agent its create_agent or request_agent call will make, kept by that Agent's id until
-- the Agent or the request is given its look. Only the worker writes it, through lead_agent_temperament.
create table public.lead_agent_temperaments (
 agent_id uuid primary key,
 company_id uuid not null references public.companies(id) on delete cascade,
 temperament text not null check (temperament=any(public.agent_look_choices('temperament'))),
 given_at timestamptz not null default now()
);
alter table public.lead_agent_temperaments enable row level security;
revoke all on table public.lead_agent_temperaments from public,anon,authenticated,service_role;

-- Lead's call, before the call that makes or requests the Agent (lib/agent-tools.mjs). A value off the list is refused
-- in words Lead can act on; a call that is not one of the Conversation's runs keeps nothing. The first temperament given
-- for a call stands, so a closer that carries the call out again changes nothing.
create function public.lead_agent_temperament(conversation uuid, run text, call text, temperament text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
 if temperament is null or not (temperament=any(public.agent_look_choices('temperament'))) then
  return jsonb_build_object('state','invalid','reason',
   'The temperament must be one of calm, energetic, warm, dreamy, neat or caring, or left out. Nothing was made; call again with one of them, or without it.');
 end if;
 select v.company_id into c from public.conversations v where v.id=conversation
  and exists(select 1 from public.conversation_messages m where m.conversation_id=v.id and m.author='person' and m.run_id=run);
 if c is null then return jsonb_build_object('state','refused'); end if;
 insert into public.lead_agent_temperaments(agent_id,company_id,temperament) values(public.lead_agent_id(conversation,run,call),c,temperament)
  on conflict (agent_id) do nothing;
 return jsonb_build_object('state','kept');
end $$;
revoke all on function public.lead_agent_temperament(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.lead_agent_temperament(uuid,text,text,text) to service_role;

-- A look its Company counts as used: its Agent's, while the Agent is there, or a waiting request's.
create function public.agent_look_in_use(look public.agent_looks) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hermes_agents a where a.id=look.agent_id and a.company_id=look.company_id)
  or exists(select 1 from public.lead_agent_requests r where r.id=look.request_id and r.state='waiting');
$$;
revoke all on function public.agent_look_in_use(public.agent_looks) from public,anon,authenticated,service_role;

-- Gives `agent` its look, once: an Agent or request that has one keeps it. Under the Company's look lock, so two Agents
-- made at once wait for each other and never take one colour.
create function public.give_agent_look(c uuid, agent uuid, main boolean, template text, request bigint default null) returns void
language plpgsql security definer set search_path='' as $$
declare hue text; mood text;
begin
 perform pg_advisory_xact_lock(hashtextextended('agent_looks:'||c::text,0));
 if exists(select 1 from public.agent_looks l where l.agent_id=agent) then return; end if;
 if main then hue:='indigo'; mood:='calm';
 else
  with used as (select l.colour from public.agent_looks l where l.company_id=c and public.agent_look_in_use(l))
  select o.k into hue from unnest(public.agent_look_choices('colour')) with ordinality o(k,n)
   order by (select count(*) from used u where u.colour=o.k),o.k='indigo',o.n limit 1;
  mood:=coalesce((select t.temperament from public.lead_agent_temperaments t where t.agent_id=agent and t.company_id=c),
   public.agent_role_temperament(template),
   (with used as (select l.temperament from public.agent_looks l where l.company_id=c and public.agent_look_in_use(l))
    select o.k from unnest(public.agent_look_choices('temperament')) with ordinality o(k,n)
    order by (select count(*) from used u where u.temperament=o.k),o.n limit 1));
 end if;
 insert into public.agent_looks(agent_id,company_id,request_id,auto_shape,auto_colour,auto_temperament) values(agent,c,request,'circle',hue,mood);
end $$;
revoke all on function public.give_agent_look(uuid,uuid,boolean,text,bigint) from public,anon,authenticated,service_role;

-- Every Agent made, by any path and by either release, gets its look in the transaction that makes it.
create function public.give_made_agent_look() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform public.give_agent_look(new.company_id,new.id,new.is_default,new.template);
 return null;
end $$;
revoke all on function public.give_made_agent_look() from public,anon,authenticated,service_role;
create trigger agent_look_given after insert on public.hermes_agents for each row execute function public.give_made_agent_look();

-- The Owner changes one part of an Agent's look: `choice` is a value of that part's list, or null for automatic again.
-- Only an Owner of the Agent's Company, for an Agent it has now; one row of the Activity log for each change, none when
-- nothing changed. Answers the look as it now stands.
create function public.change_agent_look(c uuid, agent uuid, part text, choice text) returns public.agent_looks
language plpgsql security definer set search_path='' as $$
declare was public.agent_looks; now_is public.agent_looks;
begin
 if not public.is_company_owner(c) then raise exception 'agentLookNotAllowed' using errcode='42501'; end if;
 if part is null or part not in ('shape','colour','temperament') or (choice is not null and not (choice=any(public.agent_look_choices(part)))) then
  raise exception 'agentLookInvalid' using errcode='22023';
 end if;
 if not exists(select 1 from public.hermes_agents a where a.id=agent and a.company_id=c) then raise exception 'agentLookNotFound' using errcode='P0002'; end if;
 perform pg_advisory_xact_lock(hashtextextended('agent_looks:'||c::text,0));
 select * into was from public.agent_looks l where l.agent_id=agent and l.company_id=c;
 if not found then raise exception 'agentLookNotFound' using errcode='P0002'; end if;
 if (case part when 'shape' then was.picked_shape when 'colour' then was.picked_colour else was.picked_temperament end) is not distinct from choice then return was; end if;
 update public.agent_looks l set
  picked_shape=case when part='shape' then choice else l.picked_shape end,
  picked_colour=case when part='colour' then choice else l.picked_colour end,
  picked_temperament=case when part='temperament' then choice else l.picked_temperament end,
  changed_at=now()
  where l.agent_id=agent returning * into now_is;
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(c,auth.uid(),public.log_actor_kind(c,auth.uid()),(select name from public.people where id=auth.uid()),'agent',agent,'agent_look_changed',
   jsonb_build_object('agent_name',(select a.name from public.hermes_agents a where a.id=agent),'part',part,
    'from',case part when 'shape' then was.shape when 'colour' then was.colour else was.temperament end,
    'to',case part when 'shape' then now_is.shape when 'colour' then now_is.colour else now_is.temperament end,
    'automatic',choice is null),
   'hermes_agent_audit',nextval('public.agent_log_ids'),now());
 return now_is;
end $$;
revoke all on function public.change_agent_look(uuid,uuid,text,text) from public,anon,service_role;
grant execute on function public.change_agent_look(uuid,uuid,text,text) to authenticated;

-- A request is given the look its Agent will be made with, as it is kept: lead_request_agent's current body (20261223000000,
-- its log line moved by 20270213000000) with one line more, and its signature and answers as they were.
do $$
declare def text; logged text:=$r$perform public.log_agent_event(talk.company_id,talk.person_id,(select name from public.people where id=talk.person_id),talk.agent_id,'AGENT_REQUEST_SENT',$r$;
begin
 def:=pg_get_functiondef('public.lead_request_agent(uuid,text,text,text,text,text[],text,text)'::regprocedure);
 if position(logged in def)=0 then raise exception 'lead_request_agent changed: %',def; end if;
 execute replace(def,logged,'perform public.give_agent_look(talk.company_id,public.lead_agent_id(conversation,run,call),false,template,kept.id);'||chr(10)||'  '||logged);
end $$;

-- Every Agent already there, each Company's main Agent first and then the others as they were made, so no colour comes
-- twice while a Company has eight or fewer.
do $$ declare a record; begin
 for a in select h.id,h.company_id,h.is_default,h.template from public.hermes_agents h order by h.company_id,h.is_default desc,h.created_at nulls first,h.id loop
  perform public.give_agent_look(a.company_id,a.id,a.is_default,a.template);
 end loop;
end $$;
