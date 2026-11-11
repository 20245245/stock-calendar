-- Private journal tables. Existing applications/tables are left intact.
create table public.journal_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  title text not null default '' check (char_length(title)<=500),
  body text not null default '' check (char_length(body)<=1000000),
  note_date date not null,
  event_id text not null default '',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  revision bigint not null default 1,
  primary key(user_id,id)
);
create table public.journal_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid not null,
  revision bigint not null,
  title text not null,
  body text not null,
  note_date date not null,
  event_id text not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  saved_at timestamptz not null default now(),
  primary key(user_id,note_id,revision)
);
alter table public.journal_notes enable row level security;
alter table public.journal_history enable row level security;
create policy journal_read_own on public.journal_notes for select to authenticated using ((select auth.uid())=user_id);
create policy journal_history_read_own on public.journal_history for select to authenticated using ((select auth.uid())=user_id);
-- All writes go through a compare-and-swap function, preserving previous content.
revoke all on public.journal_notes,public.journal_history from anon,authenticated;
grant select on public.journal_notes,public.journal_history to authenticated;
create function public.save_journal_note(p_id uuid,p_revision bigint,p_title text,p_body text,p_date date,p_event text,p_deleted timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  owner_id uuid := auth.uid();
  current_note public.journal_notes%rowtype;
  saved_note public.journal_notes%rowtype;
begin
  if owner_id is null then raise exception 'Login required' using errcode='42501'; end if;
  if p_id is null or p_date is null or p_title is null or p_body is null or p_revision is null then raise exception 'Invalid note'; end if;
  if char_length(p_title)>500 or char_length(p_body)>1000000 then raise exception 'Note too large'; end if;
  -- Also serialize first inserts, where no row exists to lock yet.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text||p_id::text,0));
  select * into current_note from public.journal_notes where user_id=owner_id and id=p_id for update;
  if found then
    if current_note.revision<>p_revision then return pg_catalog.jsonb_build_object('conflict',true,'note',pg_catalog.to_jsonb(current_note)); end if;
    insert into public.journal_history(user_id,note_id,revision,title,body,note_date,event_id,updated_at,deleted_at)
      values(owner_id,p_id,current_note.revision,current_note.title,current_note.body,current_note.note_date,current_note.event_id,current_note.updated_at,current_note.deleted_at);
    update public.journal_notes set title=p_title,body=p_body,note_date=p_date,event_id=coalesce(p_event,''),deleted_at=p_deleted,updated_at=now(),revision=revision+1
      where user_id=owner_id and id=p_id returning * into saved_note;
  else
    if p_revision<>0 then raise exception 'Unknown note revision'; end if;
    insert into public.journal_notes(user_id,id,title,body,note_date,event_id,deleted_at)
      values(owner_id,p_id,p_title,p_body,p_date,coalesce(p_event,''),p_deleted) returning * into saved_note;
  end if;
  return pg_catalog.jsonb_build_object('conflict',false,'note',pg_catalog.to_jsonb(saved_note));
end;
$$;
revoke all on function public.save_journal_note(uuid,bigint,text,text,date,text,timestamptz) from public,anon;
grant execute on function public.save_journal_note(uuid,bigint,text,text,date,text,timestamptz) to authenticated;
comment on table public.journal_notes is 'Private calendar journals. Browser uses publishable key and signed-in user JWT, never service_role.';
