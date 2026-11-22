-- ============================================================================
-- מה הבוט צייר?! — Supabase Realtime Schema (Vercel Serverless Ready)
-- Run this SQL once in your Supabase project's SQL Editor.
-- ============================================================================

-- 1. Rooms table: holds room metadata, categories, round state, timer, and history
create table if not exists public.game_rooms (
  code text primary key,
  phase text not null default 'lobby',
  settings jsonb not null default '{}'::jsonb,
  word_deck jsonb not null default '[]'::jsonb,
  current_round integer not null default 0,
  total_rounds integer not null default 0,
  current_category text not null default '',
  current_guess_index integer not null default 0,
  timer_ends_at timestamptz,
  timer_paused_remaining integer,
  round_commentary text not null default '',
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Players table: each player has their own row (zero write contention on join/score)
create table if not exists public.game_players (
  id text primary key,
  room_code text not null references public.game_rooms(code) on delete cascade,
  nickname text not null,
  avatar text not null default '🐱',
  score integer not null default 0,
  guesser_score integer not null default 0,
  creator_score integer not null default 0,
  prev_score integer not null default 0,
  round_delta integer not null default 0,
  connected boolean not null default true,
  joined_at timestamptz not null default now()
);

create index if not exists idx_game_players_room_code on public.game_players(room_code);

-- 3. Submissions table: one row per player per round (zero write contention for prompts & pasted images)
create table if not exists public.game_submissions (
  id text primary key,
  room_code text not null references public.game_rooms(code) on delete cascade,
  round_number integer not null,
  player_id text not null references public.game_players(id) on delete cascade,
  category text not null,
  secret_word text not null,
  prompt text not null default '',
  prompt_submitted_at timestamptz,
  copied_at timestamptz,
  image_data text,
  image_size_kb integer,
  order_index integer not null default 0,
  guessed_correctly boolean not null default false,
  guesser_id text,
  revealed boolean not null default false,
  awarded_creator_pts integer not null default 0,
  awarded_guesser_pts integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.game_submissions
  add column if not exists copied_at timestamptz;

create index if not exists idx_game_submissions_room_round
  on public.game_submissions(room_code, round_number);

-- 4. Enable Row Level Security with open party-game access via room code
alter table public.game_rooms enable row level security;
alter table public.game_players enable row level security;
alter table public.game_submissions enable row level security;

drop policy if exists "Allow party room access" on public.game_rooms;
create policy "Allow party room access"
  on public.game_rooms for all
  using (true)
  with check (true);

drop policy if exists "Allow party players access" on public.game_players;
create policy "Allow party players access"
  on public.game_players for all
  using (true)
  with check (true);

drop policy if exists "Allow party submissions access" on public.game_submissions;
create policy "Allow party submissions access"
  on public.game_submissions for all
  using (true)
  with check (true);

-- 5. Enable Supabase Realtime replication for all 3 tables
alter table public.game_rooms replica identity full;
alter table public.game_players replica identity full;
alter table public.game_submissions replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'game_rooms'
  ) then
    alter publication supabase_realtime add table public.game_rooms;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'game_players'
  ) then
    alter publication supabase_realtime add table public.game_players;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'game_submissions'
  ) then
    alter publication supabase_realtime add table public.game_submissions;
  end if;
end $$;
