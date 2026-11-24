-- #697 (spec #694, story 13): a ready-made role's face in the gallery is the face the Agent gets. The automatic colour
-- and temperament an Agent that is not main would take now is one function, agent_look_auto, which give_agent_look
-- (20270415999996) gives the made Agent and ready_made_looks shows a Member for each role before it is added. Lead's
-- temperament for a call still comes first, as it did.
--
-- Only adds (ADR 0023): two functions, and give_agent_look's body with its choice moved into the first; its signature,
-- lock and answers are as they were.

-- The colour the Company's Agents use least, indigo last, and the role's temperament, else the one they use least.
create function public.agent_look_auto(c uuid, template text) returns table(colour text, temperament text)
language sql stable security definer set search_path='' as $$
 with used as (select l.colour,l.temperament from public.agent_looks l where l.company_id=c and public.agent_look_in_use(l))
 select
  (select o.k from unnest(public.agent_look_choices('colour')) with ordinality o(k,n)
    order by (select count(*) from used u where u.colour=o.k),o.k='indigo',o.n limit 1),
  coalesce(public.agent_role_temperament(template),
   (select o.k from unnest(public.agent_look_choices('temperament')) with ordinality o(k,n)
     order by (select count(*) from used u where u.temperament=o.k),o.n limit 1));
$$;
revoke all on function public.agent_look_auto(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.give_agent_look(c uuid, agent uuid, main boolean, template text, request bigint default null) returns void
language plpgsql security definer set search_path='' as $$
declare hue text; mood text;
begin
 perform pg_advisory_xact_lock(hashtextextended('agent_looks:'||c::text,0));
 if exists(select 1 from public.agent_looks l where l.agent_id=agent) then return; end if;
 if main then hue:='indigo'; mood:='calm';
 else
  select a.colour,coalesce((select t.temperament from public.lead_agent_temperaments t where t.agent_id=agent and t.company_id=c),a.temperament)
   into hue,mood from public.agent_look_auto(c,template) a;
 end if;
 insert into public.agent_looks(agent_id,company_id,request_id,auto_shape,auto_colour,auto_temperament) values(agent,c,request,'circle',hue,mood);
end $$;
revoke all on function public.give_agent_look(uuid,uuid,boolean,text,bigint) from public,anon,authenticated,service_role;

-- The look each ready-made role would be made with now, for a Member of the Company (app/ready-made: the gallery). It
-- tells no more than the looks every Member reads already.
create function public.ready_made_looks(c uuid, templates text[]) returns table(template text, shape text, colour text, temperament text)
language sql stable security definer set search_path='' as $$
 select t.k,'circle',a.colour,a.temperament from unnest(templates) t(k) cross join lateral public.agent_look_auto(c,t.k) a
 where public.is_member(c);
$$;
revoke all on function public.ready_made_looks(uuid,text[]) from public,anon,service_role;
grant execute on function public.ready_made_looks(uuid,text[]) to authenticated;
