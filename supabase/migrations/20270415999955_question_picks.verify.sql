-- A several-pick question takes its picks (#648): answer_question takes them, only its person may call it, and a card
-- keeps them as an array of its choices.
select json_build_object(
 'picks_by_person_only',has_function_privilege('authenticated','public.answer_question(uuid,uuid,bigint,integer,text,uuid,integer[])','execute')
  and not has_function_privilege('anon','public.answer_question(uuid,uuid,bigint,integer,text,uuid,integer[])','execute')
  and not has_function_privilege('service_role','public.answer_question(uuid,uuid,bigint,integer,text,uuid,integer[])','execute'),
 'one_answer_question',(select count(*) from pg_proc where proname='answer_question' and pronamespace='public'::regnamespace)=1,
 'picks_kept',public.reply_card_valid('question','sending','{"question":"Which?","choices":["A","B","C"],"multiple":true,"answer":["A","C"]}')
  and not public.reply_card_valid('question','sending','{"question":"Which?","choices":["A","B","C"],"multiple":false,"answer":["A"]}')
  and not public.reply_card_valid('question','sending','{"question":"Which?","choices":["A","B","C"],"multiple":true,"answer":["A","D"]}')
);
