-- MindTrail, phase 2: summaries and action items.
-- Run once in the SQL editor after 0001. Safe to re-run.

-- How the extractor should refer to you, e.g. 'Márton'. Optional, but it helps decide which
-- commitments are yours when the transcript has no speaker labels.
alter table public.settings add column if not exists owner_name text;

create table if not exists public.summaries (
  recording_id uuid primary key references public.recordings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  summary text not null,
  decisions jsonb not null default '[]'::jsonb,       -- ["...", ...]
  open_questions jsonb not null default '[]'::jsonb,  -- ["...", ...]
  output_language text not null,
  model text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.action_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recording_id uuid not null references public.recordings (id) on delete cascade,
  text text not null check (length(text) between 1 and 500),
  -- 'me' = I must do it; 'other' = someone promised it to me ("waiting on").
  owner text not null check (owner in ('me', 'other')),
  owner_label text check (length(owner_label) <= 80),  -- name or relationship only
  due_date date,
  due_date_source text check (due_date_source in ('stated', 'suggested')),
  priority text not null default 'normal' check (priority in ('high', 'normal', 'low')),
  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'done', 'dismissed', 'snoozed')),
  snoozed_until date,
  snooze_count integer not null default 0,
  -- No quote, no item: every item must point at the words that created it.
  source_quote text not null check (length(source_quote) > 0),
  source_timestamp numeric(10, 2),
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  done_at timestamptz,
  constraint due_source_matches_date check ((due_date is null) = (due_date_source is null)),
  constraint snooze_has_date check (status <> 'snoozed' or snoozed_until is not null)
);
create index if not exists action_items_user_status_idx on public.action_items (user_id, status, due_date);
create index if not exists action_items_recording_idx on public.action_items (recording_id);

-- RLS: same owner policy as phase 1.
do $$
declare t text;
begin
  foreach t in array array['summaries', 'action_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format(
      'create policy owner_all on public.%I for all to authenticated
         using (user_id = (select auth.uid()) and (select private.is_owner()))
         with check (user_id = (select auth.uid()) and (select private.is_owner()))', t);
  end loop;
end $$;

revoke all on public.summaries, public.action_items from anon;
grant select on public.summaries to authenticated;
-- The app reviews, edits, completes and snoozes items directly (RLS-protected); it never creates them.
grant select, update on public.action_items to authenticated;
grant all on public.summaries, public.action_items to service_role;
