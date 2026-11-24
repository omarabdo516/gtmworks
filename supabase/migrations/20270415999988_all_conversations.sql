-- All conversations (#673): a person reaches every Conversation of theirs and the channels they are in, newest
-- message first, with a title search, a page at a time.

-- How a search in the interface compares text, as lib/arabic-search.mjs's searchFold reads it: case aside, and in
-- Arabic without its marks or tatweel, with every hamza seat read as its letter, alef wasla as alef, alef maqsura as ya
-- and teh marbuta as ha. Runs of spaces are one space, and the ends are trimmed. Both sides of a comparison go through it.
create function public.search_fold(text text) returns text
language sql immutable strict parallel safe set search_path='' as $$
 select btrim(regexp_replace(translate(regexp_replace(normalize(lower(text),NFKD),'[ً-ٰـ]','','g'),'ٱىة','ايه'),'\s+',' ','g'));
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

-- A Conversation's title, as the sidebar names it: the first line of its first message, else that message's first
-- file (#155), else its Agent's name.
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

-- The reader's own Conversations in Company `c` (an Agent hidden from them hides its Conversations, as the read policy
-- does) and the channels they are in, newest message first, a page of at most 100 at a time: the next page starts after
-- the last row of the one before (`after_at`, `after_id`). `q` keeps those whose title holds it, read through
-- search_fold. A Conversation is titled by the first line of its first message, else its first file, else its Agent; a
-- morning's Conversation (#183) and the general channel are named in the reader's language, so the caller passes those
-- names (`morning`, `general`) and `title` is null for them. `archived` asks for the archived list, which #674 fills.
-- Each row carries its newest message (`last_body`, `last_at`).
create function public.conversation_list(c uuid, q text default null, archived boolean default false, after_at timestamptz default null,
 after_id uuid default null, lim integer default 50, morning text default null, general text default null)
returns table(kind text, id uuid, agent_id uuid, agent_name text, connection_id uuid, title text, good_morning_day date, channel_kind text, last_at timestamptz, last_body text)
language sql stable security definer set search_path='' as $$
 with wanted as (select nullif(public.search_fold(coalesce(q,'')),'') as fold),
 listed as (
  select 'conversation'::text as kind, v.id, v.agent_id, v.agent_name, v.good_morning_day, null::text as channel_kind, null::text as name, v.last_message_at as last_at
  from public.own_conversations(c) v
  where not archived
  union all
  select 'channel', k.id, null, null, null, k.kind, k.name,
   coalesce((select m.created_at from public.channel_messages m where m.channel_id=k.id order by m.id desc limit 1),k.created_at)
  from public.channels k
  where k.company_id=c and public.in_channel(k.id) and not archived
 ),
 page as (
  select t.* from listed t, wanted w
  where (after_at is null or (t.last_at,t.id)<(after_at,after_id))
   and case when w.fold is null then true
    else position(w.fold in public.search_fold(coalesce(case when t.kind='channel' then coalesce(t.name,general) when t.good_morning_day is not null then morning
     else public.conversation_title(t.id,t.agent_name) end,'')))>0 end
  order by t.last_at desc, t.id desc
  limit least(greatest(coalesce(lim,50),1),100)
 )
 select p.kind, p.id, p.agent_id, p.agent_name, h.connection_id,
  case when p.kind='channel' then p.name when p.good_morning_day is null then public.conversation_title(p.id,p.agent_name) end, p.good_morning_day, p.channel_kind, p.last_at,
  case when p.kind='conversation'
   then (select m.body from public.conversation_messages m where m.conversation_id=p.id and m.body<>'' and m.hand_card is null order by m.id desc limit 1)
   else (select m.body from public.channel_messages m where m.channel_id=p.id and m.body<>'' and m.hand_card is null order by m.id desc limit 1) end
 from page p left join public.hermes_agents h on h.id=p.agent_id and h.company_id=c
 order by p.last_at desc, p.id desc;
$$;
revoke all on function public.conversation_list(uuid,text,boolean,timestamptz,uuid,integer,text,text) from public,anon,service_role;
grant execute on function public.conversation_list(uuid,text,boolean,timestamptz,uuid,integer,text,text) to authenticated;

-- How many rows each of All conversations' two lists holds for the reader: `current` and `archived` (#674 fills it).
create function public.conversation_counts(c uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('current',
  (select count(*) from public.own_conversations(c))
  +(select count(*) from public.channels k where k.company_id=c and public.in_channel(k.id)),
  'archived',0);
$$;
revoke all on function public.conversation_counts(uuid) from public,anon,service_role;
grant execute on function public.conversation_counts(uuid) to authenticated;
