-- #484: "Edit, then approve" on a proposed change (design-reference: chgHTML's edit form, chg-edit and approveChg with
-- `edited`). The Owner changes the value an Agent proposed before approving it: another model from the profile's Engine
-- list, other instructions, the sub-agents switch the other way, or another value of the listed setting. The proposal
-- keeps what the Agent proposed (`value`) and, beside it, what the Owner approved instead (`approved_value`), so the
-- chat, "Waiting on you" and the Company log say both. Nothing else about answering changes (20270415000000): the
-- Owner claims the proposal, the app writes the claimed value through #125's and #176's writers to that Agent's own
-- profile, and only then marks it approved.
--
-- `approved_value` is set only by a claim: claim_agent_change(c, proposal, edited) checks the edit as a proposal's
-- value is checked (agent_change_value_valid), and keeps it only when it differs from the proposed value, so an edit
-- that changes nothing approves as proposed. Each claim names its own value, so approving again after an unconfirmed
-- write writes what that approval says. A claim given back before anything reached the Engine drops the edit with it;
-- one that may have reached the Engine keeps it, and so does a decline of such a claim, which says the earlier approval
-- may already be in the Agent's settings.
--
-- The previous app version runs against this unchanged: it calls claim_agent_change(c, proposal), which approves as
-- proposed, and reads `value` from the claim, which is the value to write.

alter table public.agent_change_proposals add column approved_value jsonb,
 add constraint agent_change_proposals_approved_value check (approved_value is null or (approved_value<>value
  and public.agent_change_value_valid(change,approved_value) and (state in ('applying','approved') or (state='declined' and maybe_applied))));

create function public.claim_agent_change(c uuid, proposal bigint, edited jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare asked public.agent_change_proposals; token uuid:=gen_random_uuid(); chosen jsonb;
begin
 if not public.is_company_owner(c) then raise exception 'agentChangeNotAllowed' using errcode='42501'; end if;
 select * into asked from public.agent_change_proposals p where p.id=proposal and p.company_id=c for update;
 if not found then raise exception 'agentChangeNotFound' using errcode='P0002'; end if;
 if asked.state in ('approved','declined','refused') then return jsonb_build_object('state',asked.state); end if;
 if asked.state='applying' and asked.claimed_at>now()-interval '5 minutes' then return jsonb_build_object('state','busy'); end if;
 if edited is not null and not public.agent_change_value_valid(asked.change,edited) then raise exception 'agentChangeEditInvalid' using errcode='22023'; end if;
 chosen:=case when edited is null or edited=asked.value then null else edited end;
 update public.agent_change_proposals set state='applying',claimed_by=auth.uid(),claimed_at=now(),claim_token=token,approved_value=chosen where id=asked.id;
 return jsonb_build_object('state','claimed','token',token,'retry',asked.state='applying','agent',asked.agent_id,'change',asked.change,
  'setting',asked.setting,'value',coalesce(chosen,asked.value),'edited',chosen is not null);
end $$;
revoke all on function public.claim_agent_change(uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function public.claim_agent_change(uuid,bigint,jsonb) to authenticated;

-- The previous app's claim approves as proposed. Its answer keeps the keys it had (no `edited`).
create or replace function public.claim_agent_change(c uuid, proposal bigint) returns jsonb
language sql security definer set search_path='' as $$
 select public.claim_agent_change(c,proposal,null::jsonb)-'edited';
$$;

create or replace function public.release_agent_change(c uuid, proposal bigint, claim uuid, uncertain boolean default false) returns void
language sql security definer set search_path='' as $$
 update public.agent_change_proposals
  set state=case when uncertain then 'applying' else 'waiting' end,
   claimed_by=case when uncertain then claimed_by end,
   claimed_at=case when uncertain then now()-interval '5 minutes' end,
   claim_token=case when uncertain then claim_token end,
   approved_value=case when uncertain then approved_value end
  where id=proposal and company_id=c and state='applying' and claim_token=claim and claimed_by=auth.uid() and public.is_company_owner(c);
$$;

-- 20270415000000's answer, with the Owner's edit: an approval logs the value the Engine now holds and, when the Owner
-- changed it, the value the Agent proposed; a decline of a claim that may have reached the Engine keeps that claim's
-- edit, and any other decline has none.
create or replace function public.answer_agent_change(c uuid, proposal bigint, approve boolean, reason text default null, claim uuid default null) returns text
language plpgsql security definer set search_path='' as $$
declare asked public.agent_change_proposals; wanted text:=case when approve then 'approved' when not approve then 'declined' end;
 said text:=nullif(btrim(coalesce(reason,''),E' \t\r\n'),''); edited boolean;
begin
 if wanted is null then raise exception 'agentChangeAnswerMissing' using errcode='22023'; end if;
 if not public.is_company_owner(c) then raise exception 'agentChangeNotAllowed' using errcode='42501'; end if;
 select * into asked from public.agent_change_proposals p where p.id=proposal and p.company_id=c for update;
 if not found then raise exception 'agentChangeNotFound' using errcode='P0002'; end if;
 if asked.state=wanted then return wanted; end if;
 if approve and not (asked.state='applying' and asked.claimed_by=auth.uid() and asked.claim_token=claim) then
  raise exception '%',case asked.state when 'waiting' then 'agentChangeNotClaimed' when 'applying' then 'agentChangeBusy' else 'agentChangeAnswered' end using errcode='22023';
 end if;
 if not approve and asked.state='applying' and asked.claimed_at>now()-interval '5 minutes' then raise exception 'agentChangeApplying' using errcode='22023'; end if;
 if not approve and asked.state not in ('waiting','applying') then raise exception 'agentChangeAnswered' using errcode='22023'; end if;
 if said is not null and length(said)>1000 then raise exception 'agentChangeReasonLong' using errcode='22023'; end if;
 if not approve and said is null and not exists(select 1 from public.companies co where co.id=c and co.work_mode='alone') then
  raise exception 'agentChangeReasonMissing' using errcode='22023';
 end if;
 edited:=approve and asked.approved_value is not null;
 update public.agent_change_proposals set state=wanted,answered_by=auth.uid(),answered_at=now(),answer=case when approve then null else said end,
  maybe_applied=(not approve and asked.state='applying'),claim_token=null,claimed_at=null,claimed_by=null,
  approved_value=case when approve or asked.state='applying' then approved_value end where id=asked.id;
 perform public.log_agent_event(c,auth.uid(),null,asked.agent_id,case when approve then 'AGENT_CHANGE_APPROVED' else 'AGENT_CHANGE_DECLINED' end,
  jsonb_build_object('setting',coalesce(asked.setting,asked.change),
   'new',case when asked.change='instructions' then null when edited then asked.approved_value else asked.value end,
   'reason',case when approve then null else said end,'asked_by',(select a.name from public.hermes_agents a where a.id=asked.proposed_by),
   'private','owners','teller',asked.asked_by)
  ||case when edited then jsonb_build_object('edited',true,'proposed',case when asked.change='instructions' then null else asked.value end) else '{}'::jsonb end);
 return wanted;
end $$;

-- The Agent's log row carries the two keys an edited approval adds: the value the Agent proposed and that it was edited.
create or replace function public.log_agent_event(c uuid, actor uuid, actor_name text, agent uuid, act text, details jsonb) returns void
language sql security definer set search_path='' as $$
 insert into public.company_log(company_id,actor_id,actor_kind,actor_name,subject,agent_id,action,details,source,source_id,created_at)
  values(c,actor,public.log_actor_kind(c,actor),coalesce(actor_name,(select name from public.people where id=actor)),
   'agent',agent,public.log_agent_action(act),
   jsonb_strip_nulls(jsonb_build_object('agent_name',(select name from public.hermes_agents where id=agent),'replacement_id',details->'replacement_id','job',details->'job','rule',details->'rule','taught_by',details->'taught_by','asked_for',details->'asked_for','asked_by',details->'asked_by','reason',details->'reason','private',details->'private','teller',details->'teller','skill',details->'skill','setting',details->'setting','old',details->'old','new',details->'new','routine',details->'routine','schedule',details->'schedule','change',details->'change',
    'proposed',details->'proposed','edited',details->'edited')),
   'hermes_agent_audit',nextval('public.agent_log_ids'),now());
$$;
