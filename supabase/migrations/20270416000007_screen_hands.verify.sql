-- #714: a hand card keeps "on my screen" only as true, and the button it stopped at only beside it, and only its Conversation's person reads the open steps on a Screen.
select json_build_object(
 'screen_is_a_hand_key',public.reply_card_valid('hand','open','{"app":"Meta Ads","line":"Ready","rows":[],"screen":true}')
  and public.reply_card_valid('hand','open','{"app":"Meta Ads","line":"Ready","rows":[]}')
  and not public.reply_card_valid('hand','open','{"app":"Meta Ads","line":"Ready","rows":[],"screen":false}')
  and not public.reply_card_valid('draft','shown','{"line":"Ready","rows":[],"screen":true}'),
 'step_only_on_a_screen',public.reply_card_valid('hand','open','{"app":"Meta Ads","line":"Ready","rows":[],"screen":true,"step":"Publish"}')
  and not public.reply_card_valid('hand','open','{"app":"Meta Ads","line":"Ready","rows":[],"step":"Publish"}'),
 'only_people',has_function_privilege('authenticated','public.screen_hands(uuid)','execute')
  and not has_function_privilege('anon','public.screen_hands(uuid)','execute')
  and not has_function_privilege('service_role','public.screen_hands(uuid)','execute'),
 'own_conversation',position('v.person_id=auth.uid()' in pg_get_functiondef('public.screen_hands(uuid)'::regprocedure))>0
);
