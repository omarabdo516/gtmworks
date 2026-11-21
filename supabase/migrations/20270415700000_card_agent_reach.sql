-- A Card whose own Agent is hidden from the caller is out of their reach (#367), as board_cards() already leaves it off
-- their board (#190): #221 hid a Card by its Conversation's Agent only, so a Contributor who knew or guessed the id of a
-- Card of a hidden Agent could still read it and, through the functions that run as the caller (move_work_card,
-- move_work_card_to_column, place_work_card, undo_work_card_move, edit_work_card, change_work_card), move or change it.
-- The rule is made whole where every reader already asks it: the Card's read rule (card_agent_visible, which also
-- bounds every update and delete of a Card) and can_see_card (the read and write rule of every row written on a Card,
-- and the check of each function that reads Cards as its owner, supabase/tests/card_readers_guard.sql). Both now ask
-- can_see_agent for the Card's own Agent too, as board_cards() does.
-- A Card with no Agent, or the main Agent's, reads as before. Nothing changes for a Member who sees the Agent.
-- Only replaces a rule and functions, each function keeping its arguments, result, security, search path and grants:
-- the previous app version calls them as before.

alter policy card_agent_visible on public.work_cards
 using (public.can_see_conversation_agent(company_id,conversation_id) and (agent_id is null or public.can_see_agent(company_id,agent_id)));

create or replace function public.can_see_card(c uuid, card bigint) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select public.can_see_conversation_agent(c,w.conversation_id) and (w.agent_id is null or public.can_see_agent(c,w.agent_id))
  from public.work_cards w where w.company_id=c and w.id=card),true);
$$;
