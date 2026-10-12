-- MindTrail, phase 1 schema.
-- Run once in Supabase Dashboard → SQL Editor. Safe to re-run: objects use IF NOT EXISTS / OR REPLACE.
--
-- Security model (defence in depth):
--   1. Sign-ups are disabled in Supabase Auth; the only user is created by the server for OWNER_EMAIL.
--   2. Every table has RLS: a row is visible only if user_id = auth.uid() AND the JWT email is the owner.
--   3. The anon role gets no grants at all. The audio bucket is private with no client policies:
--      the browser can only upload through short-lived signed URLs issued by an API function.

-- ---------------------------------------------------------------------------
-- Owner allowlist (lives in a schema the Data API does not expose)
-- ---------------------------------------------------------------------------
create schema if not exists private;

create table if not exists private.app_owner (
  email text primary key check (email = lower(email))
);

-- >>> EDIT THIS LINE: your login email, lower case. <<<
insert into private.app_owner (email) values ('you@example.com') on conflict do nothing;

create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.app_owner
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on function private.is_owner() from public, anon;
grant execute on function private.is_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per user. Phase 1 uses monthly_cap_usd and audio_retention_days; the rest is read in later phases.
create table if not exists public.settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  output_language text not null default 'hu' check (output_language in ('hu', 'en')),
  timezone text not null default 'Europe/Budapest',
  digest_hour smallint not null default 7 check (digest_hour between 0 and 23),
  audio_retention_days integer not null default 0 check (audio_retention_days between 0 and 365),
  monthly_cap_usd numeric(8, 2) not null default 25 check (monthly_cap_usd >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  title text not null check (length(title) between 1 and 200),
  context_tag text not null default 'other',
  language text not null default 'auto' check (language in ('auto', 'hu', 'en')),
  source text not null default 'upload' check (source in ('upload', 'in_app')),
  duration_sec numeric(10, 2),
  audio_path text,
  audio_mime text,
  audio_bytes bigint,
  audio_deleted_at timestamptz,
  consent_confirmed boolean not null check (consent_confirmed = true)
);
create index if not exists recordings_user_created_idx on public.recordings (user_id, created_at desc);

-- Long audio is split into ~10-minute chunks. Each chunk is transcribed and stored on its own,
-- so a failed or timed-out job resumes where it stopped instead of starting over.
create table if not exists public.audio_chunks (
  recording_id uuid not null references public.recordings (id) on delete cascade,
  idx integer not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  path text not null,
  start_sec numeric(10, 2) not null,
  duration_sec numeric(10, 2) not null,
  text text,
  segments jsonb,
  timestamp_precision text check (timestamp_precision in ('segment', 'chunk')),
  transcribed_at timestamptz,
  primary key (recording_id, idx)
);

create table if not exists public.transcripts (
  recording_id uuid primary key references public.recordings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  -- [{ "start": seconds, "end": seconds, "text": "..." }], times relative to the start of the recording
  segments jsonb not null default '[]'::jsonb,
  -- 'segment' = per-utterance timestamps from the model; 'chunk' = model returned none, times are per 10-min chunk
  timestamp_precision text not null default 'segment' check (timestamp_precision in ('segment', 'chunk')),
  model text not null,
  detected_language text,
  created_at timestamptz not null default now(),
  -- 'simple' config: no stemming, works the same for Hungarian, English and mixed text.
  fts tsvector generated always as (to_tsvector('simple', text)) stored
);
create index if not exists transcripts_fts_idx on public.transcripts using gin (fts);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'extracting' is used from phase 2 on.
  status text not null default 'queued'
    check (status in ('queued', 'transcribing', 'extracting', 'ready', 'failed')),
  progress jsonb not null default '{}'::jsonb,
  error text,
  attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_recording_idx on public.jobs (recording_id);
create index if not exists jobs_open_idx on public.jobs (status) where status in ('queued', 'transcribing', 'extracting');

create table if not exists public.usage_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  recording_id uuid references public.recordings (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  operation text not null,           -- 'transcribe' | 'extract' | 'ask' | ...
  model text not null,
  units jsonb not null default '{}'::jsonb,  -- e.g. {"audio_sec": 600} or {"input_tokens": ..., "output_tokens": ...}
  cost_usd numeric(10, 5) not null default 0
);
create index if not exists usage_log_user_month_idx on public.usage_log (user_id, created_at);

-- Spend for the current calendar month (UTC). security_invoker so RLS of usage_log applies.
create or replace view public.usage_this_month
with (security_invoker = true) as
  select user_id, coalesce(sum(cost_usd), 0)::numeric(10, 4) as cost_usd
  from public.usage_log
  where created_at >= date_trunc('month', now())
  group by user_id;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['settings', 'recordings', 'audio_chunks', 'transcripts', 'jobs', 'usage_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format(
      'create policy owner_all on public.%I for all to authenticated
         using (user_id = (select auth.uid()) and (select private.is_owner()))
         with check (user_id = (select auth.uid()) and (select private.is_owner()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Grants (explicit: Supabase no longer auto-exposes new public tables to the Data API)
-- ---------------------------------------------------------------------------
revoke all on public.settings, public.recordings, public.audio_chunks, public.transcripts,
              public.jobs, public.usage_log, public.usage_this_month from anon;

grant select, update on public.settings to authenticated;
grant select, update, delete on public.recordings to authenticated;  -- inserts go through /api/recordings
grant select on public.audio_chunks, public.transcripts, public.jobs, public.usage_log,
                public.usage_this_month to authenticated;

grant all on public.settings, public.recordings, public.audio_chunks, public.transcripts,
             public.jobs, public.usage_log to service_role;
grant select on public.usage_this_month to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Storage: private bucket, no client-side policies (signed URLs only)
-- 50 MB matches the Supabase Free plan's global per-file limit; raise both together if you upgrade.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', false, 52428800,
        array['audio/*', 'video/mp4', 'video/webm', 'application/octet-stream'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
