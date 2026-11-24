begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
-- #602: a handover whose asked Agent's model call could not succeed (#530's causes) tells the Agent that asked why, in
-- the words the channel and the chat use, and what the Owner can fix, so its reply can say so. A leg that failed for
-- another reason, was stopped or was lost reads as before. RS Learning: Lead on the Company's own profile, Ads and
-- Writer on profiles of their own; the Owner talks to Lead.
insert into public.agent_profiles(agent_id,company_id,tools_confirmed,skills_shared) values
 ('a6020000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001',true,true),
 ('a6020000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001',true,true);
insert into public.hermes_agents(id,company_id,connection_id,name,speciality,is_default,profile,instructions) values
 ('a6020000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','f6020000-0000-0000-0000-000000000011','Lead','General',true,'co-10000000000000000000000000000001','Lead the team.'),
 ('a6020000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001','f6020000-0000-0000-0000-000000000012','Ads','Ads',false,'ag-a6020000000000000000000000000012','Run the Meta ads.'),
 ('a6020000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001','f6020000-0000-0000-0000-000000000013','Writer','Posts',false,'ag-a6020000000000000000000000000013','Write the posts.');
insert into public.company_profiles(company_id,profile,skills_shared,tools_confirmed) values
 ('10000000-0000-0000-0000-000000000001','co-10000000000000000000000000000001',true,true);
insert into public.conversations(id,company_id,person_id,agent_id,agent_name) values
 ('c6020000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','a6020000-0000-0000-0000-000000000011','Lead');
insert into public.conversation_messages(company_id,conversation_id,author,person_id,author_name,body,send_key,run_id) values
 ('10000000-0000-0000-0000-000000000001','c6020000-0000-0000-0000-000000000001','person','20000000-0000-0000-0000-000000000001','Omar','Plan the March intake',gen_random_uuid(),'run-owner');

-- Lead handed a job to Ads once per ending; each leg ended and waits for Lead's follow-up.
insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,state,target_outcome,return_started_at)
 select '10000000-0000-0000-0000-000000000001','c6020000-0000-0000-0000-000000000001','run-owner','call-'||o,
  'a6020000-0000-0000-0000-000000000011','a6020000-0000-0000-0000-000000000012','Plan the ads ('||o||')','returning',o,now()
 from unnest(array['no_model','no_credit','key_refused','model_missing','no_access','failed','stopped','lost']) o;
create temporary table followed(outcome text, input text);
insert into followed select substr(h.call_id,6), b.input from public.agent_handovers h, public.begin_handover(h.id) b where h.run_id='run-owner' and h.parent_id is null;

select is((select input from followed where outcome='no_model') like
 '%Ads in this conversation, and it did not finish: it could not reply, because the company has no AI subscription or model key connected yet. The Owner can connect one in Providers.%',true,
 'with no model, Lead hears that none is connected and where the Owner connects one');
select is((select input from followed where outcome='no_credit') like
 '%it could not reply, because the company''s model key has no credit left. The Owner can check Ads''s model in Providers.%',true,
 'out of credit, Lead hears the key has no credit left');
select is((select input from followed where outcome='key_refused') like
 '%it could not reply, because the model provider refused the company''s key or sign-in. The Owner can check Ads''s model in Providers.%',true,
 'a refused key, Lead hears the provider refused it');
select is((select input from followed where outcome='model_missing') like
 '%it could not reply, because its model is not available from the provider. The Owner can check Ads''s model in Providers.%',true,
 'a missing model, Lead hears it is not available');
select is((select input from followed where outcome='no_access') like
 '%it could not reply, because every account it can use has run out of usage for now. The Owner can add an account or choose a fallback model in Providers.%',true,
 'every account out of usage, Lead hears so and what the Owner can add');
select is((select string_agg(outcome,',' order by outcome) from followed
 where input like '%say the job did not finish and why, and what you suggest.%'),
 'failed,key_refused,lost,model_missing,no_access,no_credit,no_model,stopped','and is asked to say why in its reply');
select is((select string_agg(outcome||':'||(regexp_match(input,'did not finish: it ([^\n]*)'))[1],' | ' order by outcome) from followed where outcome in ('failed','stopped','lost')),
 'failed:failed before reporting anything. | lost:could not be found before reporting anything. | stopped:was stopped before reporting anything.',
 'a leg that failed otherwise, was lost or was stopped reads as before');

-- A chain: Writer handed parts of its job on; one asked Agent ran out of credit. Writer's answer Run names the cause.
insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,state,target_run)
 values('10000000-0000-0000-0000-000000000001','c6020000-0000-0000-0000-000000000001','run-owner','call-chain',
  'a6020000-0000-0000-0000-000000000011','a6020000-0000-0000-0000-000000000013','Write the March post','handing','run-writer');
insert into public.agent_handovers(company_id,conversation_id,run_id,call_id,from_agent,to_agent,goal,state,target_outcome,parent_id,closed_at)
 select '10000000-0000-0000-0000-000000000001','c6020000-0000-0000-0000-000000000001','run-writer','call-'||o,
  'a6020000-0000-0000-0000-000000000013','a6020000-0000-0000-0000-000000000012','The numbers ('||o||')','done',o,
  (select id from public.agent_handovers where call_id='call-chain'),now()
 from unnest(array['no_credit','failed']) o;
select is((select (input like '%Ads did not finish: it could not reply, because the company''s model key has no credit left. The Owner can check Ads''s model in Providers.%')
  and (input like '%Ads did not finish: it failed before answering.%')
 from public.begin_handover((select id from public.agent_handovers where call_id='call-chain'))),true,
 'an asked Agent whose jobs it handed on could not reach their model hears why, and a plain failure as before');
select * from finish();
rollback;
