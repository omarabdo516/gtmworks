-- All conversations (#673): a person reaches every Conversation of theirs and the channels they are in, newest
-- message first, with a title search, a page at a time.

-- How a search in the interface compares text, as lib/arabic-search.mjs's searchFold reads it: case aside, and in
-- Arabic without its marks (U+064B-U+065F and U+0670, never the Arabic-Indic digits) or tatweel, with every hamza seat read as its letter, alef wasla as alef, alef maqsura as ya
-- and teh marbuta as ha. Runs of spaces are one space, and the ends are trimmed. Both sides of a comparison go through it.
create function public.search_fold(text text) returns text
language sql immutable strict parallel safe set search_path='' as $$
 select btrim(regexp_replace(translate(regexp_replace(normalize(lower(text),NFKD),'[ً-ٰٟـ]','','g'),'ٱىة','ايه'),'\s+',' ','g'));
$$;
revoke all on function public.search_fold(text) from public,anon,authenticated,service_role;

-- A Conversation keeps the time of its newest message, so the sidebar and All conversations order by it with an index
-- instead of reading every message. Each message keeps it, the previous release's included; one already written is
-- read once here. A Conversation is made with its first message, so it holds '-infinity' only until that message lands.
alter table public.conversations add column last_message_at timestamptz not null default '-infinity';
update public.conversations v set last_message_at=coalesce((select max(m.created_at) from public.conversation_messages m where m.conversation_id=v.id),v.created_at);
create index conversations_newest on public.conversations(company_id,person_id,last_message_at desc,id desc);

create function public.keep_conversation_newest() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.conversations set last_message_at=new.created_at where id=new.conversation_id and last_message_at<new.created_at;
 return null;
end $$;
revoke all on function public.keep_conversation_newest() from public,anon,authenticated,service_role;
create trigger conversation_messages_newest after insert on public.conversation_messages for each row execute function public.keep_conversation_newest();

-- A Conversation's title, by the rule the interface names it everywhere (lib/conversation-title.mjs): the first line of
-- its first message, else that message's first file (#155), else its Agent's name; a morning's is named by the caller.
create function public.conversation_title(conversation uuid, agent_name text) returns text
language sql stable set search_path='' as $$
 select coalesce((select coalesce(nullif(split_part(m.body,E'\n',1),''),(select a.name from public.conversation_attachments a where a.message_id=m.id order by a.position,a.id limit 1))
  from public.conversation_messages m where m.conversation_id=conversation and m.author='person' order by m.id limit 1),agent_name);
$$;
revoke all on function public.conversation_title(uuid,text) from public,anon,authenticated,service_role;

-- The reader's own Conversations in Company `c`, as its read policy (conversations_read) lets them read: an Agent hidden
-- from them hides its Conversations. Each Agent of the Company is asked once, not each Conversation. The readers below
-- call it as its owner; nobody calls it directly.
create function public.own_conversations(c uuid) returns setof public.conversations
language sql stable set search_path='' as $$
 select v.* from public.conversations v
 where v.company_id=c and v.person_id=(select auth.uid()) and public.is_member(c)
  and (v.agent_id is null or v.agent_id in (select h.id from public.hermes_agents h where h.company_id=c and public.agent_visible_to(c,(select auth.uid()),h.id)));
$$;
revoke all on function public.own_conversations(uuid) from public,anon,authenticated,service_role;

-- The list and its counts, conversation_list and conversation_counts, read archived Conversations and channels too, so
-- they are made once with both, in 20270415999995_archive_channels.sql.
